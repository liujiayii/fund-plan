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
import { toBeijing } from "~/domain/trading-calendar";
import { getAdminStats, getUserDetail, listUsersOverview } from "~/services/admin-service";
import { registerUser } from "~/services/auth";
import { getPortfolio } from "~/services/portfolio-service";

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

beforeEach(resetAll);

describe("listUsersOverview 用户列表", () => {
  it("每人的现金与持仓市值来自 account 与 portfolio，订单数独立统计", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    // alice 下一笔买单（pending），让 orderCount 有区分度
    const today = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(orders).values({
      userId: alice.id,
      fundCode: "000001",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 100000,
      placeDate: today,
      confirmDate: today,
      createdAt: Date.now(),
    });

    const rows = await listUsersOverview(db);
    expect(rows).toHaveLength(2);

    const a = rows.find(r => r.username === "alice")!;
    // alice 没持仓：市值 0、盈亏 0、现金即账户现金
    expect(a.marketValueCents).toBe(0);
    expect(a.totalPnlCents).toBe(0);
    expect(a.orderCount).toBe(1);
    // 用注册返回值对表校验（registerUser 建 account 发 10 万初始本金）
    expect(a.cashCents).toBeGreaterThan(0);
    expect(a.role).toBe("user");

    const admin = rows.find(r => r.username === "testadmin")!;
    expect(admin.role).toBe("admin");
    expect(admin.orderCount).toBe(0);
  });

  it("按注册时间倒序（后注册的排前面）", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "alice", "hunter2");
    await registerUser(db, env, "bob", "hunter2");

    const rows = await listUsersOverview(db);
    expect(rows.map(r => r.username)).toEqual(["bob", "alice"]);
  });

  it("多用户批量聚合与 getPortfolio 同口径（对拍校验，不手算金额）", async () => {
    const db = getDb(env.DB);
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    // alice 建仓：基金档案 + 当日净值（fund_nav 主键是 (fundCode, navDate)）+ 一笔持仓
    const code = "000001";
    await db.insert(fund).values({
      code,
      name: "测试成长混合",
      type: "混合型",
      purchaseRate: 150,
      redeemTiers: DEFAULT_REDEEM_TIERS,
      minPurchase: 1000,
      updatedAt: Date.now(),
    });
    const navDate = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(fundNav).values({
      fundCode: code,
      navDate,
      unitNav: 12345, // 净值 1.2345（×10000 整数口径）
      accNav: 12345,
      growthRate: 0,
    });
    await db.insert(holding).values({
      userId: alice.id,
      fundCode: code,
      totalShares: 6568133, // 656.8133 份（×10000）
      totalCost: 800000, // 8000 元（分）
    });

    // 直接对拍 getPortfolio 的 summary——精度铁律：绝不在测试里手算金额
    const rows = await listUsersOverview(db);
    const alicePortfolio = await getPortfolio(db, alice.id);
    const a = rows.find(r => r.username === "alice")!;
    expect(a.marketValueCents).toBe(alicePortfolio.summary.marketValueCents);
    expect(a.totalPnlCents).toBe(alicePortfolio.summary.totalPnlCents);

    // admin 无持仓：市值 0，现金直接来自 account 行
    const adm = rows.find(r => r.username === "testadmin")!;
    expect(adm.marketValueCents).toBe(0);
    const acc = await db.query.account.findFirst({ where: eq(account.userId, admin.id) });
    expect(adm.cashCents).toBe(acc!.cash);
  });

  it("无净值成本兜底 + 多持仓汇总 + 清仓行过滤与 getPortfolio 同口径", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    // 两只基金：000001 有净值行；000002 只有档案没有净值行（走成本兜底路径）
    await db.insert(fund).values([
      { code: "000001", name: "有净值混合", type: "混合型", purchaseRate: 150, redeemTiers: DEFAULT_REDEEM_TIERS, minPurchase: 1000, updatedAt: Date.now() },
      { code: "000002", name: "无净值混合", type: "混合型", purchaseRate: 150, redeemTiers: DEFAULT_REDEEM_TIERS, minPurchase: 1000, updatedAt: Date.now() },
    ]);
    // unitNav 与 accNav 刻意不同：实现若误用累计净值（accNav）估值，对拍立刻抓出
    const navDate = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(fundNav).values({
      fundCode: "000001",
      navDate,
      unitNav: 12345,
      accNav: 23456,
      growthRate: 0,
    });

    // alice 三行持仓：有净值的 / 无净值走兜底的 / 清仓行（份额 0 但成本非 0，
    // 若不过滤会把 -成本 的假亏损灌进汇总，对拍能抓出）
    await db.insert(holding).values([
      { userId: alice.id, fundCode: "000001", totalShares: 6568133, totalCost: 800000 },
      { userId: alice.id, fundCode: "000002", totalShares: 1234567, totalCost: 2000000 },
      { userId: alice.id, fundCode: "000003", totalShares: 0, totalCost: 500000 },
    ]);

    const rows = await listUsersOverview(db);
    const alicePortfolio = await getPortfolio(db, alice.id);
    const a = rows.find(r => r.username === "alice")!;
    expect(a.marketValueCents).toBe(alicePortfolio.summary.marketValueCents);
    expect(a.totalPnlCents).toBe(alicePortfolio.summary.totalPnlCents);
    // 防假绿：两条持仓都被计入才有非零市值；有净值那只的成本与市值差得远，
    // 盈亏必然非零——若持仓全被漏掉，两边都空转成 0=0 的对拍就失去意义
    expect(a.marketValueCents).toBeGreaterThan(0);
    expect(a.totalPnlCents).not.toBe(0);
  });
});

describe("getAdminStats 全局统计", () => {
  it("用户数 / 待撮合单数 / 今日已撮合单数", async () => {
    const db = getDb(env.DB);
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    // 固定时间基准：today/yesterday 与 getAdminStats 都从同一个 now 推导，
    // 避免（北京时间）跨日瞬间跑测试时「今日已确认」被判成昨日（CodeRabbit 指出的竞态）
    const now = new Date();
    const today = toBeijing(now).format("YYYY-MM-DD");
    // brief 原稿笔误：yesterday 也写成 today，导致「昨日已确认」计入今日。
    // 这里真正减一天，保证两条 confirmed 单的 confirmDate 有区分。
    const yesterday = toBeijing(now).subtract(1, "day").format("YYYY-MM-DD");
    await db.insert(orders).values([
      // alice 的两笔 pending（都算待撮合）
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 100000, placeDate: today, confirmDate: today, createdAt: Date.now() },
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "dca", amount: 50000, placeDate: yesterday, confirmDate: yesterday, createdAt: Date.now() },
      // admin 的一笔今日已确认
      { userId: admin.id, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 20000, placeDate: yesterday, confirmDate: today, createdAt: Date.now() },
      // admin 的一笔昨日已确认（不计入「今日」）
      { userId: admin.id, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 20000, placeDate: yesterday, confirmDate: yesterday, createdAt: Date.now() },
    ]);

    const s = await getAdminStats(db, now);
    expect(s.users).toBe(2);
    expect(s.pendingOrders).toBe(2);
    expect(s.todayConfirmedOrders).toBe(1);
  });

  it("空库全为 0", async () => {
    const db = getDb(env.DB);
    const s = await getAdminStats(db);
    expect(s).toEqual({ users: 0, pendingOrders: 0, todayConfirmedOrders: 0 });
  });
});

describe("getUserDetail 单用户详情", () => {
  it("返回该用户的组合与订单，别人的订单不混入", async () => {
    const db = getDb(env.DB);
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    const today = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(orders).values([
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 100000, placeDate: today, confirmDate: today, createdAt: Date.now() },
      { userId: admin.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 20000, placeDate: today, confirmDate: today, createdAt: Date.now() },
    ]);

    const d = await getUserDetail(db, alice.id);
    expect(d).not.toBeNull();
    expect(d!.user.username).toBe("alice");
    expect(d!.user.role).toBe("user");
    // 隔离断言靠数量：admin 也有一笔单，若查询没按 userId 过滤会查出 2 笔
    expect(d!.orders).toHaveLength(1);
    expect(d!.portfolio.summary.cashCents).toBeGreaterThan(0);
  });

  it("用户不存在返回 null（路由层据此 404）", async () => {
    const db = getDb(env.DB);
    expect(await getUserDetail(db, 99999)).toBeNull();
  });
});
