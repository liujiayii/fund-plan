import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "~/db/client";
import { fund, fundNav } from "~/db/schema";
import {
  NAV_BACKFILL_FAILURE_COOLDOWN_MS,
  NAV_BACKFILL_INTERVAL_MS,
  NAV_BACKFILL_MIN_ROWS,
} from "~/domain/nav-backfill";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { ensureNavHistory } from "~/services/portfolio-service";

/**
 * 长历史回填闸门的服务层接线。
 *
 * 刻意**不测「真去拉」**：集成测试走真网络又慢又看运气（rank.test.ts 与
 * dca-backtest-page.test.ts 顶注的教训）。两个用例分别锁住闸门的两半：
 *  1. 记忆新鲜 → 连网络都不碰，行数一行不涨；
 *  2. 该尝试时 → 不论成败都把尝试时间写回（失败基金不被每个访客反复重试）。
 *     「上游不存在的代码」让回填必然拉空，于是这条与网络状况无关。
 */

async function resetAll() {
  const db = getDb(env.DB);
  await db.delete(fundNav);
  await db.delete(fund);
}

async function seedFund(
  code: string,
  navBackfilledAt: number | null,
  navBackfilledTarget: number | null = NAV_BACKFILL_MIN_ROWS,
) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试新基金C",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
    navBackfilledAt,
    navBackfilledTarget,
  });
}

/** 造几天净值（远少于阈值 60，模拟「生命周期很短的新基金」） */
async function seedNavs(code: string, dates: string[]) {
  const db = getDb(env.DB);
  for (const navDate of dates) {
    await db.insert(fundNav).values({
      fundCode: code,
      navDate,
      unitNav: 10000,
      accNav: 10000,
      growthRate: 0,
    });
  }
}

describe("ensureNavHistory 回填闸门", () => {
  beforeEach(resetAll);
  // 下述用例会 stub fetch（部分成功那条），别让它漏给后面的用例
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("记忆新鲜：不碰网络也不插行，直接返回现有序列", async () => {
    const db = getDb(env.DB);
    const code = "000001";
    await seedFund(code, Date.now());
    await seedNavs(code, ["2026-09-21", "2026-09-22", "2026-09-23"]);

    // 关键：stub 掉 fetch 并断言「一次都没被调用」——比断言行数更直接，
    // 而且**脱网也保判别力**（原先靠真网络失败来兜底，沙箱里闸门坏了也发现不了）
    const spy = vi.fn(async () => {
      throw new Error("闸门命中时不该碰网络");
    });
    vi.stubGlobal("fetch", spy);

    const series = await ensureNavHistory(db, env, code);

    expect(spy).not.toHaveBeenCalled();
    expect(series).toHaveLength(3);
    const rows = await db.select().from(fundNav).where(eq(fundNav.fundCode, code));
    expect(rows).toHaveLength(3);
  });

  it("拉空时只记短冷却（失败不锁满 6 小时）", async () => {
    const db = getDb(env.DB);
    const code = "999999"; // 上游不存在的代码 → 回填拉空
    await seedFund(code, null);
    await seedNavs(code, ["2026-09-21"]);

    const before = Date.now();
    await ensureNavHistory(db, env, code);

    const after = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    expect(after?.navBackfilledTarget).toBe(NAV_BACKFILL_MIN_ROWS);
    const at = after?.navBackfilledAt ?? 0;
    // 失败把时间戳往回拨成「冷却结束那一刻」——早于 now，但不早于 interval−cooldown
    expect(at).toBeLessThan(before);
    expect(at).toBeGreaterThan(
      before - NAV_BACKFILL_INTERVAL_MS + NAV_BACKFILL_FAILURE_COOLDOWN_MS - 5000,
    );
  });

  // 2026-09-23 CodeRabbit 评审：原先只判 rows.length === 0，于是「首页 20 行
  // 到手、后面整波全败」这种部分成功会被记成成功档，把闸门锁满 6 小时——
  // 库里明明才二十来行，回测页却 6 小时内没人再补

  it("部分成功（中途整波全败）：行照常落库，但只记短冷却", async () => {
    const db = getDb(env.DB);
    const code = "123456";
    await seedFund(code, null);
    await seedNavs(code, ["2026-09-21"]);

    // 首页 20 行成功、后续整波全败——对应 2026-09-23 实测的跨境链路抖动
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const idx = Number(/pageIndex=(\d+)/.exec(url)?.[1] ?? 1);
        if (idx > 1)
          throw new Error("Network connection lost");
        return new Response(
          JSON.stringify({
            TotalCount: 400,
            Data: {
              LSJZList: Array.from({ length: 20 }, (_, i) => ({
                FSRQ: `2026-08-${String(i + 1).padStart(2, "0")}`,
                DWJZ: "1.0000",
                LJJZ: "1.0000",
                JZZZL: "0.5",
              })),
            },
          }),
        );
      }),
    );

    const before = Date.now();
    await ensureNavHistory(db, env, code);

    // 已到手的部分行照常入库（不完整的只是「没拉全」，不是「数据不可用」）
    const navRows = await db.select().from(fundNav).where(eq(fundNav.fundCode, code));
    expect(navRows.length).toBeGreaterThan(1);

    // 但记账走失败档：时间戳被往回拨（成功档记的是 now），只锁 30 分钟
    const after = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    expect(after?.navBackfilledTarget).toBe(NAV_BACKFILL_MIN_ROWS);
    const at = after?.navBackfilledAt ?? 0;
    expect(at).toBeLessThan(before);
    expect(at).toBeGreaterThan(
      before - NAV_BACKFILL_INTERVAL_MS + NAV_BACKFILL_FAILURE_COOLDOWN_MS - 5000,
    );
  });

  it("完整拉取：按成功档记账（时间戳记 now，6 小时内不再试）", async () => {
    const db = getDb(env.DB);
    const code = "654321";
    await seedFund(code, null);
    await seedNavs(code, ["2026-09-21"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const idx = Number(/pageIndex=(\d+)/.exec(url)?.[1] ?? 1);
        return new Response(
          JSON.stringify({
            TotalCount: 400,
            Data: {
              LSJZList: Array.from({ length: 20 }, (_, i) => ({
                FSRQ: `2026-0${idx}-${String(i + 1).padStart(2, "0")}`,
                DWJZ: "1.0000",
                LJJZ: "1.0000",
                JZZZL: "0.5",
              })),
            },
          }),
        );
      }),
    );

    // 只想拉 40 行 ⇒ 2 页拉完即完整（完整度与「拉了多少行」无关）
    await ensureNavHistory(db, env, code, { maxRows: 40 });

    const after = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    const at = after?.navBackfilledAt ?? 0;
    // 成功档：时间戳就是「现在」（失败档会被往回拨近 6 小时）
    expect(Date.now() - at).toBeLessThan(5000);
  });
});
