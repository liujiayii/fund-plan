import type { Db } from "~/db/client";
import type { DailyAsset, ReplayInput } from "~/domain/asset-timeline";
import type { FundCumPnlPoint, FundDayPnl, FundPnlInput } from "~/domain/fund-pnl";
import { asc, eq, inArray } from "drizzle-orm";
import { fund, orders, transactions } from "~/db/schema";
import { replayDailyAssets } from "~/domain/asset-timeline";
import { attributeFundPnlByDate, cumulateFundPnl } from "~/domain/fund-pnl";
import { toBeijing } from "~/domain/trading-calendar";
import { getNavSeries } from "~/services/portfolio-service";

/**
 * 资产时间线 / 收益明细 service：查 D1 拼 ReplayInput，调领域层重放逐日资产；
 * getProfitDetail 在同一条输入上追加按基金归因，供收益明细页用。
 * 时间线被 /me 与 /master 的曲线图共用（Task 5 消费）。
 *
 * 五步查询均为 load-bearing——少查或查错，重放结果必错。
 * 任何一步查不到数据都不抛：空数据让 domain 返回空数组、latest=null，页面渲染空态。
 */

/**
 * 五步查询 + 映射的重放输入组装。getAssetTimeline 与 getProfitDetail 共用，
 * 是「时间线口径」与「归因口径」同源的结构性保证。
 */
async function buildReplayInput(db: Db, userId: number): Promise<{
  input: ReplayInput;
  /** 归因输入（与 input 同源的子集 + 每单现金流） */
  fundPnlInput: FundPnlInput;
  /** 累计投入本金（分）= Σ净入金（初始 + 历次签到） */
  totalDepositedCents: number;
  /** 历史确认订单涉及的全部基金代码（含已清仓） */
  fundCodes: string[];
}> {
  // ── 查询 1 & 2：全部订单 + 现金账本（互相独立，一波并行）──────────
  // 订单取全量（不只 confirmed）：份额重放只用 confirmed，但「在途申购」
  // 事件流需要每笔买单的完整生命周期（下单/改单/撤销/失败）。
  // transactions 按 createdAt asc, id asc 取全量，映射成 { date, balance }。
  // 日期转换是关键：createdAt 是 UTC 毫秒，fund_nav.navDate 是北京日历日，
  // 必须用 toBeijing 转成北京日期串才能与净值日期对齐（与 checkin-service 同款）。
  const [orderRows, txRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        fundCode: orders.fundCode,
        side: orders.side,
        status: orders.status,
        amount: orders.amount,
        placeDate: orders.placeDate,
        confirmDate: orders.confirmDate,
        dealShares: orders.dealShares,
        dealAmount: orders.dealAmount,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(asc(orders.placeDate), asc(orders.id)),
    db
      .select({
        type: transactions.type,
        amount: transactions.amount,
        balance: transactions.balance,
        createdAt: transactions.createdAt,
        orderId: transactions.orderId,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.createdAt), asc(transactions.id)),
  ]);

  // 映射成重放与归因各自要的形状。份额重放只用已成交单；归因额外带
  // 每单现金流：买 = amount（含费全额），卖 = dealAmount（扣费后净到账）——
  // 确认单这两列必已落库（settle 确认时同批写入）
  const confirmedOrders: ReplayInput["confirmedOrders"] = [];
  const fundPnlOrders: FundPnlInput["confirmedOrders"] = [];
  const fundCodeSet = new Set<string>();
  for (const row of orderRows) {
    if (row.status !== "confirmed" || row.dealShares === null)
      continue;
    confirmedOrders.push({
      fundCode: row.fundCode,
      side: row.side,
      confirmDate: row.confirmDate,
      dealShares: row.dealShares,
    });
    fundPnlOrders.push({
      fundCode: row.fundCode,
      side: row.side,
      confirmDate: row.confirmDate,
      dealShares: row.dealShares,
      cashCents: row.side === "buy" ? row.amount! : row.dealAmount!,
    });
    fundCodeSet.add(row.fundCode);
  }
  // 上面主排序是 placeDate，这里必须按 (confirmDate, id) 重排——
  // domain 前向扫描游标要求按确认日有序
  confirmedOrders.sort((a, b) =>
    a.confirmDate < b.confirmDate ? -1 : a.confirmDate > b.confirmDate ? 1 : 0,
  );
  const fundCodes = [...fundCodeSet];

  const cashLedger: ReplayInput["cashLedger"] = [];
  // ── 查询 3：净入金按日聚合 ─────────────────────────────────────────
  // 遍历同一批 transactions，仅 type 为 checkin 或 init 的 amount 按 date 累加。
  // buy/sell/fee 不算净入金：买入是现金换份额、赎回是份额换现金、fee 是成本，都不是外部入金。
  // checkin/init 的 amount 是正数（入账），直接加。
  const netDepositByDate = new Map<string, number>();
  // 收集现金账本日期，后面并进 dateAxis
  const cashDates = new Set<string>();

  // ── 在途事件流的辅助索引（同批流水的二次消费）─────────────────────
  // 改单流水（type='amend'）：amount = −差额，在途变化 = +差额 = −amount。
  // 撤销（type='cancel'）/失败退款（type='buy' 且 amount>0——下单流水
  // 只会是负数，正数 buy 必是 failOrder 的退款）的流水日期 = 在途归零日。
  const amendEventsByOrderId = new Map<number, { date: string; deltaCents: number }[]>();
  const closeDateByOrderId = new Map<number, string>();

  for (const row of txRows) {
    // createdAt 是 UTC 毫秒，转北京日期串对齐净值日历
    const date = toBeijing(new Date(row.createdAt)).format("YYYY-MM-DD");

    cashLedger.push({ date, balance: row.balance });
    cashDates.add(date);

    // 仅 checkin / init 算净入金
    if (row.type === "checkin" || row.type === "init") {
      const prev = netDepositByDate.get(date) ?? 0;
      netDepositByDate.set(date, prev + row.amount);
    }

    if (row.orderId == null)
      continue;
    if (row.type === "amend") {
      const list = amendEventsByOrderId.get(row.orderId) ?? [];
      list.push({ date, deltaCents: -row.amount });
      amendEventsByOrderId.set(row.orderId, list);
    }
    else if (row.type === "cancel" || (row.type === "buy" && row.amount > 0)) {
      closeDateByOrderId.set(row.orderId, date);
    }
  }

  // ── 在途事件流：每笔买单的生命周期 ────────────────────────────────
  //   下单日 +初始委托额（= 终值 − Σ改单差额），改单日 ±差额，
  //   确认日 −终值（换成市值）、撤销/失败日 −终值（现金已退回）。
  // pending 单不归零：它真正成交/退回后（状态翻转、流水落库），
  // 下次重算时间线自然带上归零事件——今天下单今天未撮合，在途持续到今晚。
  // 没有这条流，在途窗口里「钱已扣、份额未有」，单日收益会把申购额
  // 误记成亏损（2026-09-01 主理人实测 -8942 元即 9 笔申购总额）。
  const transitEvents: ReplayInput["transitEvents"] = [];
  for (const o of orderRows) {
    if (o.side !== "buy" || o.amount === null)
      continue;
    const amends = amendEventsByOrderId.get(o.id) ?? [];
    const amendSum = amends.reduce((s, e) => s + e.deltaCents, 0);
    transitEvents.push({ date: o.placeDate, deltaCents: o.amount - amendSum });
    transitEvents.push(...amends);
    if (o.status === "confirmed") {
      transitEvents.push({ date: o.confirmDate, deltaCents: -o.amount });
    }
    else if (o.status === "cancelled" || o.status === "failed") {
      // 归零日 = 退款流水日期；兜底 confirmDate（理论不可达：撤销/失败必留退款流水）
      const closeDate = closeDateByOrderId.get(o.id) ?? o.confirmDate;
      transitEvents.push({ date: closeDate, deltaCents: -o.amount });
    }
  }
  transitEvents.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ── 查询 4：净值序列 ──────────────────────────────────────────────
  // 对每只有确认订单的基金调 getNavSeries(db, code) 取全部净值。
  // ⚠️ 不传 days 参数！传了会截断到最近 N 天，可能丢掉某笔老订单 confirmDate 那天的 nav，
  // 导致该订单被 domain 静默跳过、份额永久不计（契约：confirmDate 必在 dateAxis 中有对应净值）。
  // getNavSeries 默认 3650 cap，对模拟盘足够。
  const navSeries = new Map<string, { navDate: string; unitNav: number }[]>();
  // 收集所有 navDate，后面并进 dateAxis
  const navDates = new Set<string>();

  // 各基金的净值序列互相独立，Promise.all 一波并行——
  // 旧写法逐基金串行 await，N 只基金就是 N 次串行往返
  const seriesList = await Promise.all(
    fundCodes.map(code => getNavSeries(db, code)),
  );
  for (let i = 0; i < fundCodes.length; i++) {
    const series = seriesList[i];
    // 丢掉 growthRate，只留 navDate + unitNav（重放不需要涨跌幅）
    const mapped = series.map(s => ({ navDate: s.navDate, unitNav: s.unitNav }));
    navSeries.set(fundCodes[i], mapped);
    for (const s of series) {
      navDates.add(s.navDate);
    }
  }

  // ── 查询 5：日期轴 ──────────────────────────────────────────────
  // dateAxis = 所有基金 navDate 的并集 ∪ 所有现金账本日期，升序去重。
  //
  // ⚠️ 并上现金账本日期的原因（对 spec §5.2 的刻意修正）：
  //    spec 原文只说 nav_date 并集，但周末签到时当天没有净值（非交易日），
  //    签到产生的现金变动会漏到下一个交易日才出现在 dateAxis 上，
  //    造成假收益——例如周五签到 +100，下周一才在 dateAxis 出现，
  //    收益算成周一赚了 100，违反期二核心断言「签到日不显示为收益」。
  //    把流水日期也并进来，签到日才有自己的 dateAxis 条目，
  //    domain 在那天能扣掉净入金（dayPnl = Δ资产 − 净入金 = 0），不显示假收益。
  const dateSet = new Set<string>();
  for (const d of navDates) dateSet.add(d);
  for (const d of cashDates) dateSet.add(d);
  const dateAxis = [...dateSet].sort();

  // 累计投入本金：Σ净入金，精确按构造（不依赖「总资产−累计收益」恒等式）
  let totalDepositedCents = 0;
  for (const v of netDepositByDate.values()) {
    totalDepositedCents += v;
  }

  // ── 拼 ReplayInput 喂领域层 ─────────────────────────────────────
  const input: ReplayInput = {
    dateAxis,
    cashLedger,
    netDepositByDate,
    confirmedOrders,
    navSeries,
    transitEvents,
  };
  const fundPnlInput: FundPnlInput = { dateAxis, navSeries, confirmedOrders: fundPnlOrders };

  return { input, fundPnlInput, totalDepositedCents, fundCodes };
}

/**
 * 查询用户资产时间线。
 *
 * @param db   Drizzle 实例（由 loader 传入）
 * @param userId 用户 ID
 * @returns daily 逐日资产快照；latest 最新一天（页面可标注日期）；
 *   totalDepositedCents 累计投入本金（Σ净入金，分）
 */
export async function getAssetTimeline(
  db: Db,
  userId: number,
): Promise<{ daily: DailyAsset[]; latest: DailyAsset | null; totalDepositedCents: number }> {
  const { input, totalDepositedCents } = await buildReplayInput(db, userId);
  const daily = replayDailyAssets(input);
  const latest = daily.length > 0 ? daily[daily.length - 1] : null;
  return { daily, latest, totalDepositedCents };
}

/** 收益明细页视图（/me/profit）。序列化安全：loader 数据要跨 SSR 脱水，一律普通对象不外泄 Map */
export interface ProfitDetailView {
  daily: DailyAsset[];
  latest: DailyAsset | null;
  /** 累计投入本金（Σ净入金，分）——总览卡算累计收益率用（/master、/admin/users/:id 复用本视图） */
  totalDepositedCents: number;
  /** 日期 → 当日各基金收益（当日有持仓/现金流的日期才有 key，含已清仓基金） */
  fundPnlByDate: Record<string, FundDayPnl[]>;
  /** fundCode → 基金名 */
  fundNames: Record<string, string>;
}

/**
 * 收益明细页数据：时间线 + 累计本金 + 全量按基金归因 + 基金名。
 * 归因一次算全量（365 天 × 10 基金 ≈ 3650 条，内存级），
 * 日历点击某天时直接查表，无额外请求。
 */
export async function getProfitDetail(
  db: Db,
  userId: number,
): Promise<ProfitDetailView> {
  const { input, fundPnlInput, totalDepositedCents, fundCodes } = await buildReplayInput(db, userId);
  const daily = replayDailyAssets(input);

  // 基金名一次 inArray 查询（含已清仓——历史日期的归因里有它们）
  const funds = fundCodes.length > 0
    ? await db
        .select({ code: fund.code, name: fund.name })
        .from(fund)
        .where(inArray(fund.code, fundCodes))
    : [];

  // Map → 普通对象（loader 序列化安全）
  const fundPnlByDate: Record<string, FundDayPnl[]> = {};
  for (const [date, list] of attributeFundPnlByDate(fundPnlInput)) {
    fundPnlByDate[date] = list;
  }
  const fundNames: Record<string, string> = {};
  for (const f of funds) {
    fundNames[f.code] = f.name;
  }

  return {
    daily,
    latest: daily.length > 0 ? daily[daily.length - 1] : null,
    totalDepositedCents,
    fundPnlByDate,
    fundNames,
  };
}

/** 单只基金的收益明细视图（/me/holdings/:code 顶部与累计盈亏卡） */
export interface FundProfitDetailView {
  /** 该基金逐日收益（升序；仅当日有份额/现金流的日期出条目，含 0 收益日） */
  dailyPnl: { date: string; dayPnlCents: number }[];
  /** 最新一条（昨日收益用，「截至」标注取它的日期）；无条目 → null */
  latest: { date: string; dayPnlCents: number } | null;
  /** 累计盈亏序列（cumulateFundPnl 产出，升序） */
  cumulative: FundCumPnlPoint[];
  /** 首笔确认日（「持有以来」口径说明用）；无条目 → null */
  firstDate: string | null;
}

/**
 * 单只基金的收益明细：全量归因后过滤目标基金（spec §3 方案一）。
 *
 * 「全量重放后过滤」是与 /me、/me/profit 同源同口径的结构性保证——
 * 归因不变量测试（Σ归因 === 当日总收益）直接覆盖单基金视图，
 * 持仓页的昨日收益/累计盈亏与全局收益页数字永不打架。
 * 代价是为一只基金付全组合重放（2+N 查询），量级与 /me 现状相同。
 */
export async function getFundProfitDetail(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<FundProfitDetailView> {
  const { fundPnlInput } = await buildReplayInput(db, userId);

  // Map 的插入序 = dateAxis 升序，遍历天然有序；同日同基金至多一条
  const dailyPnl: { date: string; dayPnlCents: number }[] = [];
  for (const [date, entries] of attributeFundPnlByDate(fundPnlInput)) {
    for (const e of entries) {
      if (e.fundCode === fundCode) {
        dailyPnl.push({ date, dayPnlCents: e.dayPnlCents });
        break;
      }
    }
  }

  return {
    dailyPnl,
    latest: dailyPnl.length > 0 ? dailyPnl[dailyPnl.length - 1]! : null,
    cumulative: cumulateFundPnl(dailyPnl),
    firstDate: dailyPnl.length > 0 ? dailyPnl[0]!.date : null,
  };
}
