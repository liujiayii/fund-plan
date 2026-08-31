import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { orders, user, visitDaily } from "~/db/schema";
import { registerUser } from "~/services/auth";
import { getSiteStats, recordVisit } from "~/services/stats-service";

/** 只清本测试涉及的表；user 表有外键依赖，orders 先删 */
async function reset() {
  const db = getDb(env.DB);
  await db.delete(orders);
  await db.delete(visitDaily);
  await db.delete(user);
}

beforeEach(reset);

describe("recordVisit 访问计数", () => {
  it("首次访问插入当天行 count=1", async () => {
    const db = getDb(env.DB);
    // UTC 2026-08-24T20:00:00 → 北京 8/25 凌晨 4 点
    await recordVisit(db, new Date("2026-08-24T20:00:00Z"));

    const rows = await db.select().from(visitDaily);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-08-25");
    expect(rows[0].count).toBe(1);
  });

  it("同日多次访问原子累加成一行", async () => {
    const db = getDb(env.DB);
    const t = new Date("2026-08-24T02:00:00Z"); // 北京 8/24
    await recordVisit(db, t);
    await recordVisit(db, t);
    await recordVisit(db, t);

    const rows = await db.select().from(visitDaily);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
  });

  it("跨日访问各记一行（按北京时间切日）", async () => {
    const db = getDb(env.DB);
    await recordVisit(db, new Date("2026-08-23T02:00:00Z")); // 北京 8/23
    await recordVisit(db, new Date("2026-08-24T02:00:00Z")); // 北京 8/24

    const rows = await db.select().from(visitDaily);
    expect(rows).toHaveLength(2);
  });
});

describe("getSiteStats 平台数据汇总", () => {
  it("空库时四个指标全为 0（coalesce 兜底，不出现 null）", async () => {
    const db = getDb(env.DB);
    const s = await getSiteStats(db, new Date("2026-08-24T02:00:00Z"));

    expect(s).toEqual({
      users: 0,
      confirmedOrders: 0,
      todayVisits: 0,
      totalVisits: 0,
    });
  });

  it("用户数、已确认订单数、今日/累计访问分别聚合正确", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "alice", "hunter2");
    await registerUser(db, env, "bob", "hunter2");

    // 两笔 confirmed + 一笔 pending：成交笔数只数 confirmed
    const now = Date.now();
    await db.insert(orders).values([
      { userId: 1, fundCode: "000001", side: "buy", status: "confirmed", placeDate: "2026-08-20", confirmDate: "2026-08-21", createdAt: now },
      { userId: 1, fundCode: "000001", side: "sell", status: "confirmed", placeDate: "2026-08-20", confirmDate: "2026-08-21", createdAt: now },
      { userId: 2, fundCode: "000001", side: "buy", status: "pending", placeDate: "2026-08-24", confirmDate: "2026-08-25", createdAt: now },
    ]);

    // 昨天 2 次、今天（北京 8/24）1 次访问
    await recordVisit(db, new Date("2026-08-23T02:00:00Z"));
    await recordVisit(db, new Date("2026-08-23T08:00:00Z"));
    await recordVisit(db, new Date("2026-08-24T02:00:00Z"));

    const s = await getSiteStats(db, new Date("2026-08-24T02:00:00Z"));
    expect(s.users).toBe(2);
    expect(s.confirmedOrders).toBe(2);
    expect(s.todayVisits).toBe(1);
    expect(s.totalVisits).toBe(3);
  });
});
