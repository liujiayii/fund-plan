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
import { reconcile } from "~/domain/portfolio";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { settlePendingOrders } from "~/services/settle";
import { placeBuyOrder, placeSellOrder } from "~/services/trade";

/**
 * 撮合引擎——全系统最关键的一环。
 *
 * 必须验证的性质：
 *  1. 买单确认后：份额批次生成、持仓累加、订单回填成交信息
 *  2. 卖单确认后：FIFO 消耗批次、持仓递减、现金入账、扣赎回费
 *  3. **幂等**：重复执行不重复成交（Cron 会重试！）
 *  4. 净值缺失时订单保持 pending 顺延，而不是判失败
 *  5. 撮合后 Σshare_lot === holding（对账一致）
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
    purchaseRate: 150, // 1.5%
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

/** 写入某日净值 */
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

async function seedUser(name = "alice") {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

beforeEach(resetAll);

describe("settlePendingOrders 买单确认", () => {
  it("按确认日净值成交：生成份额批次、累加持仓、回填订单", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 下单：1000 元，确认日 2026-08-24
    const buy = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    // 当日净值 1.5000
    await seedNav("2026-08-24", 15000);

    const r = await settlePendingOrders(db, env, new Date("2026-08-24T12:30:00Z"));
    expect(r.confirmed).toBe(1);
    expect(r.failed).toBe(0);

    // 订单已确认，成交信息回填（内扣法：净申购 98522，费 1478，份额 6568133）
    const o = await db.query.orders.findFirst({
      where: eq(orders.id, buy.orderId),
    });
    expect(o!.status).toBe("confirmed");
    expect(o!.dealNav).toBe(15000);
    expect(o!.dealShares).toBe(6568133);
    expect(o!.dealAmount).toBe(98522);
    expect(o!.fee).toBe(1478);

    // 生成一个份额批次，成本为净申购 + 费用（即全部申购金额）
    const lots = await db
      .select()
      .from(shareLot)
      .where(eq(shareLot.userId, userId));
    expect(lots).toHaveLength(1);
    expect(lots[0].shares).toBe(6568133);
    expect(lots[0].cost).toBe(100000); // 成本含申购费
    expect(lots[0].confirmDate).toBe("2026-08-24");
    expect(lots[0].orderId).toBe(buy.orderId);

    // 持仓汇总同步
    const h = await db.query.holding.findFirst({
      where: and(eq(holding.userId, userId), eq(holding.fundCode, "000001")),
    });
    expect(h!.totalShares).toBe(6568133);
    expect(h!.totalCost).toBe(100000);

    // 对账一致
    expect(
      reconcile(
        lots.map(l => ({ sharesScaled: l.shares, costCents: l.cost })),
        { totalSharesScaled: h!.totalShares, totalCostCents: h!.totalCost },
      ),
    ).toBe(true);
  });

  it("第二次买入累加到已有持仓，并新增一个批次", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedNav("2026-08-24", 15000);
    await seedNav("2026-08-25", 16000);

    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });
    await settlePendingOrders(db, env, new Date("2026-08-24T12:30:00Z"));

    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-25T06:00:00Z"),
    });
    await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));

    const lots = await db
      .select()
      .from(shareLot)
      .where(eq(shareLot.userId, userId));
    expect(lots).toHaveLength(2);

    const h = await db.query.holding.findFirst({
      where: and(eq(holding.userId, userId), eq(holding.fundCode, "000001")),
    });
    const sumShares = lots.reduce((s, l) => s + l.shares, 0);
    const sumCost = lots.reduce((s, l) => s + l.cost, 0);
    expect(h!.totalShares).toBe(sumShares);
    expect(h!.totalCost).toBe(sumCost);
    expect(h!.totalCost).toBe(200000);
  });

  it("幂等：重复撮合不重复成交", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedNav("2026-08-24", 15000);

    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const first = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-24T12:30:00Z"),
    );
    expect(first.confirmed).toBe(1);

    // 再跑两次，模拟 Cron 重试
    const second = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-24T12:35:00Z"),
    );
    const third = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-24T12:40:00Z"),
    );
    expect(second.confirmed).toBe(0);
    expect(third.confirmed).toBe(0);

    // 批次不重复、持仓不翻倍
    const lots = await db
      .select()
      .from(shareLot)
      .where(eq(shareLot.userId, userId));
    expect(lots).toHaveLength(1);

    const h = await db.query.holding.findFirst({
      where: and(eq(holding.userId, userId), eq(holding.fundCode, "000001")),
    });
    expect(h!.totalShares).toBe(6568133);
    expect(h!.totalCost).toBe(100000);
  });

  it("确认日净值缺失时订单保持 pending（顺延，不判失败）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const buy = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });
    // 故意不写净值

    const r = await settlePendingOrders(db, env, new Date("2026-08-24T12:30:00Z"));
    expect(r.confirmed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);

    const o = await db.query.orders.findFirst({
      where: eq(orders.id, buy.orderId),
    });
    expect(o!.status).toBe("pending"); // 仍待确认

    // 补上净值后应能成交
    await seedNav("2026-08-24", 15000);
    const r2 = await settlePendingOrders(db, env, new Date("2026-08-25T12:30:00Z"));
    expect(r2.confirmed).toBe(1);
  });

  it("确认日还没到的订单不被撮合", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 周五 16:00 下单 → 确认日 2026-08-24（下周一）
    await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-21T08:00:00Z"),
    });
    await seedNav("2026-08-24", 15000);

    // 在 8/21 晚上跑撮合，确认日还没到
    const r = await settlePendingOrders(db, env, new Date("2026-08-21T12:30:00Z"));
    expect(r.confirmed).toBe(0);
  });
});

describe("settlePendingOrders 卖单确认", () => {
  /** 造出一个已确认的持仓（含两个不同日期的批次） */
  async function seedTwoLots(userId: number) {
    const db = getDb(env.DB);
    await db.batch([
      db.insert(shareLot).values([
        {
          userId,
          fundCode: "000001",
          shares: 10_000_000, // 1000 份
          cost: 150000, // 1500 元
          confirmDate: "2026-01-05",
        },
        {
          userId,
          fundCode: "000001",
          shares: 5_000_000, // 500 份
          cost: 80000, // 800 元
          confirmDate: "2026-08-01",
        },
      ]),
      db.insert(holding).values({
        userId,
        fundCode: "000001",
        totalShares: 15_000_000,
        totalCost: 230000,
      }),
    ]);
  }

  it("FIFO 消耗批次、扣赎回费、现金入账", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedTwoLots(userId);
    await seedNav("2026-08-20", 16000); // 净值 1.6

    const sell = await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 12_000_000, // 赎 1200 份
      now: new Date("2026-08-20T06:00:00Z"),
    });

    const before = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });

    const r = await settlePendingOrders(db, env, new Date("2026-08-20T12:30:00Z"));
    expect(r.confirmed).toBe(1);

    // 订单回填：总额 192000，费 960，到账 191040
    const o = await db.query.orders.findFirst({
      where: eq(orders.id, sell.orderId),
    });
    expect(o!.status).toBe("confirmed");
    expect(o!.dealNav).toBe(16000);
    expect(o!.dealShares).toBe(12_000_000);
    expect(o!.fee).toBe(960);
    expect(o!.dealAmount).toBe(191040); // 到账净额

    // 现金增加到账金额
    const after = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(after!.cash).toBe(before!.cash + 191040);

    // 老批次被吃光（应删除），新批次剩 300 份
    const lots = await db
      .select()
      .from(shareLot)
      .where(eq(shareLot.userId, userId));
    expect(lots).toHaveLength(1);
    expect(lots[0].confirmDate).toBe("2026-08-01");
    expect(lots[0].shares).toBe(3_000_000); // 500 - 200 = 300 份
    expect(lots[0].cost).toBe(48000); // 800 - 320 = 480 元

    // 持仓递减且与批次对账一致
    const h = await db.query.holding.findFirst({
      where: and(eq(holding.userId, userId), eq(holding.fundCode, "000001")),
    });
    expect(h!.totalShares).toBe(3_000_000);
    expect(h!.totalCost).toBe(48000);
    expect(
      reconcile(
        lots.map(l => ({ sharesScaled: l.shares, costCents: l.cost })),
        { totalSharesScaled: h!.totalShares, totalCostCents: h!.totalCost },
      ),
    ).toBe(true);
  });

  it("全部赎回后持仓清零、批次清空", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedTwoLots(userId);
    await seedNav("2026-08-20", 16000);

    await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 15_000_000, // 全赎
      now: new Date("2026-08-20T06:00:00Z"),
    });
    await settlePendingOrders(db, env, new Date("2026-08-20T12:30:00Z"));

    const lots = await db
      .select()
      .from(shareLot)
      .where(eq(shareLot.userId, userId));
    expect(lots).toHaveLength(0);

    const h = await db.query.holding.findFirst({
      where: and(eq(holding.userId, userId), eq(holding.fundCode, "000001")),
    });
    expect(h!.totalShares).toBe(0);
    expect(h!.totalCost).toBe(0);
  });

  it("卖单确认写两条流水：到账 sell 与手续费 fee", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedTwoLots(userId);
    await seedNav("2026-08-20", 16000);

    await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 12_000_000,
      now: new Date("2026-08-20T06:00:00Z"),
    });
    await settlePendingOrders(db, env, new Date("2026-08-20T12:30:00Z"));

    const sellTx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.type, "sell"));
    expect(sellTx).toHaveLength(1);
    expect(sellTx[0].amount).toBe(191040); // 入账为正

    const feeTx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.type, "fee"));
    expect(feeTx).toHaveLength(1);
    expect(feeTx[0].amount).toBe(-960); // 手续费记为负
  });

  it("幂等：重复撮合卖单不重复入账", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedTwoLots(userId);
    await seedNav("2026-08-20", 16000);

    await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 12_000_000,
      now: new Date("2026-08-20T06:00:00Z"),
    });

    await settlePendingOrders(db, env, new Date("2026-08-20T12:30:00Z"));
    const afterFirst = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });

    await settlePendingOrders(db, env, new Date("2026-08-20T12:35:00Z"));
    const afterSecond = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });

    expect(afterSecond!.cash).toBe(afterFirst!.cash);
  });
});

describe("settlePendingOrders 混合场景", () => {
  it("多用户多订单一次撮合，互不干扰", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    await seedNav("2026-08-24", 15000);

    await placeBuyOrder(db, env, {
      userId: alice,
      fundCode: "000001",
      amountCents: 100000,
      now: new Date("2026-08-24T06:00:00Z"),
    });
    await placeBuyOrder(db, env, {
      userId: bob,
      fundCode: "000001",
      amountCents: 200000,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const r = await settlePendingOrders(db, env, new Date("2026-08-24T12:30:00Z"));
    expect(r.confirmed).toBe(2);

    const aliceH = await db.query.holding.findFirst({
      where: and(eq(holding.userId, alice), eq(holding.fundCode, "000001")),
    });
    const bobH = await db.query.holding.findFirst({
      where: and(eq(holding.userId, bob), eq(holding.fundCode, "000001")),
    });
    expect(aliceH!.totalCost).toBe(100000);
    expect(bobH!.totalCost).toBe(200000);
    // bob 投入是 alice 两倍，份额也应约为两倍。
    // 注意不能断言精确 2 倍：两笔申购各自独立四舍五入，
    // round(100000/1.015)=98522 而 round(200000/1.015)=197044（≠98522×2），
    // 传导到份额会有 1 个最小单位（0.0001 份）的差异，这是正确行为。
    expect(bobH!.totalShares).toBeGreaterThanOrEqual(aliceH!.totalShares * 2 - 2);
    expect(bobH!.totalShares).toBeLessThanOrEqual(aliceH!.totalShares * 2 + 2);
  });

  it("没有待确认订单时返回全零，不报错", async () => {
    const db = getDb(env.DB);
    const r = await settlePendingOrders(db, env, new Date("2026-08-24T12:30:00Z"));
    expect(r).toEqual({ confirmed: 0, skipped: 0, failed: 0 });
  });
});
