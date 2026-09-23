import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { fund, fundNav } from "~/db/schema";
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

async function seedFund(code: string, navBackfilledAt: number | null) {
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

  it("记忆新鲜：不碰网络也不插行，直接返回现有序列", async () => {
    const db = getDb(env.DB);
    const code = "000001";
    await seedFund(code, Date.now());
    await seedNavs(code, ["2026-09-21", "2026-09-22", "2026-09-23"]);

    const series = await ensureNavHistory(db, env, code);

    expect(series).toHaveLength(3);
    const rows = await db.select().from(fundNav).where(eq(fundNav.fundCode, code));
    // 闸门失效时会真的去拉 000001 的长历史并插进来，行数立刻不止 3
    expect(rows).toHaveLength(3);
  });

  it("该尝试时：不论成败都把尝试时间写回（失败也不被每次访问重试）", async () => {
    const db = getDb(env.DB);
    const code = "999999"; // 上游不存在的代码 → 回填拉空
    await seedFund(code, null);
    await seedNavs(code, ["2026-09-21"]);

    const before = Date.now();
    await ensureNavHistory(db, env, code);

    const after = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    expect(after?.navBackfilledAt).not.toBeNull();
    expect(after?.navBackfilledAt ?? 0).toBeGreaterThanOrEqual(before);
  });
});
