import type { OrderView, PortfolioView } from "./portfolio-service";
import type { Db } from "~/db/client";
import { desc, eq, sql } from "drizzle-orm";
import { orders, user } from "~/db/schema";
import { toBeijing } from "~/domain/trading-calendar";
import { getOrders, getPortfolio } from "./portfolio-service";

/** /admin 用户列表一行的数据 */
export interface UserOverview {
  id: number;
  username: string;
  role: "admin" | "user";
  /** 可用现金（分） */
  cashCents: number;
  /** 持仓市值（分） */
  marketValueCents: number;
  /** 浮动盈亏（分） */
  totalPnlCents: number;
  /** 历史订单总数（含 pending/failed/cancelled） */
  orderCount: number;
  /** 注册时间戳（毫秒） */
  createdAt: number;
}

/** /admin 顶部全局统计卡 */
export interface AdminStats {
  /** 总用户数 */
  users: number;
  /** 待撮合订单数（所有 pending——它们都在等净值） */
  pendingOrders: number;
  /** 今日已撮合确认的订单数（北京时间口径 confirmDate = 今天） */
  todayConfirmedOrders: number;
}

/**
 * 用户列表聚合。模拟盘用户量小（几十人级），逐人调 getPortfolio 的
 * N+1 暂不优化——真到瓶颈再做 holding + fund_nav 的联表聚合。
 */
export async function listUsersOverview(db: Db): Promise<UserOverview[]> {
  const [users, orderCounts] = await Promise.all([
    db.select().from(user).orderBy(desc(user.createdAt), desc(user.id)),
    // 每用户订单数一条 groupBy 拿全，避免再逐人 count
    db
      .select({ userId: orders.userId, n: sql<number>`count(*)` })
      .from(orders)
      .groupBy(orders.userId),
  ]);
  const countMap = new Map(orderCounts.map(r => [r.userId, r.n]));

  const portfolios = await Promise.all(users.map(u => getPortfolio(db, u.id)));

  return users.map((u, i) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    cashCents: portfolios[i].summary.cashCents,
    marketValueCents: portfolios[i].summary.marketValueCents,
    totalPnlCents: portfolios[i].summary.totalPnlCents,
    orderCount: countMap.get(u.id) ?? 0,
    createdAt: u.createdAt,
  }));
}

/** 全局统计。三个口径见 AdminStats 字段注释 */
export async function getAdminStats(
  db: Db,
  now: Date = new Date(),
): Promise<AdminStats> {
  const today = toBeijing(now).format("YYYY-MM-DD");

  const [[users], [pending], [todayConfirmed]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(user),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, "pending")),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(sql`${orders.status} = 'confirmed' and ${orders.confirmDate} = ${today}`),
  ]);

  return {
    users: users.n,
    pendingOrders: pending.n,
    todayConfirmedOrders: todayConfirmed.n,
  };
}

/** /admin/users/:id 页的数据包 */
export interface AdminUserDetail {
  user: { id: number; username: string; role: "admin" | "user"; createdAt: number };
  portfolio: PortfolioView;
  orders: OrderView[];
}

/**
 * 单用户详情（组合 + 订单）。用户不存在返回 null，
 * 路由层据此抛 404——与 getHoldingDetail 的「查不到 → 404」套路一致。
 */
export async function getUserDetail(
  db: Db,
  userId: number,
): Promise<AdminUserDetail | null> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u)
    return null;

  // 组合与订单互不依赖，并行发出（跨大区部署时每跳都是百毫秒级往返）
  const [portfolio, orderList] = await Promise.all([
    getPortfolio(db, userId),
    getOrders(db, userId, 200),
  ]);

  return {
    user: { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt },
    portfolio,
    orders: orderList,
  };
}
