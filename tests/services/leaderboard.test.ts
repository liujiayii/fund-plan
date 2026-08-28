// tests/services/leaderboard.test.ts
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
import { getLeaderboard } from "~/services/leaderboard-service";

/** 与 settle.test.ts 同款的清理/造数范式 */
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

/** 写入某日净值（×10000） */
async function seedNav(navDate: string, unitNav: number, code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fundNav).values({
    fundCode: code,
    navDate,
    unitNav,
    accNav: unitNav,
    growthRate: 0,
  });
}

async function seedUser(name: string) {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

/**
 * 造一笔已确认订单（只为了过「hasTrades」门槛，成交数字不重要）。
 * placeBuyOrder + settle 太重，直接插 orders 行——排行榜只看 status。
 */
async function seedConfirmedOrder(userId: number) {
  const db = getDb(env.DB);
  await db.insert(orders).values({
    userId,
    fundCode: "000001",
    side: "buy",
    status: "confirmed",
    source: "manual",
    amount: 100_000,
    placeDate: "2026-08-24",
    confirmDate: "2026-08-25",
    dealNav: 15_000,
    dealShares: 6_568_133,
    dealAmount: 98_522,
    fee: 1_478,
    createdAt: Date.parse("2026-08-24T06:00:00Z"),
  });
}

beforeEach(resetAll);

describe("getLeaderboard", () => {
  it("空库返回空榜", async () => {
    const db = getDb(env.DB);
    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(0);
    expect(lb.byPnl).toHaveLength(0);
  });

  it("三用户：门槛过滤 + 市值估值 + 两维排序", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 15_000); // 净值 1.5

    // alice：10 万入金，花 2000 元买 2000 份（份额 ×10000 存 20_000_000），
    // 成本 200_000 分；现金 9.8 万。净值 1.5 → 市值 300_000 分，
    // 总资产 10_100_000，收益 +100_000（+1%）
    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 20_000_000,
      totalCost: 200_000,
    });
    await db
      .update(account)
      .set({ cash: 9_800_000 })
      .where(eq(account.userId, alice));

    // bob：纯签到 1000 元、无成交 → 不上榜
    const bob = await seedUser("bob");
    await db
      .update(account)
      .set({ cash: 10_010_000, totalCheckin: 10_000 })
      .where(eq(account.userId, bob));

    // carol：10 万入金，空仓现金 10.5 万 → 收益 +5%
    const carol = await seedUser("carol");
    await seedConfirmedOrder(carol);
    await db
      .update(account)
      .set({ cash: 10_500_000 })
      .where(eq(account.userId, carol));

    const lb = await getLeaderboard(db);

    // bob 被门槛过滤；carol(+5%) 压过 alice(+1%)
    expect(lb.byRate.map(e => e.username)).toEqual(["carol", "alice"]);
    expect(lb.byRate[0].totalPnlRate).toBeCloseTo(0.05, 10);
    // alice：市值 = 2000 份 × 1.5 × 100 = 300_000 分
    expect(lb.byRate[1].marketValueCents).toBe(300_000);
    expect(lb.byRate[1].totalAssetCents).toBe(10_100_000);
    expect(lb.byRate[1].totalPnlCents).toBe(100_000);
    // 总收益榜同序（+500_000 > +100_000）
    expect(lb.byPnl.map(e => e.username)).toEqual(["carol", "alice"]);
  });

  it("持仓无净值时用成本兜底（市值 = 成本，盈亏为 0）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    // 注意：不 seedNav——holding 有持仓但 fund_nav 空

    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 20_000_000,
      totalCost: 200_000,
    });
    await db
      .update(account)
      .set({ cash: 9_800_000 })
      .where(eq(account.userId, alice));

    const lb = await getLeaderboard(db);
    // 无净值 → 市值按成本 200_000 兜底 → 总资产 10 万，收益 0
    expect(lb.byRate[0].marketValueCents).toBe(200_000);
    expect(lb.byRate[0].totalPnlCents).toBe(0);
  });

  it("pending/failed 订单不算门槛", async () => {
    const db = getDb(env.DB);
    const alice = await seedUser("alice");
    await db.insert(orders).values({
      userId: alice,
      fundCode: "000001",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 100_000,
      placeDate: "2026-08-24",
      confirmDate: "2026-08-25",
      createdAt: Date.now(),
    });

    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(0);
  });
});
