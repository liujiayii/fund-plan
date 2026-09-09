import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
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
import { fundMarketValueCents } from "~/domain/portfolio";
import { calcPurchase } from "~/domain/purchase";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getFundProfitDetail, getProfitDetail } from "~/services/asset-service";
import { registerUser } from "~/services/auth";
import { settlePendingOrders } from "~/services/settle";
import { placeBuyOrder } from "~/services/trade";

/** getFundProfitDetail 的接线测试：真实 D1 + 真实撮合 */

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

describe("getFundProfitDetail 单基金收益明细", () => {
  it("买入后两日：首日 = −申购费，次日 = 份额×净值变动；latest/firstDate/cumulative 齐整", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // init 流水用的是真实时钟（运行测试的当天），会把「今天」并进 dateAxis——
    // 归因在那天给基金出前向填充的 0 收益条目，dailyPnl/latest 就越出场景区间。
    // 回拨到场景前夜，让 dateAxis 收口在受控日期里（profit-detail.test.ts 首测
    // 注释记载的同款手法——那边为账本日期序，这里为 dateAxis 收口）。
    await db
      .update(transactions)
      .set({ createdAt: new Date("2026-08-23T02:00:00Z").getTime() })
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "init")));

    // 北京 08-24 15:30 买 1000 元 → 08-25 确认 @1.5
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await seedNav("2026-08-25", 15000);
    await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));

    // 08-26 净值涨到 1.56（无新订单，归因只吃已确认单与净值，不必再 settle）
    await seedNav("2026-08-26", 15600);

    const detail = await getFundProfitDetail(db, userId, "000001");
    const calc = calcPurchase({ amountCents: 100000, navScaled: 15000, purchaseRate: 150 });

    // 首日：确认日 = −申购费（内扣法，当日无净值差）；dayNavRate 首见净值日记 0
    expect(detail.dailyPnl[0]).toEqual({ date: "2026-08-25", dayPnlCents: -calc.feeCents, dayNavRate: 0 });
    // 次日：市值变动（份额×Δ净值，取整入口与归因同源，期望值也走它算）；
    // 涨跌幅 = 1.56/1.50 − 1 = 0.04
    const mv1 = fundMarketValueCents(calc.sharesScaled, 15000);
    const mv2 = fundMarketValueCents(calc.sharesScaled, 15600);
    expect(detail.dailyPnl[1]).toEqual({ date: "2026-08-26", dayPnlCents: mv2 - mv1, dayNavRate: 0.04 });
    expect(detail.dailyPnl).toHaveLength(2);

    expect(detail.firstDate).toBe("2026-08-25");
    expect(detail.latest).toEqual({ date: "2026-08-26", dayPnlCents: mv2 - mv1, dayNavRate: 0.04 });
    // 累计末值 === Σ每日（cumulateFundPnl 的不变量）
    expect(detail.cumulative.at(-1)!.cumPnlCents)
      .toBe(detail.dailyPnl.reduce((s, d) => s + d.dayPnlCents, 0));
  });

  it("多基金用户：只出目标基金条目，且与全局归因逐日相等", async () => {
    const db = getDb(env.DB);
    await seedFund("000001");
    await seedFund("000002");
    const userId = await seedUser();

    // init 流水回拨到场景前夜：控制 dateAxis 收口（同上一测的注记）
    await db
      .update(transactions)
      .set({ createdAt: new Date("2026-08-23T02:00:00Z").getTime() })
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "init")));

    // 两只基金各买一笔，同日确认
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000002",
      amountCents: 50000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await seedNav("2026-08-25", 15000, "000001");
    await seedNav("2026-08-25", 20000, "000002");
    const r = await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));
    expect(r.confirmed).toBe(2);

    const one = await getFundProfitDetail(db, userId, "000002");
    const global = await getProfitDetail(db, userId);

    const calc2 = calcPurchase({ amountCents: 50000, navScaled: 20000, purchaseRate: 150 });
    expect(one.dailyPnl).toHaveLength(1);
    expect(one.dailyPnl[0]!.dayPnlCents).toBe(-calc2.feeCents);
    // 与全局视图逐日对账：单基金读取路径 === 全量归因里该基金的条目（同源证明）
    for (const p of one.dailyPnl) {
      const g = global.fundPnlByDate[p.date]!.find(f => f.fundCode === "000002")!;
      expect(g.dayPnlCents).toBe(p.dayPnlCents);
    }
  });

  it("从未持有的基金：全空", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const detail = await getFundProfitDetail(db, userId, "000001");
    expect(detail.dailyPnl).toEqual([]);
    expect(detail.latest).toBeNull();
    expect(detail.cumulative).toEqual([]);
    expect(detail.firstDate).toBeNull();
  });
});
