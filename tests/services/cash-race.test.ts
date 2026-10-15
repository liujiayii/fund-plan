import { env } from "cloudflare:test";
import { and, eq, sql } from "drizzle-orm";
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
import { INITIAL_CASH_CENTS } from "~/domain/config";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { doCheckin } from "~/services/checkin-service";
import { createDcaPlan, scanDcaPlans } from "~/services/dca-service";
import { failOrder } from "~/services/settle";
import { cancelOrder, placeBuyOrder } from "~/services/trade";

/**
 * 现金账并发安全回归（2026-10-14 定投重复派发事故）。
 *
 * 事故形态：CF cron at-least-once 重复派发，两个重叠的定投扫描各自
 * 「读 cash → JS 减 → 无条件写回绝对值」，后提交者覆盖前者的扣减，
 * account.cash 与流水链合计永久偏差 2 万元，当日收益凭空多出 2.2 万。
 * 修复：全部现金写点改相对量更新（cash = cash + Δ）+ 守卫 + returning 判赢；
 * 定投扫描改抢占式 CAS next_run（claim-first）。
 *
 * 核心断言是**全局对账恒等式**：任意操作序列后
 *   account.cash === Σ transactions.amount（含 init）
 * 任何丢失更新都会表现为 gap ≠ 0。
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

/** 全局对账：account.cash − Σ transactions.amount，恒等式要求为 0 */
async function ledgerGap(userId: number): Promise<number> {
  const db = getDb(env.DB);
  const [row] = await db
    .select({
      cash: account.cash,
      sum: sql<number>`(SELECT coalesce(sum(${transactions.amount}), 0) FROM ${transactions} WHERE ${transactions.userId} = ${userId})`,
    })
    .from(account)
    .where(eq(account.userId, userId));
  return row.cash - row.sum;
}

beforeEach(resetAll);

describe("现金账并发安全", () => {
  it("并发两笔申购冻结不丢更新（2026-10-14 事故回归）", async () => {
    await seedFund();
    const userId = await seedUser();
    const db = getDb(env.DB);

    // 两笔申购并发：旧的读-改-写实现里，后写者会用过期余额覆盖前者的扣减
    const [r1, r2] = await Promise.all([
      placeBuyOrder(db, env, { userId, fundCode: "000001", amountCents: 10000 }),
      placeBuyOrder(db, env, { userId, fundCode: "000001", amountCents: 20000 }),
    ]);
    expect(r1.orderId).not.toBe(r2.orderId);

    // 全局对账（旧实现此处 gap = −30000，即有两笔冻结被互相覆盖）
    expect(await ledgerGap(userId)).toBe(0);

    const [acc] = await db.select().from(account).where(eq(account.userId, userId));
    expect(acc.cash).toBe(INITIAL_CASH_CENTS - 30000);

    // 两笔订单各有一条冻结流水
    const freezeTxs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "buy")));
    expect(freezeTxs.length).toBe(2);
  });

  it("并发两轮定投扫描不重复下单（重复派发回归）", async () => {
    await seedFund();
    const userId = await seedUser();
    const db = getDb(env.DB);

    await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 10000,
      frequency: "daily",
      now: new Date("2026-10-13T02:00:00Z"), // 北京 10-13，next_run 推到 10-14
    });

    // 同一时刻的两轮扫描：模拟 CF cron 重复派发（事故里相隔 5 秒）
    const now = new Date("2026-10-14T02:00:00Z"); // 北京 10-14 10:00
    const [a, b] = await Promise.all([
      scanDcaPlans(db, env, now),
      scanDcaPlans(db, env, now),
    ]);

    // 抢占式 CAS next_run：恰有一轮赢下计划并下单，另一轮 skipped
    expect(a.triggered + b.triggered).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);

    const dcaOrders = await db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.source, "dca")));
    expect(dcaOrders.length).toBe(1);

    const [plan] = await db.select().from(dcaPlan).where(eq(dcaPlan.userId, userId));
    expect(plan.runCount).toBe(1);
    expect(plan.nextRun).toBe("2026-10-15");
    expect(await ledgerGap(userId)).toBe(0);
  });

  it("签到与申购并发不丢更新", async () => {
    await seedFund();
    const userId = await seedUser();
    const db = getDb(env.DB);

    await Promise.all([
      doCheckin(db, userId),
      placeBuyOrder(db, env, { userId, fundCode: "000001", amountCents: 10000 }),
    ]);
    expect(await ledgerGap(userId)).toBe(0);
  });

  it("撤单退款带冻结守卫：冻结流水缺失时分文不动", async () => {
    await seedFund();
    const userId = await seedUser();
    const db = getDb(env.DB);

    // 直接插一条 pending 买单，模拟「订单在、冻结流水缺失」的脏数据
    const [o] = await db
      .insert(orders)
      .values({
        userId,
        fundCode: "000001",
        side: "buy",
        status: "pending",
        source: "manual",
        amount: 10000,
        shares: null,
        placeDate: "2026-10-14",
        confirmDate: "2026-10-15",
        createdAt: Date.now(),
      })
      .returning();

    await expect(cancelOrder(db, userId, o.id)).rejects.toThrow("退款异常");

    // 资金分文未动，也没有凭空长出冲正流水
    const [acc] = await db.select().from(account).where(eq(account.userId, userId));
    expect(acc.cash).toBe(INITIAL_CASH_CENTS);
    const cancelTxs = await db.select().from(transactions).where(eq(transactions.type, "cancel"));
    expect(cancelTxs.length).toBe(0);
  });

  it("failOrder 退款带冻结守卫：冻结流水缺失时不退款", async () => {
    await seedFund();
    const userId = await seedUser();
    const db = getDb(env.DB);

    const [o] = await db
      .insert(orders)
      .values({
        userId,
        fundCode: "000001",
        side: "buy",
        status: "pending",
        source: "manual",
        amount: 10000,
        shares: null,
        placeDate: "2026-10-14",
        confirmDate: "2026-10-15",
        createdAt: Date.now(),
      })
      .returning();

    const row = (await db.select().from(orders).where(eq(orders.id, o.id)))[0]!;
    const flipped = await failOrder(db, row, "测试：业务失败", new Date());
    expect(flipped).toBe(true);

    const [acc] = await db.select().from(account).where(eq(account.userId, userId));
    expect(acc.cash).toBe(INITIAL_CASH_CENTS);
    const refundTxs = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "buy"), sql`${transactions.amount} > 0`));
    expect(refundTxs.length).toBe(0);
  });

  it("改单差额走相对量：金额与流水对账一致", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const { orderId } = await placeBuyOrder(db, env, {
      userId,
      fundCode: "000001",
      amountCents: 10000,
    });
    // 加仓 10000 → 20000：补 10000 差额
    const { amendOrder } = await import("~/services/trade");
    await amendOrder(db, userId, orderId, { amountCents: 20000 });

    const [acc] = await db.select().from(account).where(eq(account.userId, userId));
    expect(acc.cash).toBe(INITIAL_CASH_CENTS - 20000);
    const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(o.amount).toBe(20000);
    expect(await ledgerGap(userId)).toBe(0);

    // 减仓 20000 → 5000：退 15000 差额
    await amendOrder(db, userId, orderId, { amountCents: 5000 });
    const [acc2] = await db.select().from(account).where(eq(account.userId, userId));
    expect(acc2.cash).toBe(INITIAL_CASH_CENTS - 5000);
    expect(await ledgerGap(userId)).toBe(0);
  });
});
