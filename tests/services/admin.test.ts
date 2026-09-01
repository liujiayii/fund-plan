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
import { toBeijing } from "~/domain/trading-calendar";
import { getAdminStats, getUserDetail, listUsersOverview } from "~/services/admin-service";
import { registerUser } from "~/services/auth";

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
});

describe("getAdminStats 全局统计", () => {
  it("用户数 / 待撮合单数 / 今日已撮合单数", async () => {
    const db = getDb(env.DB);
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    const today = toBeijing(new Date()).format("YYYY-MM-DD");
    // brief 原稿笔误：yesterday 也写成 today，导致「昨日已确认」计入今日。
    // 这里真正减一天，保证两条 confirmed 单的 confirmDate 有区分。
    const yesterday = toBeijing(new Date()).subtract(1, "day").format("YYYY-MM-DD");
    await db.insert(orders).values([
      // alice 的两笔 pending（都算待撮合）
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 100000, placeDate: today, confirmDate: today, createdAt: Date.now() },
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "dca", amount: 50000, placeDate: yesterday, confirmDate: yesterday, createdAt: Date.now() },
      // admin 的一笔今日已确认
      { userId: admin.id, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 20000, placeDate: yesterday, confirmDate: today, createdAt: Date.now() },
      // admin 的一笔昨日已确认（不计入「今日」）
      { userId: admin.id, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 20000, placeDate: yesterday, confirmDate: yesterday, createdAt: Date.now() },
    ]);

    const s = await getAdminStats(db);
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
