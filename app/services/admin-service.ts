import type { OrderView, PortfolioView } from "./portfolio-service";
import type { Db } from "~/db/client";
import type { HoldingValuation } from "~/domain/portfolio";
import { desc, eq, sql } from "drizzle-orm";
import { account, holding, orders, user } from "~/db/schema";
import { costBasisNavScaled, valuateHolding, valuatePortfolio } from "~/domain/portfolio";
import { toBeijing } from "~/domain/trading-calendar";
import { getOrders, getPortfolio, latestNavMap } from "./portfolio-service";

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
 * 用户列表聚合（批量版，总查询数与用户数无关）。
 *
 * D1 免费版每请求硬顶 50 条查询：旧写法逐人调 getPortfolio（每人 2~4 条），
 * 用户过 ~10 人时 /admin 直接 500。现在一次批量取 user/account/holding +
 * 一条最新净值 + 一条 groupBy 订单数，固定 5 条查询跑完，聚合全在内存做。
 * 单只持仓估值与 getPortfolio 完全同口径：valuateHolding + 无净值时
 * costBasisNavScaled 成本兜底，汇总走 valuatePortfolio。
 */
export async function listUsersOverview(db: Db): Promise<UserOverview[]> {
  // ── 第一波：用户 / 账户 / 持仓 / 订单数互不依赖，并行发出 ──────────
  const [users, accountRows, holdingRows, orderCounts] = await Promise.all([
    db.select().from(user).orderBy(desc(user.createdAt), desc(user.id)),
    db.select().from(account),
    db.select().from(holding),
    // 每用户订单数一条 groupBy 拿全，避免再逐人 count
    db
      .select({ userId: orders.userId, n: sql<number>`count(*)` })
      .from(orders)
      .groupBy(orders.userId),
  ]);
  const countMap = new Map(orderCounts.map(r => [r.userId, r.n]));
  const cashByUser = new Map(accountRows.map(a => [a.userId, a.cash]));

  // ── 第二波：净值依赖持仓代码，先去重再一次查全 ────────────────────
  // 沿用 getPortfolio 口径：只统计 totalShares > 0 的行——
  // 清仓行份额为 0 但永久留存，不滤会把历史持有过的基金全灌进净值查询
  const active = holdingRows.filter(h => h.totalShares > 0);
  const codes = [...new Set(active.map(h => h.fundCode))];
  const navMap = await latestNavMap(db, codes);

  // ── 内存聚合：持仓按 userId 分组估值，再逐人喂 valuatePortfolio ────
  // 无净值时用成本价兜底：市值 ≈ 成本、盈亏 ≈ 0。⚠️ 换算必须走
  // costBasisNavScaled，别内联手写——domain/portfolio.ts 记过少乘 100 的事故
  const holdingsByUser = new Map<number, HoldingValuation[]>();
  for (const h of active) {
    const navInfo = navMap.get(h.fundCode);
    const v = valuateHolding({
      fundCode: h.fundCode,
      totalSharesScaled: h.totalShares,
      totalCostCents: h.totalCost,
      navScaled: navInfo
        ? navInfo.unitNav
        : costBasisNavScaled(h.totalCost, h.totalShares),
    });
    const list = holdingsByUser.get(h.userId);
    if (list)
      list.push(v);
    else
      holdingsByUser.set(h.userId, [v]);
  }

  return users.map((u) => {
    // 没账户的按 0 兜底（防御，正常注册必有 account）
    const summary = valuatePortfolio(holdingsByUser.get(u.id) ?? [], cashByUser.get(u.id) ?? 0);
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      cashCents: summary.cashCents,
      marketValueCents: summary.marketValueCents,
      totalPnlCents: summary.totalPnlCents,
      orderCount: countMap.get(u.id) ?? 0,
      createdAt: u.createdAt,
    };
  });
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
