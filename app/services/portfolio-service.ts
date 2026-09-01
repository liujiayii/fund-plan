import type { Db } from "~/db/client";
import type { FundRow } from "~/db/schema";
import type { HoldingValuation, PortfolioValuation } from "~/domain/portfolio";
import type { RedeemTier, ShareLotInput } from "~/domain/redeem";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  account,
  dcaPlan,
  fund,
  fundNav,
  holding,
  orders,
  shareLot,
  transactions,
} from "~/db/schema";
import {

  costBasisNavScaled,
  valuateHolding,
  valuatePortfolio,
} from "~/domain/portfolio";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";

/**
 * 组合读取与估值编排。把 D1 数据喂给领域层的纯函数，产出页面要的视图模型。
 * 被 /me 与 /master 共用——主理人的盘就是公开的那个盘，一份代码两种身份。
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

/** 取每只基金的最新净值（日期 + 净值 + 日涨跌） */
export async function latestNavMap(
  db: Db,
  codes: string[],
): Promise<Map<string, { navDate: string; unitNav: number; growthRate: number }>> {
  const map
    = new Map<string, { navDate: string; unitNav: number; growthRate: number }>();
  if (codes.length === 0)
    return map;

  // 一条 SQL 直接取出每只基金的最新净值行：外层过滤「nav_date 恰为该基金最大值」，
  // 相关子查询命中 (fund_code, nav_date) 主键索引。
  // 旧写法是「groupBy max + 逐基金串行 findFirst」的 1+N 次往返——
  // Worker 与 D1 跨大区部署时（如国内流量入欧、D1 在美西）每条往返 100~300ms，
  // 首页十来条持仓就能把 SSR 拖出数秒，这里是查询优化的重点
  const rows = await db
    .select({
      fundCode: fundNav.fundCode,
      navDate: fundNav.navDate,
      unitNav: fundNav.unitNav,
      growthRate: fundNav.growthRate,
    })
    .from(fundNav)
    .where(
      and(
        inArray(fundNav.fundCode, codes),
        sql`(select max(f2.nav_date) from fund_nav f2 where f2.fund_code = ${fundNav.fundCode}) = ${fundNav.navDate}`,
      ),
    );

  for (const nav of rows) {
    // 同时带 growthRate，供自选列表的日涨跌展示复用同一份净值口径
    map.set(nav.fundCode, {
      navDate: nav.navDate,
      unitNav: nav.unitNav,
      growthRate: nav.growthRate,
    });
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
  // 账户（现金）与持仓两查互相独立，一波并行——
  // 旧写法串行两跳，Worker 与 D1 跨大区时每跳都是一次百毫秒级往返
  const [acc, rows] = await Promise.all([
    db.query.account.findFirst({
      where: eq(account.userId, userId),
    }),
    db.select().from(holding).where(eq(holding.userId, userId)),
  ]);
  const cash = acc?.cash ?? 0;
  // 过滤掉已清仓的记录（份额为 0）
  const active = rows.filter(r => r.totalShares > 0);

  const codes = active.map(r => r.fundCode);
  // 最新净值与基金档案同样互相独立，再一波并行
  const [navMap, funds] = await Promise.all([
    latestNavMap(db, codes),
    codes.length > 0
      ? db.select().from(fund).where(inArray(fund.code, codes))
      : Promise.resolve([] as FundRow[]),
  ]);
  const fundMap = new Map(funds.map(f => [f.code, f]));

  const holdings: HoldingView[] = active.map((r) => {
    const navInfo = navMap.get(r.fundCode);
    // 无净值时用成本价兜底：市值 ≈ 成本，盈亏 ≈ 0，避免显示成腰斩
    const navScaled = navInfo
      ? navInfo.unitNav
      : costBasisNavScaled(r.totalCost, r.totalShares);

    const v = valuateHolding({
      fundCode: r.fundCode,
      totalSharesScaled: r.totalShares,
      totalCostCents: r.totalCost,
      navScaled,
    });

    return {
      ...v,
      fundName: fundMap.get(r.fundCode)?.name ?? r.fundCode,
      fundType: fundMap.get(r.fundCode)?.type ?? "",
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
  side: "buy" | "sell";
  status: "pending" | "confirmed" | "failed" | "cancelled";
  source: "manual" | "dca";
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

  const codes = [...new Set(rows.map(r => r.fundCode))];
  const funds
    = codes.length > 0
      ? await db.select().from(fund).where(inArray(fund.code, codes))
      : [];
  const nameMap = new Map(funds.map(f => [f.code, f.name]));

  return rows.map(r => ({
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
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  status: "active" | "paused";
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

  const codes = [...new Set(rows.map(r => r.fundCode))];
  const funds
    = codes.length > 0
      ? await db.select().from(fund).where(inArray(fund.code, codes))
      : [];
  const nameMap = new Map(funds.map(f => [f.code, f.name]));

  return rows.map(r => ({
    ...r,
    fundName: nameMap.get(r.fundCode) ?? r.fundCode,
  }));
}

/** 资金流水视图 */
export interface TransactionView {
  id: number;
  type: "checkin" | "buy" | "sell" | "fee" | "init" | "cancel" | "amend";
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
 * @param db Drizzle 实例
 * @param fundCode 基金代码
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

/**
 * 单只持仓详情视图：在 HoldingView 基础上追加批次、待赎回占用、费率档等
 * 赎回试算所需信息，供 /me/holdings/:code 详情页使用。
 */
export interface HoldingDetailView extends HoldingView {
  /** 份额批次，FIFO 升序：confirmDate 升、id 升 */
  lots: ShareLotInput[];
  /** 待确认赎回单占用份额 ×10000 */
  pendingShares: number;
  /** 可用于再次赎回的份额 ×10000（= sharesScaled − pendingShares） */
  availableShares: number;
  /** 赎回费率阶梯（fund.redeemTiers 覆盖，否则用默认档） */
  tiers: RedeemTier[];
  /** 申购费率（万分之） */
  purchaseRate: number;
  /** 起购金额（分） */
  minPurchase: number;
}

/**
 * 读取单只持仓详情。
 *
 * ⚠️ 同源估值契约：这里复用与 getPortfolio 完全相同的 latestNavMap + valuateHolding
 * （包括无净值时的成本价兜底公式），是「单只持仓详情页数据与 /me/holdings 汇总
 * 保持一致」这条验收标准的结构性保证——不要在这里重新实现一遍估值逻辑。
 */
export async function getHoldingDetail(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<HoldingDetailView | null> {
  const row = await db.query.holding.findFirst({
    where: and(eq(holding.userId, userId), eq(holding.fundCode, fundCode)),
  });
  if (!row)
    return null;

  const navMap = await latestNavMap(db, [fundCode]);
  const navInfo = navMap.get(fundCode);
  const f = await db.query.fund.findFirst({ where: eq(fund.code, fundCode) });

  // 无净值时用成本价兜底，公式收口在 domain 的 costBasisNavScaled（含曾经的 ×100 修复）
  const navScaled = navInfo
    ? navInfo.unitNav
    : costBasisNavScaled(row.totalCost, row.totalShares);

  const v = valuateHolding({
    fundCode,
    totalSharesScaled: row.totalShares,
    totalCostCents: row.totalCost,
    navScaled,
  });

  // 份额批次，FIFO 升序：确认日升、id 升
  const lotRows = await db
    .select()
    .from(shareLot)
    .where(and(eq(shareLot.userId, userId), eq(shareLot.fundCode, fundCode)))
    .orderBy(shareLot.confirmDate, shareLot.id);
  const lots: ShareLotInput[] = lotRows.map(l => ({
    id: l.id,
    sharesScaled: l.shares,
    costCents: l.cost,
    confirmDate: l.confirmDate,
  }));

  // 待确认的赎回单占用份额，不能重复赎回
  const pend = await db
    .select({ total: sql<number>`coalesce(sum(${orders.shares}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.fundCode, fundCode),
        eq(orders.side, "sell"),
        eq(orders.status, "pending"),
      ),
    );
  const pendingShares = Number(pend[0]?.total ?? 0);

  return {
    ...v,
    fundName: f?.name ?? fundCode,
    fundType: f?.type ?? "",
    navDate: navInfo?.navDate ?? null,
    lots,
    pendingShares,
    availableShares: row.totalShares - pendingShares,
    tiers: (f?.redeemTiers as RedeemTier[]) ?? DEFAULT_REDEEM_TIERS,
    purchaseRate: f?.purchaseRate ?? 0,
    minPurchase: f?.minPurchase ?? 1000,
  };
}

/** 读取用户某只基金的订单（倒序，默认最近 100 条），供单只持仓详情页展示交易流水 */
export async function getOrdersByFund(
  db: Db,
  userId: number,
  fundCode: string,
  limit = 100,
): Promise<OrderView[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.fundCode, fundCode)))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);

  const f = await db.query.fund.findFirst({ where: eq(fund.code, fundCode) });
  const fundName = f?.name ?? fundCode;

  return rows.map(r => ({
    ...r,
    fundName,
  }));
}
