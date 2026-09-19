import type { DcaPlanView, OrderView, PortfolioView } from "./portfolio-service";
import type { Db } from "~/db/client";
import type { HoldingValuation } from "~/domain/portfolio";
import { and, desc, eq, sql } from "drizzle-orm";
import { account, holding, orders, user } from "~/db/schema";
import { safeRate } from "~/domain/money";
import { costBasisNavScaled, valuateHolding, valuatePortfolio } from "~/domain/portfolio";
import { toBeijing } from "~/domain/trading-calendar";
import {
  getDcaPlans,
  getOrders,
  getPendingBuyCents,
  getPortfolio,
  latestNavMap,
} from "./portfolio-service";

/**
 * /admin 用户列表一行的数据。
 *
 * ⚠️ 本页同时摆两种「收益」，列标题必须把口径写出来，否则排查的人会拿
 * 「持仓浮盈」去对排行榜的「总收益」然后怀疑其中一边算错了（2026-09-18 审计）：
 *  - `accountPnlCents` = 总资产 − 累计入金（含现金、在途、已实现盈亏与全部费用）
 *    —— **与排行榜 LeaderboardEntry.totalPnlCents 同口径**，可直接对账
 *  - `holdingPnlCents` = 市值 − 持仓成本（纯浮盈，不含现金与已实现盈亏）
 *  - `depositedCents`（收益率分母）也一并列出：没有分母就没法验证收益率
 */
export interface UserOverview {
  id: number;
  username: string;
  role: "admin" | "user";
  /** 注册来源 IP（存量用户为 null） */
  registerIp: string | null;
  /** 注册时的 User-Agent（存量用户为 null） */
  registerUserAgent: string | null;
  /** 注册地：国家代码（存量用户为 null） */
  registerCountry: string | null;
  /** 注册地：城市（存量用户为 null） */
  registerCity: string | null;
  /** 可用现金（分） */
  cashCents: number;
  /** pending 买单在途资金（分） */
  inFlightCents: number;
  /** 持仓市值（分） */
  marketValueCents: number;
  /** 累计入金（分）= 初始本金 + 签到。账户收益率的分母 */
  depositedCents: number;
  /** 总资产（分）= 市值 + 现金 + 在途。与排行榜同口径 */
  totalAssetCents: number;
  /** 账户收益（分）= 总资产 − 累计入金。与排行榜「总收益」同口径 */
  accountPnlCents: number;
  /** 账户收益率（普通小数）；累计入金为 0 时为 null */
  accountPnlRate: number | null;
  /** 持仓浮盈（分）= 市值 − 持仓成本（不含现金与已实现盈亏） */
  holdingPnlCents: number;
  /** 历史订单总数（含 pending/failed/cancelled） */
  orderCount: number;
  /** 注册时间戳（毫秒） */
  createdAt: number;
  /** 最后活跃时间戳（毫秒）。从没带会话进过站的为 null */
  lastActiveAt: number | null;
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
 * 一条最新净值 + 一条 groupBy 订单数 + 一条 pending 买单，固定 6 条查询跑完，
 * 聚合全在内存做。
 * 单只持仓估值与 getPortfolio 完全同口径：valuateHolding + 无净值时
 * costBasisNavScaled 成本兜底，汇总走 valuatePortfolio。
 * 账户口径（总资产 / 账户收益 / 收益率）与 leaderboard-service 同源，
 * 排查「榜上这个数怎么来的」时两边能直接对上。
 */
export async function listUsersOverview(db: Db): Promise<UserOverview[]> {
  // ── 第一波：用户 / 账户 / 持仓 / 订单数 / 在途互不依赖，并行发出 ────
  const [users, accountRows, holdingRows, orderCounts, pendingBuys] = await Promise.all([
    db.select().from(user).orderBy(desc(user.createdAt), desc(user.id)),
    db.select().from(account),
    db.select().from(holding),
    // 每用户订单数一条 groupBy 拿全，避免再逐人 count
    db
      .select({ userId: orders.userId, n: sql<number>`count(*)` })
      .from(orders)
      .groupBy(orders.userId),
    // 在途资金：一条查全再按用户内存累加（与 getPendingBuyCents 同一口径，
    // 但那次是单人查，这里是全量批量——绝不能退回「逐人查 pending」）
    db
      .select({ userId: orders.userId, amount: orders.amount })
      .from(orders)
      .where(and(eq(orders.status, "pending"), eq(orders.side, "buy"))),
  ]);
  const countMap = new Map(orderCounts.map(r => [r.userId, r.n]));
  const accountByUser = new Map(accountRows.map(a => [a.userId, a]));
  const inFlightByUser = new Map<number, number>();
  for (const r of pendingBuys) {
    inFlightByUser.set(r.userId, (inFlightByUser.get(r.userId) ?? 0) + (r.amount ?? 0));
  }

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
    const acc = accountByUser.get(u.id);
    const summary = valuatePortfolio(holdingsByUser.get(u.id) ?? [], acc?.cash ?? 0);
    // 账户口径与排行榜同源：总资产含在途，收益相对累计入金
    const inFlightCents = inFlightByUser.get(u.id) ?? 0;
    const depositedCents = (acc?.initialCash ?? 0) + (acc?.totalCheckin ?? 0);
    const totalAssetCents = summary.totalAssetCents + inFlightCents;
    const accountPnlCents = totalAssetCents - depositedCents;
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      registerIp: u.registerIp,
      registerUserAgent: u.registerUserAgent,
      registerCountry: u.registerCountry,
      registerCity: u.registerCity,
      cashCents: summary.cashCents,
      inFlightCents,
      marketValueCents: summary.marketValueCents,
      depositedCents,
      totalAssetCents,
      accountPnlCents,
      accountPnlRate: safeRate(accountPnlCents, depositedCents),
      holdingPnlCents: summary.totalPnlCents,
      orderCount: countMap.get(u.id) ?? 0,
      createdAt: u.createdAt,
      lastActiveAt: u.lastActiveAt,
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
  /** pending 买单在途资金（分）。总览卡并回持仓/总资产，与 /me 同口径 */
  pendingBuyCents: number;
  /** 该用户全部定投计划（只读列表用） */
  plans: DcaPlanView[];
}

/**
 * 单用户详情（组合 + 订单 + 在途 + 定投）。用户不存在返回 null，
 * 路由层据此抛 404——与 getHoldingDetail 的「查不到 → 404」套路一致。
 *
 * 查询数：用户 1 + 组合若干 + 订单 1 + pending 1 + 定投 1~2，单用户页远低于 D1 硬顶。
 * 收益三件套（走势/日历）由路由层另调 getProfitDetail，不塞进本函数——
 * 那边是 3+N，跟组合查询互相独立，路由层 Promise.all 并行。
 */
export async function getUserDetail(
  db: Db,
  userId: number,
): Promise<AdminUserDetail | null> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u)
    return null;

  // 组合 / 订单 / 在途 / 定投互不依赖，一波并行（跨大区时每跳都是百毫秒级往返）
  const [portfolio, orderList, pendingBuyCents, plans] = await Promise.all([
    getPortfolio(db, userId),
    getOrders(db, userId, 200),
    getPendingBuyCents(db, userId),
    getDcaPlans(db, userId),
  ]);

  return {
    user: { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt },
    portfolio,
    orders: orderList,
    pendingBuyCents,
    plans,
  };
}
