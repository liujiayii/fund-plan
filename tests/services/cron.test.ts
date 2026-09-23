import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "~/db/client";
import {
  account,
  checkin,
  dcaPlan,
  fund,
  fundNav,
  holding,
  orders,
  session,
  shareLot,
  transactions,
  user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { createDcaPlan } from "~/services/dca-service";
import { settlePendingOrders, syncNav } from "~/services/settle";

/**
 * Cron 任务的行为验证。
 *
 * 这里直接测两个被 scheduled 调用的服务函数组合，
 * 而不是去调 worker.scheduled——后者需要拉起完整 Worker 入口，
 * 在测试里性价比低。分派逻辑本身很薄（按 cron 字符串 if/else），
 * 真正需要保障的是「顺序正确」与「异常隔离」这两件事。
 */

async function resetAll() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(shareLot);
  await db.delete(holding);
  await db.delete(orders);
  await db.delete(dcaPlan);
  await db.delete(checkin);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
  await db.delete(fundNav);
  await db.delete(fund);
}

async function seedFund(code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试成长混合",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

beforeEach(resetAll);

// console spy 必须在每个用例后收掉：断言先炸时 mockRestore 不会执行，
// 静音的 console 会泄漏给同文件后续用例（2026-09-23 对抗 review 指出）
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Cron：定投扫描 → 撮合 全链路", () => {
  it("定投扫描生成的单子，能被当晚撮合确认", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const reg = await registerUser(db, env, "alice", "hunter2");

    // 建一个日投计划，next_run = 8/24
    await createDcaPlan(db, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
      now: new Date("2026-08-23T06:00:00Z"),
    });

    // ① 北京 10:00 的定投扫描
    const { scanDcaPlans } = await import("~/services/dca-service");
    const scan = await scanDcaPlans(db, env, new Date("2026-08-24T02:00:00Z"));
    expect(scan.triggered).toBe(1);

    // 单子已生成，确认日为当日（北京 10:00 < 15:00）
    const pending = await db.select().from(orders);
    expect(pending).toHaveLength(1);
    expect(pending[0].confirmDate).toBe("2026-08-24");
    expect(pending[0].status).toBe("pending");

    // ② 写入当日净值（模拟 syncNav 的结果）
    await db.insert(fundNav).values({
      fundCode: "000001",
      navDate: "2026-08-24",
      unitNav: 15000,
      accNav: 15000,
      growthRate: 0,
    });

    // ③ 北京 20:30 的撮合
    const settle = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-24T12:30:00Z"),
    );
    expect(settle.confirmed).toBe(1);

    // 持仓已建立
    const h = await db.query.holding.findFirst({
      where: eq(holding.userId, reg.id),
    });
    expect(h!.totalShares).toBe(6568133);
    expect(h!.totalCost).toBe(100000);
  });

  it("净值同步失败时撮合让订单顺延，不判失败", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const reg = await registerUser(db, env, "alice", "hunter2");

    const { placeBuyOrder } = await import("~/services/trade");
    await placeBuyOrder(db, env, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    // 让东财接口挂掉
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    // syncNav 应当不抛错，只是同步 0 条
    const s = await syncNav(db, env, ["000001"]);
    expect(s.synced).toBe(0);

    // 撮合因缺净值顺延
    const r = await settlePendingOrders(db, env, new Date("2026-08-24T12:30:00Z"));
    expect(r.confirmed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);

    const o = await db.select().from(orders);
    expect(o[0].status).toBe("pending"); // 保持待确认

    vi.unstubAllGlobals();
  });

  it("syncNav 只同步有持仓或待确认订单的基金", async () => {
    const db = getDb(env.DB);
    await seedFund("000001");
    await seedFund("110022"); // 这只没人碰
    const reg = await registerUser(db, env, "alice", "hunter2");

    const { placeBuyOrder } = await import("~/services/trade");
    await placeBuyOrder(db, env, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const m = url.match(/fundCode=(\d+)/);
        if (m)
          fetched.push(m[1]);
        return new Response(
          JSON.stringify({
            Data: {
              LSJZList: [
                { FSRQ: "2026-08-24", DWJZ: "1.5000", LJJZ: "1.5000", JZZZL: "0" },
              ],
            },
          }),
        );
      }),
    );

    await syncNav(db, env);

    // 只应拉 000001，不该碰 110022
    expect(fetched).toContain("000001");
    expect(fetched).not.toContain("110022");

    vi.unstubAllGlobals();
  });

  it("syncNav 重复执行对同一天净值是覆盖而非报错（upsert）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const reg = await registerUser(db, env, "alice", "hunter2");
    const { placeBuyOrder } = await import("~/services/trade");
    await placeBuyOrder(db, env, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    let nav = "1.5000";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              Data: {
                LSJZList: [
                  { FSRQ: "2026-08-24", DWJZ: nav, LJJZ: nav, JZZZL: "0" },
                ],
              },
            }),
          ),
      ),
    );

    await syncNav(db, env, ["000001"]);
    // 第二次同步，净值被修正了
    nav = "1.6000";
    await syncNav(db, env, ["000001"]);

    const rows = await db
      .select()
      .from(fundNav)
      .where(eq(fundNav.fundCode, "000001"));
    expect(rows).toHaveLength(1); // 没产生重复行
    expect(rows[0].unitNav).toBe(16000); // 值被覆盖为最新

    vi.unstubAllGlobals();
  });

  /**
   * 2026-09-23 新增：**一轮下来所有基金都拉空**必须有 error 级汇总信号。
   *
   * 场景很实际：edge→东财的跨境链路不稳（实测 push2his 单发成功率 ~4%），
   * 万一某晚所有基金都拉空，订单会整体顺延到次日——而原先只有 per-fund 的
   * warn，翻日志才看得出「今晚什么都没撮合」。钱路的失败要能报警。
   */
  it("全部拉空：打 error 级汇总日志，并如实报数", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const reg = await registerUser(db, env, "alice", "hunter2");
    const { placeBuyOrder } = await import("~/services/trade");
    await placeBuyOrder(db, env, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const s = await syncNav(db, env);

    expect(s.funds).toBe(1);
    expect(s.empty).toBe(1);
    expect(s.synced).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("全部拉空"));

    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("超出总预算就收手：剩余基金留给下一次触发，不把整次 invocation 耗光", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const reg = await registerUser(db, env, "alice", "hunter2");
    const { placeBuyOrder } = await import("~/services/trade");
    await placeBuyOrder(db, env, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const spy = vi.fn(async () => {
      throw new Error("should not be called");
    });
    vi.stubGlobal("fetch", spy);

    // 预算给 0：进循环前就该判定超预算，一次上游都不打
    const s = await syncNav(db, env, undefined, 0);

    expect(spy).not.toHaveBeenCalled();
    expect(s.attempted).toBe(0);
    expect(s.empty).toBe(0);

    vi.unstubAllGlobals();
  });

  it("有基金同步成功：不打汇总 error", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const reg = await registerUser(db, env, "alice", "hunter2");
    const { placeBuyOrder } = await import("~/services/trade");
    await placeBuyOrder(db, env, {
      userId: reg.id,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              Data: {
                LSJZList: [
                  { FSRQ: "2026-08-24", DWJZ: "1.5000", LJJZ: "1.5000", JZZZL: "0" },
                ],
              },
            }),
          ),
      ),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const s = await syncNav(db, env);

    expect(s.funds).toBe(1);
    expect(s.empty).toBe(0);
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("全部拉空"));

    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
