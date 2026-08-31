import type { Db } from "~/db/client";
import { eq, sql } from "drizzle-orm";
import { dailyVisitor, orders, user, visitDaily } from "~/db/schema";
import { toBeijing } from "~/domain/trading-calendar";

/** 首页「平台数据」卡的指标 */
export interface SiteStats {
  /** 注册用户数 */
  users: number;
  /** 已撮合确认的订单数（申购 + 赎回，pending/failed 不算成交） */
  confirmedOrders: number;
  /** 今日访问人次（PV，北京时间口径的「今天」） */
  todayVisits: number;
  /** 累计访问人次（自统计上线起） */
  totalVisits: number;
  /** 今日独立访客数（UV，按匿名访客 Cookie 去重） */
  todayVisitors: number;
  /** 累计独立访客数（历史出现过的不同访客 ID 总数） */
  totalVisitors: number;
  /** 统计起点 YYYY-MM-DD（visit_daily 最早一行）；从没访问过为 null，页面不标注 */
  statsSince: string | null;
}

/**
 * 记一次访问：PV 当天行 +1，UV 当天该访客首访时落一行。
 *
 * 两条写进同一个 db.batch 原子提交（跨表必须 batch，D1 无交互式事务）：
 *   - visit_daily：UPSERT 原子自增（SQL 内 count+1，无读改写竞态）
 *   - daily_visitor：INSERT OR IGNORE——同访客当日重复访问不再写行，
 *     复合主键 (date, visitor_id) 是去重的最后防线
 *
 * 调用方应放进 ctx.waitUntil 异步执行——统计失败绝不能拖垮页面响应。
 */
export async function recordVisit(
  db: Db,
  visitorId: string,
  now: Date = new Date(),
): Promise<void> {
  const today = toBeijing(now).format("YYYY-MM-DD");
  await db.batch([
    db
      .insert(visitDaily)
      .values({ date: today, count: 1 })
      .onConflictDoUpdate({
        target: visitDaily.date,
        set: { count: sql`${visitDaily.count} + 1` },
      }),
    db
      .insert(dailyVisitor)
      .values({ date: today, visitorId })
      .onConflictDoNothing(),
  ]);
}

/**
 * 汇总平台数据。四个查询相互独立，并行发出。
 *
 * 全是 COUNT/聚合，量级是「表行数」而非「全表扫描成本」——
 * user 与 orders 主键扫，visit_daily 一天一行，daily_visitor 一访客一天一行，
 * 免费额度内毫无压力。空表时 sum 为 NULL，一律 coalesce 成 0。
 */
export async function getSiteStats(
  db: Db,
  now: Date = new Date(),
): Promise<SiteStats> {
  const today = toBeijing(now).format("YYYY-MM-DD");

  const [[users], [confirmed], [visits], [visitorRows]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(user),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, "confirmed")),
    // 今日/累计访问与统计起点一条 SQL 拿全：条件聚合比查两遍省往返
    db
      .select({
        total: sql<number>`coalesce(sum(${visitDaily.count}), 0)`,
        today: sql<number>`coalesce(sum(case when ${visitDaily.date} = ${today} then ${visitDaily.count} else 0 end), 0)`,
        since: sql<string | null>`min(${visitDaily.date})`,
      })
      .from(visitDaily),
    // 今日访客 = 当日行数（复合主键已去重）；累计访客 = 不同 ID 总数
    db
      .select({
        total: sql<number>`count(distinct ${dailyVisitor.visitorId})`,
        today: sql<number>`coalesce(sum(case when ${dailyVisitor.date} = ${today} then 1 else 0 end), 0)`,
      })
      .from(dailyVisitor),
  ]);

  return {
    users: users.n,
    confirmedOrders: confirmed.n,
    todayVisits: visits.today,
    totalVisits: visits.total,
    todayVisitors: visitorRows.today,
    totalVisitors: visitorRows.total,
    statsSince: visits.since,
  };
}
