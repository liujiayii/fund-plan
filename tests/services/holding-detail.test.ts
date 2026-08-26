import { env } from "cloudflare:test";
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
import { getHoldingDetail, getOrdersByFund } from "~/services/portfolio-service";

async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [transactions, shareLot, holding, orders, dcaPlan, checkin, session, account, user, fundNav, fund])
    await db.delete(t);
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
async function seedNav(navDate: string, unitNav: number, code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fundNav).values({ fundCode: code, navDate, unitNav, accNav: unitNav, growthRate: 0 });
}
async function seedUser(name = "alice") {
  return (await registerUser(getDb(env.DB), env, name, "hunter2")).id;
}

beforeEach(resetAll);

describe("getHoldingDetail", () => {
  it("返回同源估值 + 批次升序 + 待赎回占用 + 费率档", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 12345); // 1.2345
    const userId = await seedUser();
    // 持仓汇总：2000 份（×10000=20000000），成本 2000 元（=200000 分）
    await db.insert(holding).values({ userId, fundCode: "000001", totalShares: 20000000, totalCost: 200000 });
    // 两批：老批 2026-01-05 1200 份、新批 2026-08-01 800 份
    await db.insert(shareLot).values([
      { userId, fundCode: "000001", shares: 12000000, cost: 120000, confirmDate: "2026-01-05", orderId: 1 },
      { userId, fundCode: "000001", shares: 8000000, cost: 80000, confirmDate: "2026-08-01", orderId: 2 },
    ]);
    // 一笔待确认赎回 500 份（×10000=5000000）
    await db.insert(orders).values({
      userId,
      fundCode: "000001",
      side: "sell",
      status: "pending",
      source: "manual",
      amount: null,
      shares: 5000000,
      placeDate: "2026-08-26",
      confirmDate: "2026-08-27",
      createdAt: 1,
    });

    const d = await getHoldingDetail(db, userId, "000001");
    expect(d).not.toBeNull();
    expect(d!.fundName).toBe("测试成长混合");
    expect(d!.fundType).toBe("混合型");
    expect(d!.navDate).toBe("2026-08-25");
    expect(d!.sharesScaled).toBe(20000000);
    // 市值 = 2000 份 × 1.2345 × 100 = 246900 分
    expect(d!.marketValueCents).toBe(246900);
    // 批次 FIFO 升序：老批在前
    expect(d!.lots.map(l => l.confirmDate)).toEqual(["2026-01-05", "2026-08-01"]);
    expect(d!.pendingShares).toBe(5000000);
    expect(d!.availableShares).toBe(15000000);
    expect(d!.tiers).toEqual(DEFAULT_REDEEM_TIERS);
    expect(d!.purchaseRate).toBe(150);
    expect(d!.minPurchase).toBe(1000);
  });

  it("无持仓返回 null", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    expect(await getHoldingDetail(db, userId, "000001")).toBeNull();
  });
});

describe("getOrdersByFund", () => {
  it("只返回该基金的订单（倒序），带基金名", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedFund("000002");
    const userId = await seedUser();
    await db.insert(orders).values([
      { userId, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 100000, shares: null, placeDate: "2026-08-20", confirmDate: "2026-08-21", createdAt: 1 },
      { userId, fundCode: "000002", side: "buy", status: "confirmed", source: "manual", amount: 200000, shares: null, placeDate: "2026-08-21", confirmDate: "2026-08-22", createdAt: 2 },
      { userId, fundCode: "000001", side: "sell", status: "pending", source: "manual", amount: null, shares: 5000000, placeDate: "2026-08-26", confirmDate: "2026-08-27", createdAt: 3 },
    ]);
    const list = await getOrdersByFund(db, userId, "000001");
    expect(list.map(o => [o.fundCode, o.side, o.status, o.createdAt])).toEqual([
      ["000001", "sell", "pending", 3],
      ["000001", "buy", "confirmed", 1],
    ]);
    expect(list.every(o => o.fundName === "测试成长混合")).toBe(true);
  });
});
