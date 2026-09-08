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
import { getHoldingBrief, getHoldingDetail } from "~/services/portfolio-service";
import { settlePendingOrders } from "~/services/settle";
import { placeBuyOrder, placeSellOrder } from "~/services/trade";

/** getHoldingBrief 的接线测试：真实 D1 + 真实撮合（seed 手法照抄 profit-detail.test.ts） */

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

async function seedUser(name = "alice") {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

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

beforeEach(resetAll);

describe("getHoldingBrief 已持有速览", () => {
  it("无持仓 / 从未买过 → null", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    expect(await getHoldingBrief(db, userId, "000001")).toBeNull();
  });

  it("有持仓：与 getHoldingDetail 同源估值，一字不差", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 北京 08-24 15:30 买 1000 元 → 08-25 确认 @1.5
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await seedNav("2026-08-25", 15000);
    await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));

    const brief = await getHoldingBrief(db, userId, "000001");
    const detail = await getHoldingDetail(db, userId, "000001");
    expect(brief).not.toBeNull();
    expect(detail).not.toBeNull();
    // 同源估值契约：基金页「已持有」两格与持仓详情页数字必须一字不差
    expect(brief!.marketValueCents).toBe(detail!.marketValueCents);
    expect(brief!.pnlCents).toBe(detail!.pnlCents);
    expect(brief!.pnlRate).toBe(detail!.pnlRate);
  });

  it("全赎清仓后（份额归零）→ null", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 08-24 买 → 08-25 确认；08-25 全赎 → 08-26 确认（走平）
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await seedNav("2026-08-25", 15000);
    await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));

    const [o] = await db.select().from(orders).where(eq(orders.userId, userId));
    await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: o.dealShares!,
      now: new Date("2026-08-25T07:30:00Z"),
    });
    await seedNav("2026-08-26", 15000);
    const r2 = await settlePendingOrders(db, env, new Date("2026-08-26T12:30:00Z"));
    expect(r2.confirmed).toBe(1);

    // holding 行清零（或删除）后不再算「已持有」
    expect(await getHoldingBrief(db, userId, "000001")).toBeNull();
  });
});
