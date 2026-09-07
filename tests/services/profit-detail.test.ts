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
import { calcPurchase } from "~/domain/purchase";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getAssetTimeline, getProfitDetail } from "~/services/asset-service";
import { registerUser } from "~/services/auth";
import { settlePendingOrders } from "~/services/settle";
import { placeBuyOrder, placeSellOrder } from "~/services/trade";

/** getProfitDetail / getAssetTimeline 的接线测试：真实 D1 + 真实撮合 */

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

describe("getAssetTimeline 累计投入", () => {
  it("无签到时 totalDepositedCents = 初始本金 10 万", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const { totalDepositedCents } = await getAssetTimeline(db, userId);
    expect(totalDepositedCents).toBe(10_000_000);
  });
});

describe("getProfitDetail 按基金归因（端到端）", () => {
  it("买入确认日：归因条目 = −申购费，基金名齐全，逐日 Σ归因 === dayPnl", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // registerUser 用真实时钟写 init 流水（运行测试的当天），而下面的订单用
    // 注入时钟（08-24）——init 会晚于买单出现在账本，前向填充在注册日取到
    // 过期余额，制造 dayPnl=−9.9M 的幻影日（asset-timeline.test.ts 首测注释
    // 记载的同款陷阱）。把 init 流水回拨到场景前夜，账本日期序与真实序一致，
    // 「逐日 Σ归因 === dayPnl」不变量才能在每一天成立。
    await db
      .update(transactions)
      .set({ createdAt: new Date("2026-08-23T02:00:00Z").getTime() })
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "init")));

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

    const detail = await getProfitDetail(db, userId);
    const calc = calcPurchase({ amountCents: 100000, navScaled: 15000, purchaseRate: 150 });
    const entries = detail.fundPnlByDate["2026-08-25"]!;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fundCode).toBe("000001");
    expect(entries[0]!.dayPnlCents).toBe(-calc.feeCents);
    expect(detail.fundNames["000001"]).toBe("测试成长混合");

    // 端到端不变量：每天 Σ归因 === dayPnlCents（cashCents 映射对不对一眼便知）
    for (const d of detail.daily) {
      const sum = (detail.fundPnlByDate[d.date] ?? []).reduce((s, f) => s + f.dayPnlCents, 0);
      expect(sum).toBe(d.dayPnlCents);
    }
  });

  it("赎回确认日：归因条目 = −赎回费（净值走平），与当日总收益一致", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 08-24 15:30 买 → 08-25 确认 @1.5
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T07:30:00Z"),
    });
    await seedNav("2026-08-25", 15000);
    await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));

    // 08-25 15:30 全赎 → 08-26 确认 @1.5（走平）
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

    const detail = await getProfitDetail(db, userId);
    const d26 = detail.fundPnlByDate["2026-08-26"]!;
    expect(d26).toHaveLength(1);
    // 净值走平 + 赎回费 → 当日该基金收益为负（−赎回费）
    expect(d26[0]!.dayPnlCents).toBeLessThan(0);
    // 单基金场景下它就等于当日总收益（不变量的卖出口径）
    const day = detail.daily.find(d => d.date === "2026-08-26")!;
    expect(d26.reduce((s, f) => s + f.dayPnlCents, 0)).toBe(day.dayPnlCents);
  });

  it("新用户（仅 init 流水）：无归因条目、每日收益全为 0", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    const detail = await getProfitDetail(db, userId);
    // 注册即写 init 流水 → dateAxis 至少有入金日一天（daily 不会是空数组）
    expect(detail.daily.length).toBeGreaterThanOrEqual(1);
    expect(detail.daily.every(d => d.dayPnlCents === 0)).toBe(true);
    expect(detail.fundPnlByDate).toEqual({});
  });
});
