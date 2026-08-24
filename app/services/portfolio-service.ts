import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '~/db/client';
import {
  account,
  dcaPlan,
  fund,
  fundNav,
  holding,
  orders,
  transactions,
} from '~/db/schema';
import {
  valuateHolding,
  valuatePortfolio,
  type HoldingValuation,
  type PortfolioValuation,
} from '~/domain/portfolio';

/**
 * 组合读取与估值编排。把 D1 数据喂给领域层的纯函数，产出页面要的视图模型。
 * 被 /me 与 /master 共用——主人的盘就是公开的那个盘，一份代码两种身份。
 */

/** 带基金名称的持仓估值 */
export interface HoldingView extends HoldingValuation {
  fundName: string;
  fundType: string;
  /** 估值所用净值的日期，便于页面标注「截至 X 日」 */
  navDate: string | null;
}

export interface PortfolioView {
  summary: PortfolioValuation;
  holdings: HoldingView[];
}

/** 取每只基金的最新净值（日期 + 净值） */
async function latestNavMap(
  db: Db,
  codes: string[],
): Promise<Map<string, { navDate: string; unitNav: number }>> {
  const map = new Map<string, { navDate: string; unitNav: number }>();
  if (codes.length === 0) return map;

  // 每只基金取 nav_date 最大的那条
  const rows = await db
    .select({
      fundCode: fundNav.fundCode,
      navDate: sql<string>`max(${fundNav.navDate})`,
    })
    .from(fundNav)
    .where(inArray(fundNav.fundCode, codes))
    .groupBy(fundNav.fundCode);

  for (const r of rows) {
    const nav = await db.query.fundNav.findFirst({
      where: and(
        eq(fundNav.fundCode, r.fundCode),
        eq(fundNav.navDate, r.navDate),
      ),
    });
    if (nav) {
      map.set(r.fundCode, { navDate: nav.navDate, unitNav: nav.unitNav });
    }
  }
  return map;
}

/**
 * 读取某用户的完整组合视图（总资产 + 各持仓估值）。
 *
 * 没有净值记录的持仓用成本价兜底估值，避免市值显示为 0 惊到用户。
 */
export async function getPortfolio(
  db: Db,
  userId: number,
): Promise<PortfolioView> {
  const acc = await db.query.account.findFirst({
    where: eq(account.userId, userId),
  });
  const cash = acc?.cash ?? 0;

  const rows = await db
    .select()
    .from(holding)
    .where(eq(holding.userId, userId));
  // 过滤掉已清仓的记录（份额为 0）
  const active = rows.filter((r) => r.totalShares > 0);

  const codes = active.map((r) => r.fundCode);
  const navMap = await latestNavMap(db, codes);

  const funds =
    codes.length > 0
      ? await db.select().from(fund).where(inArray(fund.code, codes))
      : [];
  const fundMap = new Map(funds.map((f) => [f.code, f]));

  const holdings: HoldingView[] = active.map((r) => {
    const navInfo = navMap.get(r.fundCode);
    // 无净值时用成本价兜底：市值 = 成本，盈亏为 0，避免显示成腰斩
    const navScaled = navInfo
      ? navInfo.unitNav
      : r.totalShares > 0
        ? Math.round((r.totalCost / r.totalShares) * 10000 * 100) / 100
        : 10000;

    const v = valuateHolding({
      fundCode: r.fundCode,
      totalSharesScaled: r.totalShares,
      totalCostCents: r.totalCost,
      navScaled: Math.round(navScaled),
    });

    return {
      ...v,
      fundName: fundMap.get(r.fundCode)?.name ?? r.fundCode,
      fundType: fundMap.get(r.fundCode)?.type ?? '',
      navDate: navInfo?.navDate ?? null,
    };
  });

  return {
    summary: valuatePortfolio(holdings, cash),
    holdings,
  };
}

/** 订单视图（带基金名） */
export interface OrderView {
  id: number;
  fundCode: string;
  fundName: string;
  side: 'buy' | 'sell';
  status: 'pending' | 'confirmed' | 'failed';
  source: 'manual' | 'dca';
  amount: number | null;
  shares: number | null;
  placeDate: string;
  confirmDate: string;
  dealNav: number | null;
  dealShares: number | null;
  dealAmount: number | null;
  fee: number | null;
  failReason: string | null;
  createdAt: number;
}

/** 读取用户订单（倒序，默认最近 100 条） */
export async function getOrders(
  db: Db,
  userId: number,
  limit = 100,
): Promise<OrderView[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);

  const codes = [...new Set(rows.map((r) => r.fundCode))];
  const funds =
    codes.length > 0
      ? await db.select().from(fund).where(inArray(fund.code, codes))
      : [];
  const nameMap = new Map(funds.map((f) => [f.code, f.name]));

  return rows.map((r) => ({
    ...r,
    fundName: nameMap.get(r.fundCode) ?? r.fundCode,
  }));
}

/** 定投计划视图（带基金名） */
export interface DcaPlanView {
  id: number;
  fundCode: string;
  fundName: string;
  amount: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  status: 'active' | 'paused';
  nextRun: string;
  runCount: number;
  totalInvested: number;
  createdAt: number;
}

/** 读取用户的定投计划 */
export async function getDcaPlans(
  db: Db,
  userId: number,
): Promise<DcaPlanView[]> {
  const rows = await db
    .select()
    .from(dcaPlan)
    .where(eq(dcaPlan.userId, userId))
    .orderBy(desc(dcaPlan.createdAt));

  const codes = [...new Set(rows.map((r) => r.fundCode))];
  const funds =
    codes.length > 0
      ? await db.select().from(fund).where(inArray(fund.code, codes))
      : [];
  const nameMap = new Map(funds.map((f) => [f.code, f.name]));

  return rows.map((r) => ({
    ...r,
    fundName: nameMap.get(r.fundCode) ?? r.fundCode,
  }));
}

/** 资金流水视图 */
export interface TransactionView {
  id: number;
  type: 'checkin' | 'buy' | 'sell' | 'fee' | 'init';
  amount: number;
  balance: number;
  orderId: number | null;
  note: string;
  createdAt: number;
}

/** 读取用户资金流水（倒序） */
export async function getTransactions(
  db: Db,
  userId: number,
  limit = 100,
): Promise<TransactionView[]> {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(limit);
}

/**
 * 组合收益曲线：把每日总资产算出来画图。
 *
 * 简化实现：以资金流水的余额快照为现金基线，
 * 叠加当日各持仓的市值。对模拟盘足够，且不需要额外快照表。
 */
export interface EquityPoint {
  date: string;
  /** 总资产（分） */
  totalAsset: number;
}

/**
 * 取某只基金的净值序列，供详情页画图。
 * @param days 取最近多少天；不传取全部
 */
export async function getNavSeries(
  db: Db,
  fundCode: string,
  days?: number,
): Promise<{ navDate: string; unitNav: number; growthRate: number }[]> {
  const rows = await db
    .select({
      navDate: fundNav.navDate,
      unitNav: fundNav.unitNav,
      growthRate: fundNav.growthRate,
    })
    .from(fundNav)
    .where(eq(fundNav.fundCode, fundCode))
    .orderBy(desc(fundNav.navDate))
    .limit(days ?? 3650);

  // 画图要正序
  return rows.reverse();
}
