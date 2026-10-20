import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, fund, orders, transactions, user } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { action } from "~/routes/plan";
import { registerUser } from "~/services/auth";
import { MAX_PLAN_ITEMS, placePlanBuys, resolvePlanImport } from "~/services/plan-import";
import { createSession, sessionCookie } from "~/services/session";
import { CloudflareContext } from "../../workers/app";

/**
 * 计划导入的接线测试（真实 D1）。
 *
 * 代码来源是 `domain/plan-catalog` 的品种池，查表不打网络——
 * 所以这整套测试离线可跑，也不会因为东财抽风变红。
 */

const db = getDb(env.DB);

async function resetAll() {
  await db.delete(orders);
  await db.delete(user);
  await db.delete(fund);
}

beforeEach(resetAll);

async function seedFund(code: string, name: string, type = "指数型-股票") {
  await db.insert(fund).values({
    code,
    name,
    type,
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

describe("resolvePlanImport", () => {
  it("池内品种直接命中，不依赖历史订单", async () => {
    const u = await registerUser(db, env, "alice", "hunter2");

    const rows = await resolvePlanImport(db, u.id, [
      { alias: "中证白酒", amountCents: 123_900 },
      { alias: "沪港深红利低波动", amountCents: 91_900 },
    ], "2026-10-20");

    expect(rows.map(r => r.selectedCode)).toEqual(["161725", "007751"]);
    expect(rows.every(r => r.notices.length === 0)).toBe(true);
  });

  it("档案已在站内时顺带带出全称，没有则为 null（不影响下单）", async () => {
    const u = await registerUser(db, env, "alice", "hunter2");
    await seedFund("161725", "招商中证白酒指数(LOF)A");

    const rows = await resolvePlanImport(db, u.id, [
      { alias: "中证白酒", amountCents: 123_900 },
      { alias: "港股科技", amountCents: 106_000 },
    ], "2026-10-20");

    expect(rows[0]!.selectedName).toBe("招商中证白酒指数(LOF)A");
    expect(rows[1]!.selectedName).toBeNull();
    expect(rows[1]!.selectedCode).toBe("016495");
  });

  it("池外品种留空并提示，不猜一个最像的", async () => {
    const u = await registerUser(db, env, "alice", "hunter2");

    const rows = await resolvePlanImport(db, u.id, [
      { alias: "半导体", amountCents: 99_000 },
    ], "2026-10-20");

    expect(rows[0]!.selectedCode).toBeNull();
    expect(rows[0]!.notices.some(n => n.includes("品种池里没有"))).toBe(true);
  });

  it("本期已买的同一只提示追加，金额按元显示", async () => {
    const u = await registerUser(db, env, "alice", "hunter2");
    await db.insert(orders).values({
      userId: u.id,
      fundCode: "161725",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 50_000,
      shares: null,
      placeDate: "2026-10-20",
      confirmDate: "2026-10-20",
      createdAt: Date.now(),
    });

    const rows = await resolvePlanImport(db, u.id, [
      { alias: "中证白酒", amountCents: 123_900 },
    ], "2026-10-20");

    expect(rows[0]!.notices.some(n => n.includes("本期已买 500.00 元"))).toBe(true);
  });
});

describe("placePlanBuys", () => {
  const ITEMS = [
    { fundCode: "020602", amountCents: 91_900 },
    { fundCode: "023711", amountCents: 91_900 },
    { fundCode: "161725", amountCents: 123_900 },
  ];

  async function seedForBuy() {
    const u = await registerUser(db, env, "alice", "hunter2");
    await seedFund("020602", "易方达中证红利低波动ETF联接发起式A");
    await seedFund("023711", "中金中证优选300指数(LOF)B");
    await seedFund("161725", "招商中证白酒指数(LOF)A");
    return u;
  }

  it("一次提交：订单、流水、现金全部到位", async () => {
    const u = await seedForBuy();
    const before = (await db.query.account.findFirst({
      where: eq(account.userId, u.id),
    }))!.cash;

    const r = await placePlanBuys(db, env, {
      userId: u.id,
      periodDate: "2026-10-20",
      items: ITEMS,
    });

    const total = ITEMS.reduce((s, i) => s + i.amountCents, 0);
    expect(r.placed).toBe(3);
    expect(r.totalCents).toBe(total);

    const os = await db.select().from(orders);
    expect(os).toHaveLength(3);
    // 期次用原文日期，不是「今天」
    expect(os.every(o => o.placeDate === "2026-10-20")).toBe(true);
    expect(os.every(o => o.status === "pending")).toBe(true);
    // 周二 13:30 下单 → 15:00 前申购吃当日净值，确认日就是当天
    expect(os.every(o => o.confirmDate === "2026-10-20")).toBe(true);

    const after = (await db.query.account.findFirst({
      where: eq(account.userId, u.id),
    }))!.cash;
    expect(before - after).toBe(total);

    const txs = await db.select().from(transactions).where(eq(transactions.type, "buy"));
    expect(txs).toHaveLength(3);
    expect(txs.map(t => t.amount).reduce((s, v) => s + v, 0)).toBe(-total);
    // 取舍：批量下单拿不到订单 id，流水靠 note 里的期次对账
    expect(txs.every(t => t.orderId === null)).toBe(true);
    expect(txs.every(t => t.note.includes("计划导入 2026-10-20"))).toBe(true);

    // 对账恒等式（cash.ts 的纪律）：account.cash === Σ transactions.amount
    const acc = (await db.query.account.findFirst({
      where: eq(account.userId, u.id),
    }))!;
    const allTx = await db.select().from(transactions).where(eq(transactions.userId, u.id));
    expect(acc.cash).toBe(allTx.reduce((s, t) => s + t.amount, 0));

    // 余额快照必须严格递减，且最后一笔等于账户真值（不是 JS 里算的假快照）
    const buys = allTx.filter(t => t.type === "buy").sort((a, b) => a.id - b.id);
    for (let i = 1; i < buys.length; i++)
      expect(buys[i]!.balance).toBeLessThan(buys[i - 1]!.balance);
    expect(buys.at(-1)!.balance).toBe(acc.cash);
  });

  it("现金不足：整批拒绝，一条订单与流水都不写", async () => {
    const u = await seedForBuy();
    // 把现金调到只够买一只
    await db.update(account).set({ cash: 100_000 }).where(eq(account.userId, u.id));

    await expect(placePlanBuys(db, env, {
      userId: u.id,
      periodDate: "2026-10-20",
      items: ITEMS,
    })).rejects.toThrow("现金不足");

    expect(await db.select().from(orders)).toHaveLength(0);
    expect(
      await db.select().from(transactions).where(eq(transactions.type, "buy")),
    ).toHaveLength(0);
  });

  it("起购不足：整批拒绝", async () => {
    const u = await seedForBuy();
    // seedFund 的起购是 1000 分（10 元），给 919 分（9.19 元）
    await expect(placePlanBuys(db, env, {
      userId: u.id,
      periodDate: "2026-10-20",
      items: [{ fundCode: "020602", amountCents: 919 }],
    })).rejects.toThrow("起购");

    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("超过单次导入上限：整批拒绝（避免 batch 分块破坏原子性）", async () => {
    const u = await seedForBuy();
    const many = Array.from({ length: MAX_PLAN_ITEMS + 1 }, () => ({
      fundCode: "020602",
      amountCents: 1000,
    }));

    await expect(placePlanBuys(db, env, {
      userId: u.id,
      periodDate: "2026-10-20",
      items: many,
    })).rejects.toThrow("最多");

    expect(await db.select().from(orders)).toHaveLength(0);
  });
});

describe("POST /plan action", () => {
  /** 伪造路由 context（与 plan-page.test.ts 同款） */
  function fakeContext(): unknown {
    return {
      get: (key: unknown) =>
        key === CloudflareContext
          ? { env, ctx: { waitUntil: () => {} } }
          : undefined,
    };
  }

  function post(fd: Record<string, string>, token: string): Request {
    const body = new FormData();
    for (const [k, v] of Object.entries(fd)) body.append(k, v);
    return new Request("https://x.dev/plan", {
      method: "POST",
      body,
      headers: { Cookie: sessionCookie(token) },
    });
  }

  async function seedAdmin() {
    const u = await registerUser(db, env, "testadmin", "hunter2");
    const token = await createSession(db, u.id);
    await seedFund("161725", "招商中证白酒指数(LOF)A");
    await seedFund("023711", "中金中证优选300指数(LOF)B");
    return { userId: u.id, token };
  }

  it("非 admin：403，且不落任何订单", async () => {
    const u = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, u.id);

    try {
      await action({
        request: post({ intent: "commit", periodDate: "2026-10-20", rows: "[]" }, token),
        context: fakeContext(),
        params: {},
      } as never);
      expect.unreachable("应该 403");
    }
    catch (thrown) {
      expect((thrown as Response).status).toBe(403);
    }
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("parse：按品种池查表预选，不猜、不联网", async () => {
    const { token } = await seedAdmin();

    const r = await action({
      request: post({
        intent: "parse",
        text: "时间：2026年10月20日\n• 中证白酒，1239元\n• 优选300，919元\n• 半导体，990元",
      }, token),
      context: fakeContext(),
      params: {},
    } as never) as { stage?: string; rows?: { alias: string; selectedCode: string | null }[] };

    expect(r.stage).toBe("preview");
    expect(r.rows).toHaveLength(3);
    expect(r.rows![0]!.selectedCode).toBe("161725");
    expect(r.rows![1]!.selectedCode).toBe("023711");
    // 池外品种留空，由人决定
    expect(r.rows![2]!.selectedCode).toBeNull();
  });

  it("commit：下单成功", async () => {
    const { token } = await seedAdmin();

    const r = await action({
      request: post({
        intent: "commit",
        periodDate: "2026-10-20",
        rows: JSON.stringify([{ alias: "中证白酒", fundCode: "161725", amountCents: 123_900 }]),
      }, token),
      context: fakeContext(),
      params: {},
    } as never) as { stage?: string; placed?: number };

    expect(r.stage).toBe("done");
    expect(r.placed).toBe(1);
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it("commit：明细非法时整批拒绝（服务端不信任客户端）", async () => {
    const { token } = await seedAdmin();

    const r = await action({
      request: post({
        intent: "commit",
        periodDate: "2026-10-20",
        rows: JSON.stringify([{ fundCode: "12345", amountCents: 1000 }]),
      }, token),
      context: fakeContext(),
      params: {},
    } as never) as { error?: string };

    expect(r.error).toBeTruthy();
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});
