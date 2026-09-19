// tests/services/leaderboard.test.ts
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
import { INITIAL_CASH_CENTS } from "~/domain/config";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { getLeaderboard } from "~/services/leaderboard-service";

/** 与 settle.test.ts 同款的清理/造数范式 */
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

/** 写入某日净值（×10000） */
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

async function seedUser(name: string) {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

/**
 * 造一笔已确认订单（只为了过「hasTrades」门槛，成交数字不重要）。
 * placeBuyOrder + settle 太重，直接插 orders 行——排行榜只看 status。
 */
async function seedConfirmedOrder(userId: number) {
  const db = getDb(env.DB);
  await db.insert(orders).values({
    userId,
    fundCode: "000001",
    side: "buy",
    status: "confirmed",
    source: "manual",
    amount: 100_000,
    placeDate: "2026-08-24",
    confirmDate: "2026-08-25",
    dealNav: 15_000,
    dealShares: 6_568_133,
    dealAmount: 98_522,
    fee: 1_478,
    createdAt: Date.parse("2026-08-24T06:00:00Z"),
  });
}

beforeEach(resetAll);

describe("getLeaderboard", () => {
  it("空库返回空榜", async () => {
    const db = getDb(env.DB);
    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(0);
    expect(lb.byPnl).toHaveLength(0);
  });

  it("三用户：门槛过滤 + 市值估值 + 两维排序", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 15_000); // 净值 1.5

    // alice：初始本金里花 10 万元买 10 万份（份额 ×10000 存 1_000_000_000），
    // 成本 10_000_000 分；净值 1.5 → 市值 15_000_000 分，
    // 总资产 = 初始本金 + 5_000_000，收益 +1%
    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 1_000_000_000,
      totalCost: 10_000_000,
    });
    await db
      .update(account)
      .set({ cash: INITIAL_CASH_CENTS - 10_000_000 })
      .where(eq(account.userId, alice));

    // bob：纯签到 1000 元、无成交 → 不上榜
    const bob = await seedUser("bob");
    await db
      .update(account)
      .set({ cash: INITIAL_CASH_CENTS + 10_000, totalCheckin: 10_000 })
      .where(eq(account.userId, bob));

    // carol：空仓，现金多出 25 万 → 收益 +5%
    const carol = await seedUser("carol");
    await seedConfirmedOrder(carol);
    await db
      .update(account)
      .set({ cash: INITIAL_CASH_CENTS + 25_000_000 })
      .where(eq(account.userId, carol));

    const lb = await getLeaderboard(db);

    // bob 被门槛过滤；carol(+5%) 压过 alice(+1%)
    expect(lb.byRate.map(e => e.username)).toEqual(["carol", "alice"]);
    expect(lb.byRate[0].totalPnlRate).toBeCloseTo(0.05, 10);
    // alice：市值 = 10 万份 × 1.5 元 = 15_000_000 分
    expect(lb.byRate[1].marketValueCents).toBe(15_000_000);
    expect(lb.byRate[1].totalAssetCents).toBe(INITIAL_CASH_CENTS + 5_000_000);
    expect(lb.byRate[1].totalPnlCents).toBe(5_000_000);
    // 总收益榜同序（+25 万 > +5 万）
    expect(lb.byPnl.map(e => e.username)).toEqual(["carol", "alice"]);
  });

  it("投入收益率：分母是累计买入金额，不是含闲钱的累计入金", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 15_000); // 净值 1.5（与订单成交价一致 → 持仓浮盈 0）

    // alice：初始本金里只掏了 1000 元买基金（成交净额 985.22 元 + 14.78 元申购费），
    // 其余现金原封不动。持仓浮盈 0，唯一的亏损就是那笔申购费
    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice); // amount 100_000 / dealAmount 98_522 / fee 1_478
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 6_568_133,
      totalCost: 98_522,
    });
    await db
      .update(account)
      .set({ cash: INITIAL_CASH_CENTS - 100_000 })
      .where(eq(account.userId, alice));

    const lb = await getLeaderboard(db);
    const e = lb.byRate[0];
    // 总收益 = (初始本金 − 100_000) + 98_522 − 初始本金 = −1_478（正好是申购费）
    expect(e.totalPnlCents).toBe(-1_478);
    // 账户口径：−1478 / 500_000_000 ≈ −0.0003%——被 500 万闲钱稀释到几乎看不见
    expect(e.totalPnlRate).toBeCloseTo(-1_478 / INITIAL_CASH_CENTS, 10);
    // 投入口径：−1478 / 100_000（累计买入）= −1.478%——这才是真实代价
    expect(e.investedPnlRate).toBeCloseTo(-0.01478, 10);
    // 两个率的分母确实不同——这是本口径存在的全部理由
    expect(e.investedPnlRate).not.toBeCloseTo(e.totalPnlRate, 6);
  });

  /**
   * 交叉不变量（2026-09-18 补）：排行榜的收益率分母来自 account 的冗余字段
   * （initialCash / totalCheckin），总览卡的累计收益率分母来自 transactions
   * 流水里 init/checkin 的聚合——**两条独立实现**。今天恰好相等，但没有结构性
   * 保证：历史账号缺 init 流水、或 account 字段被手工改过，两个页面的
   * 「累计收益率」就会分叉，而没有任何东西会报警。这条断言把它钉死。
   */
  it("交叉不变量：account 入金字段 === 流水聚合的净入金 === 榜单分母", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, alice),
    });
    const ledgerRows = await db
      .select({ type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(eq(transactions.userId, alice));
    const fromLedger = ledgerRows
      .filter(r => r.type === "init" || r.type === "checkin")
      .reduce((s, r) => s + r.amount, 0);

    // 两条来源必须一致
    expect(fromLedger).toBe((acc?.initialCash ?? 0) + (acc?.totalCheckin ?? 0));

    // 榜单也必须用同一份分母：totalAsset − totalPnl 反推出来的就是入金
    const lb = await getLeaderboard(db);
    const e = lb.byRate[0];
    expect(e.totalAssetCents - e.totalPnlCents).toBe(fromLedger);
  });

  it("持仓无净值时用成本兜底（市值 = 成本，盈亏为 0）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    // 注意：不 seedNav——holding 有持仓但 fund_nav 空

    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 20_000_000,
      totalCost: 200_000,
    });
    await db
      .update(account)
      .set({ cash: INITIAL_CASH_CENTS - 200_000 })
      .where(eq(account.userId, alice));

    const lb = await getLeaderboard(db);
    // 无净值 → 市值按成本 200_000 兜底 → 总资产 = 初始本金，收益 0
    expect(lb.byRate[0].marketValueCents).toBe(200_000);
    expect(lb.byRate[0].totalPnlCents).toBe(0);
  });

  it("pending/failed 订单不算门槛", async () => {
    const db = getDb(env.DB);
    const alice = await seedUser("alice");
    await db.insert(orders).values({
      userId: alice,
      fundCode: "000001",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 100_000,
      placeDate: "2026-08-24",
      confirmDate: "2026-08-25",
      createdAt: Date.now(),
    });

    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(0);
  });

  it("pending 买单的在途资金计入总资产（pending 窗口不缩水）", async () => {
    const db = getDb(env.DB);
    await seedFund();

    // alice 有历史成交（过门槛），现金仍是初始本金；再造一笔 pending 买单 1000 元
    // ——现金虽未实际扣（造数直插），但口径上应把在途金额加进总资产
    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(orders).values({
      userId: alice,
      fundCode: "000001",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 100_000,
      placeDate: "2026-08-24",
      confirmDate: "2026-08-25",
      createdAt: Date.now(),
    });

    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(1);
    // 不含在途是初始本金，含在途应多出 100_000 分（买单金额）
    expect(lb.byRate[0].totalAssetCents).toBe(INITIAL_CASH_CENTS + 100_000);
    expect(lb.byRate[0].totalPnlCents).toBe(100_000);
  });
});
