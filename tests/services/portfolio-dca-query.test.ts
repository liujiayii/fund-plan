import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, checkin, dcaPlan, fund, fundNav, holding, orders, session, shareLot, transactions, user } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { createDcaPlan } from "~/services/dca-service";
import { getDcaPlans } from "~/services/portfolio-service";

/** getDcaPlans 的按基金过滤：持仓详情页定投页签的查询 */

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

async function seedFund(code: string) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: `测试基金${code}`,
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

describe("getDcaPlans 按基金过滤", () => {
  it("不传 fundCode 返回全部；传了只返回该基金的", async () => {
    const db = getDb(env.DB);
    await seedFund("000001");
    await seedFund("000002");
    const { id: userId } = await registerUser(db, env, "alice", "hunter2");
    const now = new Date("2026-08-24T06:00:00Z");

    await createDcaPlan(db, { userId, fundCode: "000001", amountCents: 50000, frequency: "monthly", dayOfMonth: 15, now });
    await createDcaPlan(db, { userId, fundCode: "000002", amountCents: 30000, frequency: "weekly", dayOfWeek: 1, now });

    const all = await getDcaPlans(db, userId);
    expect(all).toHaveLength(2);

    const only1 = await getDcaPlans(db, userId, "000001");
    expect(only1).toHaveLength(1);
    expect(only1[0].fundCode).toBe("000001");
    expect(only1[0].fundName).toBe("测试基金000001");
  });

  it("该基金没有计划时返回空数组", async () => {
    const db = getDb(env.DB);
    await seedFund("000001");
    const { id: userId } = await registerUser(db, env, "alice", "hunter2");
    expect(await getDcaPlans(db, userId, "000001")).toEqual([]);
  });
});
