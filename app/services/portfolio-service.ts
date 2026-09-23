import type { Db } from "~/db/client";
import type { FundRow } from "~/db/schema";
import type { HoldingValuation, PortfolioValuation } from "~/domain/portfolio";
import type { RedeemTier, ShareLotInput } from "~/domain/redeem";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { runBatch } from "~/db/client";
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
  NAV_BACKFILL_MIN_ROWS,
  navBackfillStamp,
  shouldBackfillNav,
} from "~/domain/nav-backfill";
import {

  costBasisNavScaled,
  valuateHolding,
  valuatePortfolio,
} from "~/domain/portfolio";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { fetchNavHistoryDetailed, NAV_FETCH_TIMEOUT_MS } from "./fund-data";

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
  /** 申购费率（万分之，优惠后）。行内买入抽屉试算用（ux-polish #5） */
  purchaseRate: number;
  /** 起购金额（分）。行内买入抽屉校验用 */
  minPurchase: number;
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
      // 费率/起购纯透出：fundMap 来自上面的全字段查询，零新增 SQL
      purchaseRate: fundMap.get(r.fundCode)?.purchaseRate ?? 0,
      minPurchase: fundMap.get(r.fundCode)?.minPurchase ?? 0,
    };
  });

  return {
    summary: valuatePortfolio(holdings, cash),
    holdings,
  };
}

/**
 * 用户 pending 买单的在途资金合计（分）。
 *
 * 买单下单即冻结现金（trade.ts 直接扣 account.cash），份额要等 T+1 撮合才生成——
 * pending 窗口内这笔钱既不在持仓市值也不在可用余额里，总资产凭空少一笔
 * （与 leaderboard-service 的 inFlightCashCents 是同一笔账，那边为榜单口径补过）。
 *
 * **三个调用方都必须调**：/me、/admin/users/:id、以及 /master 与首页这两个公开页。
 * （2026-09-18 起公开页也调：此前「公开盘保持纯市值口径，别多背一条查询」的取舍，
 * 代价是每个交易日 10:00→20:30 之间 /master 与 /leaderboard 对同一笔钱给出
 * 相差一个定投额的总资产，净值拉不到顺延时会一直错到周一。多一条查询换口径自洽。）
 */
export async function getPendingBuyCents(db: Db, userId: number): Promise<number> {
  const rows = await db
    .select({ amount: orders.amount })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "pending"),
        eq(orders.side, "buy"),
      ),
    );
  // 整数分直接累加（远低于 2^53，零误差）；amount 理论非 null（买单必填），兜 0 防御
  return rows.reduce((s, r) => s + (r.amount ?? 0), 0);
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
  /**
   * **已成交**期数（= 该基金上 `source='dca'` 且 `status='confirmed'` 的订单数）。
   * 不读 `dca_plan.run_count`——那个字段在下单时就 +1，撮合失败退款或用户撤单
   * 都不回滚，会永久虚高（见 docs/money-audit.md §5）。
   */
  runCount: number;
  /** **已成交**累计投入（分），口径同 runCount（Σ 已确认 dca 买单的下单金额） */
  totalInvested: number;
  createdAt: number;
}

/**
 * 读取用户的定投计划。fundCode 传入时只返回该基金的计划（持仓详情页定投页签用）。
 *
 * ⚠️ 「执行次数 / 累计投入」由 `orders` 现场聚合，**不读 dca_plan 的冗余计数**：
 * 冗余字段是「下单即计数」，而真实口径是「成交才计数」，两者在失败/撤单路径上
 * 会永久分叉。聚合按 (userId, fundCode) 分组，同基金建了两个计划的极端情况下
 * 两边会分到同一份聚合值——这是刻意的取舍：宁可两个计划显示同一份真实成交额，
 * 也不要一个虚高的假数字。
 */
export async function getDcaPlans(
  db: Db,
  userId: number,
  fundCode?: string,
): Promise<DcaPlanView[]> {
  const rows = await db
    .select()
    .from(dcaPlan)
    .where(
      fundCode
        ? and(eq(dcaPlan.userId, userId), eq(dcaPlan.fundCode, fundCode))
        : eq(dcaPlan.userId, userId),
    )
    .orderBy(desc(dcaPlan.createdAt));

  if (rows.length === 0)
    return [];

  const codes = [...new Set(rows.map(r => r.fundCode))];
  const [funds, agg] = await Promise.all([
    db.select().from(fund).where(inArray(fund.code, codes)),
    db
      .select({
        fundCode: orders.fundCode,
        n: sql<number>`count(*)`,
        // 下单金额（含内扣申购费）而非成交净额：这是用户真掏出去的钱
        invested: sql<number>`coalesce(sum(${orders.amount}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.source, "dca"),
          eq(orders.status, "confirmed"),
        ),
      )
      .groupBy(orders.fundCode),
  ]);
  const nameMap = new Map(funds.map(f => [f.code, f.name]));
  const aggMap = new Map(agg.map(r => [r.fundCode, r]));

  return rows.map((r) => {
    const a = aggMap.get(r.fundCode);
    return {
      ...r,
      fundName: nameMap.get(r.fundCode) ?? r.fundCode,
      runCount: Number(a?.n ?? 0),
      totalInvested: Number(a?.invested ?? 0),
    };
  });
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

/** 净值序列的一行（getNavSeries 的输出、ensureNavHistory 的输入输出） */
export interface NavSeriesRow {
  navDate: string;
  unitNav: number;
  /** 累计净值（复权）×10000；老数据可能为 0 */
  accNav: number;
  growthRate: number;
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
): Promise<NavSeriesRow[]> {
  const rows = await db
    .select({
      navDate: fundNav.navDate,
      unitNav: fundNav.unitNav,
      // 复权净值（累计净值）：定投回测用「分红再投」口径算收益，
      // 图表只取 unitNav/growthRate，多带一列不额外花查询
      accNav: fundNav.accNav,
      growthRate: fundNav.growthRate,
    })
    .from(fundNav)
    .where(eq(fundNav.fundCode, fundCode))
    .orderBy(desc(fundNav.navDate))
    .limit(days ?? 3650);

  // 画图要正序
  return rows.reverse();
}

/** ensureNavHistory 的可选项；默认值即基金页口径 */
export interface NavBackfillOptions {
  /** 行数阈值：基金页 60，回测页 250（按天定投默认 250 期） */
  minRows?: number;
  /** 单次最多回填多少行 */
  maxRows?: number;
  /** 单页超时：访客在等的路径用默认值，后台/撮合用后台档（见 fund-data） */
  timeoutMs?: number;
}

/**
 * 净值历史「够用就好」的保障：不足 minRows 条就回填 maxRows 条（默认 400，
 * 约 400 个交易日）。供需要长历史的页面用（定投回测要足够多的月数）。
 *
 * 为什么条件不是「库里为空」：settle 的 cron 每天只拉最近 30 条做滑动窗口同步，
 * 任何基金只要有持仓/待确认单，在被人类访问之前就已有数据——写成 length === 0
 * 的话回填永远不触发，库里永远只有薄薄一层滑动窗口（实测 14 只基金全是
 * 20~23 条，图表与近 1 年阶段涨幅全都残缺）。60 ≈ 一个季度交易日，低于它
 * 必是残缺历史。
 *
 * ⚠️ 光看行数会漏一类基金：**上市不足 60 个交易日的新基金**，上游总共就没有
 * 60 行（2026-09-23 实测 028439 只有 50 行），条件对它**永久成立** ⇒ 每次访问
 * 白拉 3 页东财 + 写一遍 D1，永不收敛。所以再叠一道 `fund.nav_backfilled_at`
 * 记忆化闸门（不论成败都记，单基金 ≤ 4 次/天），判断逻辑在 domain/nav-backfill。
 *
 * 依赖方向：本文件 → fund-data（fetchNavHistory）。**不能反过来**——
 * fund-data 不 import 本模块，否则成环。
 * 基金页 loader 已改为调用本函数（此前那份内联同款逻辑已删），口径唯一。
 */
export async function ensureNavHistory(
  db: Db,
  env: Env,
  fundCode: string,
  opts: NavBackfillOptions = {},
): Promise<NavSeriesRow[]> {
  const {
    minRows = NAV_BACKFILL_MIN_ROWS,
    maxRows = 400,
    timeoutMs = NAV_FETCH_TIMEOUT_MS,
  } = opts;
  const series = await getNavSeries(db, fundCode);

  const f = await db.query.fund.findFirst({
    where: eq(fund.code, fundCode),
    columns: { navBackfilledAt: true, navBackfilledTarget: true },
  });
  const now = Date.now();
  if (
    !shouldBackfillNav({
      rowCount: series.length,
      backfilledAt: f?.navBackfilledAt ?? null,
      backfilledTarget: f?.navBackfilledTarget ?? null,
      now,
      minRows,
    })
  ) {
    return series;
  }

  /** 记一笔尝试：成功记满间隔，失败只记短冷却（见 domain/nav-backfill 的论证） */
  const stamp = async (succeeded: boolean) => {
    const s = navBackfillStamp({ now, minRows, succeeded });
    await db
      .update(fund)
      .set({ navBackfilledAt: s.at, navBackfilledTarget: s.target })
      .where(eq(fund.code, fundCode));
  };

  let fetched: Awaited<ReturnType<typeof fetchNavHistoryDetailed>> = {
    rows: [],
    complete: false,
  };
  try {
    // 要「完整度」：整波全败时只拿到部分行，不能按成功档记账（见 fetchNavHistoryDetailed）
    fetched = await fetchNavHistoryDetailed(env, fundCode, maxRows, timeoutMs);
  }
  catch (err) {
    // 回填是「锦上添花」，绝不该把页面或后台任务打成异常
    console.error(`[nav] 基金 ${fundCode} 回填净值异常：`, err);
  }
  const { rows, complete } = fetched;

  if (rows.length === 0) {
    // 东财拉不到（节假日抖动/链路慢）：把现有的还给调用方，并只锁短冷却——
    // 拉取失败不写任何数据，若按成功档锁满 6 小时就成了「数据停一天」
    await stamp(false);
    return series;
  }

  try {
    // 400 行走 batch 一次提交：逐条 await 是 400 次 D1 往返（约 1.2s），
    // 会把触发回填的那次页面访问拖到超时边缘。onConflictDoNothing 保持
    // 「已存在的日期不动」语义（与 cron 的 upsert 覆盖策略不同——回填只补洞，
    // 不覆盖 cron 已写的当日新值）
    await runBatch(
      db,
      rows.map(r =>
        db
          .insert(fundNav)
          .values({
            fundCode,
            navDate: r.navDate,
            unitNav: r.unitNav,
            accNav: r.accNav,
            growthRate: r.growthRate,
          })
          .onConflictDoNothing(),
      ),
    );
  }
  catch (err) {
    // 落库失败：不记账（下次访问再试一遍，拉取是幂等的）
    console.error(`[nav] 基金 ${fundCode} 回填落库失败：`, err);
    return series;
  }

  // 记账放在真正成功之后（2026-09-23 对抗 review 修正：原先「先记账再拉」
  // 会在平台掐死后台任务/链路抖动时把闸门白烧 6 小时）。
  // 部分成功（中途一整波全败，只拿到首页那 20 行）同样只锁短冷却——否则库里
  // 明明才二十来行，回测页却要等满 6 小时才有人再补
  // （2026-09-23 CodeRabbit 评审：原先只判 rows.length === 0，部分结果被记成成功）
  await stamp(complete);
  return getNavSeries(db, fundCode);
}

/**
 * 单只持仓详情视图：在 HoldingView 基础上追加批次、待赎回占用、费率档等
 * 赎回试算所需信息，供 /me/holdings/:code 详情页使用。
 */
export interface HoldingDetailView extends HoldingView {
  /**
   * 份额批次，展示倒序（confirmDate 降、id 降，最新在前）；
   * FIFO 消耗顺序由 calcRedeem 内部自行升序重排，与本展示序无关
   */
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
 * （包括无净值时的成本价兜底公式），是「单只持仓详情页数据与 /me 持仓汇总
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

  // 份额批次，倒序（最新在前）：FIFO 计算不依赖这里（calcRedeem 自行
  // 按确认日升序重排），列表展示顺序只服务人眼——最新的批次排最上面
  const lotRows = await db
    .select()
    .from(shareLot)
    .where(and(eq(shareLot.userId, userId), eq(shareLot.fundCode, fundCode)))
    .orderBy(desc(shareLot.confirmDate), desc(shareLot.id));
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

/** 已持有速览（基金详情页顶部标识用） */
export interface HoldingBrief {
  marketValueCents: number;
  pnlCents: number;
  /** 普通小数，如 0.0123 = +1.23% */
  pnlRate: number;
}

/**
 * 读取某用户对某基金的持有速览：基金详情页「已持有」标识与两格统计的数据源。
 * 无持仓行或总份额为 0 → null（页面据此不显示标识）。
 *
 * ⚠️ 同源估值契约：与 getPortfolio / getHoldingDetail 完全相同的
 * latestNavMap + costBasisNavScaled 兜底 + valuateHolding——
 * 「已持有」是事实，不因净值缺席而消失；三处的持有金额/收益必须一字不差，
 * 别在这里另写估值。
 */
export async function getHoldingBrief(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<HoldingBrief | null> {
  const row = await db.query.holding.findFirst({
    where: and(eq(holding.userId, userId), eq(holding.fundCode, fundCode)),
  });
  if (!row || row.totalShares <= 0)
    return null;

  const navMap = await latestNavMap(db, [fundCode]);
  const navInfo = navMap.get(fundCode);
  // 无净值时成本价兜底（与 getPortfolio 同款），不返回 null
  const navScaled = navInfo
    ? navInfo.unitNav
    : costBasisNavScaled(row.totalCost, row.totalShares);

  const v = valuateHolding({
    fundCode,
    totalSharesScaled: row.totalShares,
    totalCostCents: row.totalCost,
    navScaled,
  });
  return {
    marketValueCents: v.marketValueCents,
    pnlCents: v.pnlCents,
    pnlRate: v.pnlRate,
  };
}
