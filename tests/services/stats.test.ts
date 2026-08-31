import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { dailyVisitor, orders, user, visitDaily } from "~/db/schema";
import { registerUser } from "~/services/auth";
import { getSiteStats, recordVisit } from "~/services/stats-service";

/** 只清本测试涉及的表；user 表有外键依赖，orders 先删 */
async function reset() {
  const db = getDb(env.DB);
  await db.delete(orders);
  await db.delete(visitDaily);
  await db.delete(dailyVisitor);
  await db.delete(user);
}

beforeEach(reset);

describe("recordVisit 访问计数（PV + UV）", () => {
  it("首次访问插入当天行 count=1 并落一条访客记录", async () => {
    const db = getDb(env.DB);
    // UTC 2026-08-24T20:00:00 → 北京 8/25 凌晨 4 点
    await recordVisit(db, "vid-a", new Date("2026-08-24T20:00:00Z"));

    expect(await db.select().from(visitDaily)).toEqual([
      { date: "2026-08-25", count: 1 },
    ]);
    expect(await db.select().from(dailyVisitor)).toEqual([
      { date: "2026-08-25", visitorId: "vid-a" },
    ]);
  });

  it("同访客同日多次访问：PV 累加成一行，UV 仍只一行", async () => {
    const db = getDb(env.DB);
    const t = new Date("2026-08-24T02:00:00Z"); // 北京 8/24
    await recordVisit(db, "vid-a", t);
    await recordVisit(db, "vid-a", t);
    await recordVisit(db, "vid-a", t);

    expect(await db.select().from(visitDaily)).toHaveLength(1);
    expect((await db.select().from(visitDaily))[0]!.count).toBe(3);
    // 去重防线：复合主键 + INSERT OR IGNORE
    expect(await db.select().from(dailyVisitor)).toHaveLength(1);
  });

  it("不同访客同日访问：PV 与 UV 同步 +1", async () => {
    const db = getDb(env.DB);
    const t = new Date("2026-08-24T02:00:00Z");
    await recordVisit(db, "vid-a", t);
    await recordVisit(db, "vid-b", t);

    expect((await db.select().from(visitDaily))[0]!.count).toBe(2);
    expect(await db.select().from(dailyVisitor)).toHaveLength(2);
  });

  it("同访客跨日访问：两日各一行 UV，访客仍是同一人", async () => {
    const db = getDb(env.DB);
    await recordVisit(db, "vid-a", new Date("2026-08-23T02:00:00Z")); // 北京 8/23
    await recordVisit(db, "vid-a", new Date("2026-08-24T02:00:00Z")); // 北京 8/24

    expect(await db.select().from(visitDaily)).toHaveLength(2);
    expect(await db.select().from(dailyVisitor)).toHaveLength(2);
    // 累计访客按 DISTINCT visitor_id 算，回头客不重复计
    const s = await getSiteStats(db, new Date("2026-08-24T02:00:00Z"));
    expect(s.totalVisitors).toBe(1);
  });

  it("跨日访问按北京时间切日", async () => {
    const db = getDb(env.DB);
    await recordVisit(db, "vid-a", new Date("2026-08-23T02:00:00Z")); // 北京 8/23
    await recordVisit(db, "vid-a", new Date("2026-08-24T02:00:00Z")); // 北京 8/24

    const rows = await db.select().from(visitDaily);
    expect(rows.map(r => r.date)).toEqual(["2026-08-23", "2026-08-24"]);
  });
});

describe("getSiteStats 平台数据汇总", () => {
  it("空库时六个指标全为 0、起点为 null（coalesce 兜底，不出现 null 数字）", async () => {
    const db = getDb(env.DB);
    const s = await getSiteStats(db, new Date("2026-08-24T02:00:00Z"));

    expect(s).toEqual({
      users: 0,
      confirmedOrders: 0,
      todayVisits: 0,
      totalVisits: 0,
      todayVisitors: 0,
      totalVisitors: 0,
      statsSince: null,
    });
  });

  it("用户数、成交数、访问/访客（今日与累计）、统计起点分别聚合正确", async () => {
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

    // 昨天：访客 a 访问 2 次；今天（北京 8/24）：访客 a、b 各 1 次
    await recordVisit(db, "vid-a", new Date("2026-08-23T02:00:00Z"));
    await recordVisit(db, "vid-a", new Date("2026-08-23T08:00:00Z"));
    await recordVisit(db, "vid-a", new Date("2026-08-24T02:00:00Z"));
    await recordVisit(db, "vid-b", new Date("2026-08-24T02:00:00Z"));

    const s = await getSiteStats(db, new Date("2026-08-24T02:00:00Z"));
    expect(s.users).toBe(2);
    expect(s.confirmedOrders).toBe(2);
    expect(s.todayVisits).toBe(2);
    expect(s.totalVisits).toBe(4);
    expect(s.todayVisitors).toBe(2);
    expect(s.totalVisitors).toBe(2); // vid-a 回头不算新访客
    expect(s.statsSince).toBe("2026-08-23"); // 最早一行作为统计起点
  });
});
