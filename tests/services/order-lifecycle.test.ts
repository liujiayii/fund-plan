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
import { registerUser } from "~/services/auth";
import { failOrder, settleBuyOrder, settlePendingOrders, settleSellOrder } from "~/services/settle";
import { amendOrder, cancelOrder, placeBuyOrder, placeSellOrder } from "~/services/trade";

/**
 * 撤单 / 改单服务。核心约束：
 *  - 买单撤单必须退回冻结现金并追加冲正流水（账本只增不改）
 *  - 赎回单撤单不动钱，份额占用随状态变化自动释放
 *  - 改单（原单直改）按差额调整现金，买卖规则与首次下单一致
 *  - 与撮合 cron 竞态时：守卫失效应整体无效，绝不出现「已确认还退钱」
 */

/** 清空所有表（与 trade.test.ts 同款） */
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

/** 建一只测试基金（起购 10 元） */
async function seedFund(code = "000001", minPurchase = 1000) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试成长混合",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

/** 注册一个用户并返回 id */
async function seedUser(name = "alice") {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

/** 给用户造一笔持仓（默认 1000 份，成本 1500 元） */
async function seedHolding(userId: number, sharesScaled = 10_000_000) {
  const db = getDb(env.DB);
  await db.batch([
    db.insert(holding).values({
      userId,
      fundCode: "000001",
      totalShares: sharesScaled,
      totalCost: 150000,
    }),
    db.insert(shareLot).values({
      userId,
      fundCode: "000001",
      shares: sharesScaled,
      cost: 150000,
      confirmDate: "2026-01-05",
    }),
  ]);
}

const NOW = new Date("2026-08-24T06:00:00Z"); // 北京 14:00，确认日当日

beforeEach(resetAll);

describe("cancelOrder 撤单", () => {
  it("撤待确认买单：置 cancelled、退冻结现金、追加冲正流水", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: NOW,
    });

    await cancelOrder(db, userId, orderId);

    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("cancelled");

    // 退回冻结的 1000 元
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);

    // 账本只增不改：原 buy 流水保留，追加一条 cancel 冲正（正金额入账）
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, orderId));
    expect(txs).toHaveLength(2);
    const cancelTx = txs.find(t => t.type === "cancel")!;
    expect(cancelTx.amount).toBe(100000);
    expect(cancelTx.balance).toBe(10_000_000);
    expect(cancelTx.note).toContain("撤单");
  });

  it("撤待确认赎回单：不动现金、不产生流水，份额占用释放", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId);

    // 先挂 800 份的赎回单
    const { orderId } = await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 8_000_000,
      now: NOW,
    });

    await cancelOrder(db, userId, orderId);

    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("cancelled");

    // 现金不动
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);
    // 赎回单本就没有流水，撤单也不该有
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, orderId));
    expect(txs).toHaveLength(0);

    // 占用释放：1000 份应可全额重新赎回
    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: "000001",
        sharesScaled: 10_000_000,
        now: NOW,
      }),
    ).resolves.toBeTruthy();
  });

  it("撤已确认的订单：拒绝且不动钱", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: NOW,
    });

    // 模拟撮合 cron 抢先确认
    await db
      .update(orders)
      .set({ status: "confirmed" })
      .where(eq(orders.id, orderId));

    await expect(cancelOrder(db, userId, orderId)).rejects.toThrow(
      "只有待确认的订单才能撤销",
    );

    // 双重保险：即使状态守卫失效，现金也绝不能变
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 100000);
    const cancelTxs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.type, "cancel"));
    expect(cancelTxs).toHaveLength(0);
  });

  it("撤已撤销的订单：拒绝（幂等）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: NOW,
    });

    await cancelOrder(db, userId, orderId);
    await expect(cancelOrder(db, userId, orderId)).rejects.toThrow(
      "只有待确认的订单才能撤销",
    );

    // 只退一次钱
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);
  });

  it("撤别人的订单或不存在的订单：拒绝", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    const { orderId } = await placeBuyOrder(db, env, {
      userId: alice,
      fundCode: "000001",
      amountCents: 100000,
      now: NOW,
    });

    await expect(cancelOrder(db, bob, orderId)).rejects.toThrow("订单不存在");
    await expect(cancelOrder(db, alice, 99999)).rejects.toThrow("订单不存在");
  });
});

describe("amendOrder 改单（原单直改）", () => {
  it("买单改小金额：订单更新、退差额现金、追加 amend 流水", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 97300,
      now: NOW,
    });

    await amendOrder(db, userId, orderId, { amountCents: 93600 });

    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("pending");
    expect(o!.amount).toBe(93600);

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 93600);

    // 只增不改：buy 流水（-97300）保留，追加 amend（+3700）
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, orderId));
    const amendTx = txs.find(t => t.type === "amend")!;
    expect(amendTx.amount).toBe(3700);
    expect(amendTx.balance).toBe(10_000_000 - 93600);
  });

  it("买单改大金额：补扣差额现金", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 50000,
      now: NOW,
    });

    await amendOrder(db, userId, orderId, { amountCents: 80000 });

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 80000);
    const amendTx = (await db.select().from(transactions))
      .find(t => t.type === "amend")!;
    expect(amendTx.amount).toBe(-30000); // 出账为负
  });

  it("补扣差额超过现金：拒绝且不留脏数据", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 50000,
      now: NOW,
    });

    await expect(
      amendOrder(db, userId, orderId, { amountCents: 10_500_000 }),
    ).rejects.toThrow("现金不足");

    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.amount).toBe(50000); // 原单未动
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 50000);
  });

  it("新金额低于起购额：拒绝", async () => {
    const db = getDb(env.DB);
    await seedFund("000001", 10000); // 起购 100 元
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 50000,
      now: NOW,
    });

    await expect(
      amendOrder(db, userId, orderId, { amountCents: 5000 }),
    ).rejects.toThrow("起购");
  });

  it("改已确认的订单：拒绝且不动钱", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 50000,
      now: NOW,
    });
    await db
      .update(orders)
      .set({ status: "confirmed" })
      .where(eq(orders.id, orderId));

    await expect(
      amendOrder(db, userId, orderId, { amountCents: 80000 }),
    ).rejects.toThrow("只有待确认");
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.amount).toBe(50000);
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 50000);
  });

  it("赎回单改份额：订单更新、不动现金，可改上限排除本单原份额", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId); // 1000 份

    const { orderId } = await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 4_000_000, // 原委托 400 份
      now: NOW,
    });

    // 本单 400 份不占自己的额度，改到 700 份应可过
    await amendOrder(db, userId, orderId, { sharesScaled: 7_000_000 });

    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.shares).toBe(7_000_000);
    expect(o!.status).toBe("pending");

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);

    // 改成 700 后，剩余可赎 300 份：挂 300 份成功、301 份被拒
    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: "000001",
        sharesScaled: 3_000_000,
        now: NOW,
      }),
    ).resolves.toBeTruthy();
    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: "000001",
        sharesScaled: 1_000,
        now: NOW,
      }),
    ).rejects.toThrow(/份额不足/);
  });

  it("赎回单改份额超过可赎额度：拒绝", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId);

    const { orderId } = await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 4_000_000,
      now: NOW,
    });

    // 1000 份全占也不够 1100 份
    await expect(
      amendOrder(db, userId, orderId, { sharesScaled: 11_000_000 }),
    ).rejects.toThrow("份额不足");
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.shares).toBe(4_000_000);
  });

  it("不存在的订单：拒绝", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    await expect(
      amendOrder(db, userId, 99999, { amountCents: 1000 }),
    ).rejects.toThrow("订单不存在");
  });
});

describe("撤单/改单与撮合的交互", () => {
  /** 写入某日净值（与 settle.test.ts 同款） */
  async function seedNav(navDate: string, unitNav: number) {
    const db = getDb(env.DB);
    await db.insert(fundNav).values({
      fundCode: "000001",
      navDate,
      unitNav,
      accNav: unitNav,
      growthRate: 0,
    });
  }

  it("撤单后撮合再跑：已撤单不成交、不记份额、现金已全退", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      now: NOW,
    });

    await cancelOrder(db, userId, orderId);
    await seedNav("2026-08-24", 15000);

    const r = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-24T12:30:00Z"), // 北京 20:30 撮合时刻
    );
    expect(r.confirmed).toBe(0);
    expect(r.skipped).toBe(0); // 撤了的单根本不进 pending 列表
    expect(r.failed).toBe(0);

    // 不产生份额与持仓
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("cancelled");
    expect(await db.select().from(shareLot)).toHaveLength(0);
    expect(await db.select().from(holding)).toHaveLength(0);

    // 现金全退，无多余流水（init 是注册时的初始本金，不算交易）
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);
    const txTypes = (await db.select().from(transactions)).map(t => t.type);
    expect(txTypes).toEqual(["init", "buy", "cancel"]);
  });

  it("改单后撮合按新金额成交", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 97300,
      now: NOW,
    });

    await amendOrder(db, userId, orderId, { amountCents: 93600 });
    await seedNav("2026-08-24", 15000);

    const r = await settlePendingOrders(
      db,
      env,
      new Date("2026-08-24T12:30:00Z"),
    );
    expect(r.confirmed).toBe(1);

    // 成交按 93600 元算（内扣法）
    const calc = calcPurchase({ amountCents: 93600, navScaled: 15000, purchaseRate: 150 });
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("confirmed");
    expect(o!.dealShares).toBe(calc.sharesScaled);
    expect(o!.dealAmount).toBe(calc.netAmountCents);

    // 批次成本 = 新委托金额；现金 = 本金 − 新金额
    const lot = await db.query.shareLot.findFirst({
      where: eq(shareLot.orderId, orderId),
    });
    expect(lot!.cost).toBe(93600);
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 93600);
  });

  it("买单改单竞态：撮合读到旧快照后落改单——过期快照不成交，下轮按新值撮合", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 97300,
      now: NOW,
    });

    // 模拟竞态：撮合先读到 pending 快照（amount=97300），随后用户改单到 93600
    const staleRow = (await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    }))!;
    await amendOrder(db, userId, orderId, { amountCents: 93600 });

    // 撮合拿着过期快照去翻转——守卫必须让路
    const settleTime = new Date("2026-08-24T12:30:00Z");
    const won = await settleBuyOrder(db, staleRow, 15000, settleTime);
    expect(won).toBe(false);

    // 订单保持 pending、金额是改后的新值；不产生批次与持仓
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("pending");
    expect(o!.amount).toBe(93600);
    expect(await db.select().from(shareLot)).toHaveLength(0);
    expect(await db.select().from(holding)).toHaveLength(0);

    // 现金只扣了新金额（改单时已退差额 3700）
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 93600);

    // 下一轮 cron 正常跑：按新金额 93600 成交
    await seedNav("2026-08-24", 15000);
    const r = await settlePendingOrders(db, env, settleTime);
    expect(r.confirmed).toBe(1);
    const calc = calcPurchase({ amountCents: 93600, navScaled: 15000, purchaseRate: 150 });
    const o2 = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o2!.status).toBe("confirmed");
    expect(o2!.dealShares).toBe(calc.sharesScaled);
    const lot = await db.query.shareLot.findFirst({
      where: eq(shareLot.orderId, orderId),
    });
    expect(lot!.cost).toBe(93600);
  });

  it("failOrder 双重退款竞态：改单差额已退后失败——不再按旧金额全额退款", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 50000,
      now: NOW,
    });

    // 竞态：失败路径拿到旧快照（amount=50000）后用户改大到 80000（补扣 30000）
    const staleRow = (await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    }))!;
    await amendOrder(db, userId, orderId, { amountCents: 80000 });

    // 若守卫失效，这里会按旧金额 50000 全额退款 → 与改单的差额调整叠加成双退
    // 返回 false = 失败处置让路（调用方据此打结构化告警，settlePendingOrders 计入 skipped）
    const flipped = await failOrder(db, staleRow, "测试失败", NOW);
    expect(flipped).toBe(false);

    // 守卫生效：翻转 0 行，订单保持 pending（改后金额），等下一轮 cron 处置
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("pending");
    expect(o!.amount).toBe(80000);

    // 现金分文未动：只扣了改后的 80000，无退款流水
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 80000);
    const txTypes = (await db.select().from(transactions)).map(t => t.type);
    expect(txTypes).toEqual(["init", "buy", "amend"]); // 没有 buy 退款
  });

  it("卖单改单竞态：撮合读到旧份额后改单——过期快照不消耗批次、不动持仓", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId); // 1000 份

    const { orderId } = await placeSellOrder(db, env, {
      userId,
      fundCode: "000001",
      sharesScaled: 4_000_000, // 原委托 400 份
      now: NOW,
    });

    // 竞态：撮合先读到 pending 快照（shares=400 份），随后用户改到 700 份
    const staleRow = (await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    }))!;
    await amendOrder(db, userId, orderId, { sharesScaled: 7_000_000 });

    const settleTime = new Date("2026-08-24T12:30:00Z");
    const won = await settleSellOrder(db, staleRow, 15000, settleTime);
    expect(won).toBe(false);

    // 订单保持 pending、份额是改后新值
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o!.status).toBe("pending");
    expect(o!.shares).toBe(7_000_000);

    // 持仓与批次分毫未动，现金也不入账
    const h = await db.query.holding.findFirst({
      where: and(eq(holding.userId, userId), eq(holding.fundCode, "000001")),
    });
    expect(h!.totalShares).toBe(10_000_000);
    expect(h!.totalCost).toBe(150000);
    const lots = await db.select().from(shareLot);
    expect(lots).toHaveLength(1);
    expect(lots[0].shares).toBe(10_000_000);
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);
    // 赎回单本无流水，失败竞态也不该有
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.orderId, orderId));
    expect(txs).toHaveLength(0);
  });
});
