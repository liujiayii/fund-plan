import type { Db } from "~/db/client";
import { eq, sql } from "drizzle-orm";
import { orders, user, visitDaily } from "~/db/schema";
import { toBeijing } from "~/domain/trading-calendar";

/** 首页「平台数据」卡的四个指标 */
export interface SiteStats {
  /** 注册用户数 */
  users: number;
  /** 已撮合确认的订单数（申购 + 赎回，pending/failed 不算成交） */
  confirmedOrders: number;
  /** 今日访问人次（北京时间口径的「今天」） */
  todayVisits: number;
  /** 累计访问人次 */
  totalVisits: number;
}

/**
 * 记一次访问：当天行不存在则插入 1，已存在则 +1（UPSERT 原子自增）。
 *
 * 单表单语句本身就是原子的，不需要 batch。
 * 调用方应放进 ctx.waitUntil 异步执行——统计失败绝不能拖垮页面响应。
 */
export async function recordVisit(db: Db, now: Date = new Date()): Promise<void> {
  const today = toBeijing(now).format("YYYY-MM-DD");
  await db
    .insert(visitDaily)
    .values({ date: today, count: 1 })
    .onConflictDoUpdate({
      target: visitDaily.date,
      // 引用列自身自增，而非读出来再写回——读改写有并发竞态，SQL 内自增没有
      set: { count: sql`${visitDaily.count} + 1` },
    });
}

/**
 * 汇总平台数据。三个查询相互独立，并行发出。
 *
 * 全是 COUNT/聚合，量级是「表行数」而非「全表扫描成本」——
 * user 与 orders 主键扫，visit_daily 一天一行，免费额度内毫无压力。
 * 空表时 sum 为 NULL，一律 coalesce 成 0。
 */
export async function getSiteStats(
  db: Db,
  now: Date = new Date(),
): Promise<SiteStats> {
  const today = toBeijing(now).format("YYYY-MM-DD");

  const [[users], [confirmed], [visits]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(user),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, "confirmed")),
    // 今日与累计一条 SQL 拿全：条件聚合比查两遍省一次往返
    db
      .select({
        total: sql<number>`coalesce(sum(${visitDaily.count}), 0)`,
        today: sql<number>`coalesce(sum(case when ${visitDaily.date} = ${today} then ${visitDaily.count} else 0 end), 0)`,
      })
      .from(visitDaily),
  ]);

  return {
    users: users.n,
    confirmedOrders: confirmed.n,
    todayVisits: visits.today,
    totalVisits: visits.total,
  };
}
