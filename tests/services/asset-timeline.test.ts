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
import { calcPurchase } from "~/domain/purchase";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getAssetTimeline } from "~/services/asset-service";
import { registerUser } from "~/services/auth";
import { settlePendingOrders } from "~/services/settle";
import { amendOrder, cancelOrder, placeBuyOrder } from "~/services/trade";

/**
 * getAssetTimeline 的在途申购口径（2026-09-01 修复的 bug 的回归测试）：
 * 买单下单即冻结现金、T+1 才长份额。冻结期间这笔钱必须计为「在途资产」，
 * 否则下单日单日收益显示为 -申购总额 的假亏损。
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

describe("getAssetTimeline 在途申购", () => {
  it("当日下单未撮合：在途=委托金额，dayPnl=0（非 -委托额 假亏损）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 用真实时钟下单（注册也是真实时钟，账本日期才不会乱序——
    // 混用注入时间会让 init 流水晚于买入流水，前向填充取错余额）
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
    });

    const { daily, latest } = await getAssetTimeline(db, userId);
    expect(latest).not.toBeNull();
    // 现金 10M − 100000 + 在途 100000 = 10M，dayPnl=0
    expect(latest!.transitCents).toBe(100000);
    expect(latest!.totalAssetCents).toBe(10_000_000);
    expect(latest!.dayPnlCents).toBe(0);
    // 累计收益也不含假亏损
    expect(daily.reduce((s, d) => s + d.dayPnlCents, 0)).toBe(0);
  });

  it("当日改单：在途随新委托额走（97300 改 93600 → 在途 93600）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 97300,
    });
    await amendOrder(db, userId, orderId, { amountCents: 93600 });

    const { latest } = await getAssetTimeline(db, userId);
    expect(latest!.transitCents).toBe(93600);
    expect(latest!.totalAssetCents).toBe(10_000_000);
    expect(latest!.dayPnlCents).toBe(0);
  });

  it("15:00 后下单次日确认：下单日 dayPnl=0，确认日 dayPnl=−申购费", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 北京 15:30 下单 → 确认日 08-25
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await seedNav("2026-08-25", 15000);
    const r = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-25T12:30:00Z"), // 北京 20:30 撮合
    );
    expect(r.confirmed).toBe(1);

    const { daily } = await getAssetTimeline(db, userId);
    const d1 = daily.find(d => d.date === "2026-08-24")!;
    const d2 = daily.find(d => d.date === "2026-08-25")!;
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();

    // 下单日：现金 9900000 + 在途 100000 = 10M，dayPnl=0（旧代码这里是 -100000）
    expect(d1.transitCents).toBe(100000);
    expect(d1.totalAssetCents).toBe(10_000_000);
    expect(d1.dayPnlCents).toBe(0);

    // 确认日：在途归零换市值，dayPnl 恰好 = −申购费（费用在确认日记损）
    const calc = calcPurchase({ amountCents: 100000, navScaled: 15000, purchaseRate: 150 });
    expect(d2.transitCents).toBe(0);
    expect(d2.dayPnlCents).toBe(-calc.feeCents);
  });

  it("撤单：现金退回、在途归零，全程无假损益", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
    });
    await cancelOrder(db, userId, orderId);

    const { daily } = await getAssetTimeline(db, userId);
    // 每一天 dayPnl 都是 0（init 首日 + 撤单日），在途最终归零
    expect(daily.every(d => d.dayPnlCents === 0)).toBe(true);
    expect(daily[daily.length - 1].transitCents).toBe(0);
    expect(daily[daily.length - 1].totalAssetCents).toBe(10_000_000);
  });
});
