// tests/services/pending-buy.test.ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, checkin, dcaPlan, fund, fundNav, holding, orders, session, shareLot, transactions, user } from "~/db/schema";
import { registerUser } from "~/services/auth";
import { getPendingBuyCents } from "~/services/portfolio-service";

/** getPendingBuyCents：/me 总览卡「含申购中」的在途资金口径 */

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

/** 插一笔订单（status/side/amount 由用例定，其余字段与撮合语义无关紧要） */
async function seedOrder(
  userId: number,
  side: "buy" | "sell",
  status: "pending" | "confirmed" | "cancelled",
  amount: number,
) {
  const db = getDb(env.DB);
  await db.insert(orders).values({
    userId,
    fundCode: "000001",
    side,
    status,
    source: "manual",
    amount,
    placeDate: "2026-09-09",
    confirmDate: "2026-09-10",
    createdAt: Date.now(),
  });
}

beforeEach(resetAll);

describe("getPendingBuyCents 在途资金", () => {
  it("只累计 pending 买单：confirmed/cancelled/赎回单都不算", async () => {
    const db = getDb(env.DB);
    const { id: userId } = await registerUser(db, env, "alice", "hunter2");
    const { id: otherId } = await registerUser(db, env, "bob", "hunter2");

    await seedOrder(userId, "buy", "pending", 50_000); // 500 元
    await seedOrder(userId, "buy", "pending", 10_000); // 100 元
    await seedOrder(userId, "buy", "confirmed", 99_999); // 已成交不算
    await seedOrder(userId, "buy", "cancelled", 88_888); // 已撤不算
    await seedOrder(userId, "sell", "pending", 77_777); // 赎回单不算（金额语义也不是冻结现金）
    await seedOrder(otherId, "buy", "pending", 66_666); // 别人的单不算

    expect(await getPendingBuyCents(db, userId)).toBe(60_000);
    expect(await getPendingBuyCents(db, otherId)).toBe(66_666);
  });

  it("没有任何订单时返回 0", async () => {
    const db = getDb(env.DB);
    const { id: userId } = await registerUser(db, env, "alice", "hunter2");
    expect(await getPendingBuyCents(db, userId)).toBe(0);
  });
});
