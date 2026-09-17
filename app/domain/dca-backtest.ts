import dayjs from "dayjs";
import Decimal from "decimal.js";
import { RATE_SCALE, roundInt } from "./money";
import { calcPurchase } from "./purchase";

/**
 * 定投回测（纯函数，不依赖 D1 / 网络）。
 *
 * 为什么要有它：基金详情页原先展示的全是东财数据，一页页长得一样，
 * 搜索引擎眼里是「采集站」（2026-09-17 排查收录问题时的结论）。
 * 这里的数字全部由**我们库里的逐日净值**算出来——每只基金的期数、
 * 市值、收益率、回撤都不同，这才是「值得被收录的独有内容」。
 * 2026-09-17 起 `/tools/dca-backtest` 把它做成了可调参数的独立页。
 *
 * 口径（对外文案必须与之一致，改实现要同步文案与单测）：
 *   1. 买入日 = **每一期的首个有净值的交易日**（频率见 DcaFrequency：按月/按周/按天）。
 *      不用交易日历硬算——有净值的那天必然是交易日，逢休市/长假自然顺延，
 *      比查节假日表更稳（还顺带容忍了数据缺口：某期整期没数据就跳过该期，
 *      不拿邻期顶替）。
 *   2. 申购费走**内扣法**（`calcPurchase`，与站内真实撮合同一个函数）：
 *      净额 = 金额 ÷ (1 + 费率)——**不是** × (1 − 费率)，后者是外扣法，费用会多算。
 *      投入仍记毛额（用户花的钱没少）。
 *   3. 净值取**复权净值**（累计净值），等价于「分红再投」；缺累计净值的
 *      老数据回落单位净值。页面可选择单位净值口径（`toBacktestSeries` 的 adjust）。
 *   4. 最大回撤取「已投份额市值」序列的峰谷——未投出的现金不算持有，
 *      否则定投的回撤会被现金垫子永远压成 0，失去意义。
 *   5. 年化走**资金加权 XIRR**（日粒度现金流，二分求解）：定投的钱是分批进的，
 *      用「累计收益率 ÷ 年数」或简单几何年化都会系统性高估。区间不足半年
 *      不给年化（见 `DCA_BACKTEST_MIN_ANNUALIZE_DAYS`）。
 *   6. 期数由入参 `periods` 决定（不传则按频率给默认值），实际买入期数取
 *      min(periods, 该频率的可用期数)——库里的净值能撑多少期就最多回测多少期。
 *
 * 期数不足 DCA_BACKTEST_MIN_PERIODS 时返回 null：一两期的「回测」不是内容，
 * 是坏页，宁可让页面不渲染这块（调用方据此回落到通用文案）。
 */

/** 每期投入：1000 元。页面文案写死了这个数，改这里要同步文案与单测 */
export const DCA_BACKTEST_AMOUNT_CENTS = 100_000;

/**
 * 定投频率。
 *  - month：每个自然月首个有净值的交易日
 *  - week：每个**自然周**（周一~周日）首个有净值的交易日——不是「每 7 天」，
 *    否则跨年那一周会被切成两期（2025-12-29 与 2026-01-02 本是同一周）
 *  - day：每个有净值的交易日
 */
export type DcaFrequency = "day" | "week" | "month";

/** 频率在文案里的说法（页面与 meta 共用这一处，别各写一份） */
export const DCA_FREQUENCY_LABELS: Record<DcaFrequency, string> = {
  day: "每日",
  week: "每周",
  month: "每月",
};

/**
 * 默认期数：都取「一年」的量（月 12 / 周 52 / 天 250 个交易日）。
 * 历史净值回填的是 400 天，够覆盖一年。
 */
export const DCA_BACKTEST_DEFAULT_PERIODS: Record<DcaFrequency, number> = {
  day: 250,
  week: 52,
  month: 12,
};

/** 最少期数：不足就当没算（见文件头注释） */
export const DCA_BACKTEST_MIN_PERIODS = 3;

/**
 * 年化门槛（天）：区间短于半年就不折算年化。
 * 3 期、88 天的 +50% 折出来是 +1079%/年——数学上没错，但拿来当落地页的
 * 卖点是误导（真实年化本就该用更长窗口衡量）。页面见 null 就写
 * 「区间不足半年，不折算年化」。
 */
export const DCA_BACKTEST_MIN_ANNUALIZE_DAYS = 180;

/** 净值口径：acc = 累计净值（分红再投，默认）；unit = 单位净值（分红不参与） */
export type DcaAdjustMode = "acc" | "unit";

/** 回测用的净值观察点：升序、按日 */
export interface BacktestNavPoint {
  /** 净值日期 YYYY-MM-DD */
  navDate: string;
  /** 复权净值 ×10000（累计净值；缺则单位净值） */
  nav: number;
}

/** 库里取出来的净值行（只要求这几个字段，避免 domain 依赖 service 的类型） */
export interface BacktestNavRow {
  navDate: string;
  /** 单位净值 ×10000 */
  unitNav: number;
  /** 累计净值 ×10000，0 表示缺失 */
  accNav: number;
}

/** 回测入参 */
export interface DcaBacktestInput {
  /** 每期投入（分） */
  amountCents: number;
  /** 申购费率（万分之，与 DB 同口径） */
  purchaseRate: number;
  /**
   * 回测最近 N 期（不传就按频率取 `DCA_BACKTEST_DEFAULT_PERIODS`）。
   * 非整数或低于 `DCA_BACKTEST_MIN_PERIODS` 一律返回 null——
   * 宁可不算，也不要静默算成别的期数（页面上还显示着用户填的数）。
   */
  periods?: number;
  /** 定投频率，默认按月（基金页那张固定卡的口径） */
  frequency?: DcaFrequency;
}

/** 逐期明细的一行：页面表格直接渲染，也是「逐月定投实际发生了什么」的凭证 */
export interface DcaBacktestPeriod {
  /** 买入日（该月首个有净值的交易日） */
  navDate: string;
  /** 买入净值 ×10000 */
  nav: number;
  /** 本期确认份额 ×10000 */
  sharesScaled: number;
  /** 截至本期累计投入（分，含申购费） */
  investedCents: number;
  /** 本期买入后按本期净值估的持仓市值（分） */
  valueCents: number;
  /** 截至本期的累计收益率 ×10000（万分之，可负） */
  returnRate: number;
}

/** 回测结果，全部是整数（分 / 万分之 / ×10000 净值） */
export interface DcaBacktestResult {
  /** 定投频率——「期」的含义由它决定，文案与表格都靠它解释 */
  frequency: DcaFrequency;
  /** 实际买入期数 */
  periods: number;
  /** 累计投入（分，含申购费） */
  investedCents: number;
  /** 期末市值（分） */
  finalValueCents: number;
  /** 累计收益率 ×10000（万分之，可负） */
  returnRate: number;
  /** 组合市值最大回撤 ×10000（万分之，正数；全程新高则 0） */
  maxDrawdown: number;
  /** 平均成本净值 ×10000（含费，即「我的成本价」） */
  avgCostNav: number;
  /** 同期一次性买入的收益率 ×10000，给「定投 vs 一次性」做对照 */
  lumpSumRate: number;
  /** 年化收益率 ×10000（资金加权 XIRR）；区间不足半年或无法求解时 null */
  annualizedRate: number | null;
  /** 逐期明细（升序，长度 = periods） */
  schedule: DcaBacktestPeriod[];
  /** 首期买入日 */
  from: string;
  /** 估值截止日（最后一个净值日） */
  to: string;
}

/**
 * 把 D1 取出的净值行转成回测口径。
 *  - acc（默认）：累计净值，缺失（0，老数据）回落单位净值——等价分红再投
 *  - unit：单位净值，不回落。缺就是缺（原样给 0），由 runDcaBacktest 的
 *    点过滤丢掉，绝不把两种口径混进同一条曲线
 */
export function toBacktestSeries(
  rows: readonly BacktestNavRow[],
  adjust: DcaAdjustMode = "acc",
): BacktestNavPoint[] {
  return rows.map((r) => {
    let nav = r.unitNav;
    if (adjust === "acc") {
      nav = r.accNav > 0 ? r.accNav : r.unitNav;
    }
    return { navDate: r.navDate, nav };
  });
}

/**
 * 该日期属于哪一期（同期只买一次，取该期**首个**有净值的交易日）。
 * 按月用 YYYY-MM；按天用日期本身；按周用**该自然周的周一**——
 * 跨年周会落到上一年，正是我们要的（2026-01-02 与 2025-12-29 同属一期）。
 */
export function dcaPeriodKey(navDate: string, frequency: DcaFrequency): string {
  if (frequency === "month") {
    return navDate.slice(0, 7);
  }
  if (frequency === "day") {
    return navDate;
  }
  const d = new Date(`${navDate}T00:00:00Z`);
  // getUTCDay：周日 0、周一 1……换算成「距本周周一几天」
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * 过滤脏净值（0 会把份额除爆）并按日期升序。
 * D1 侧本来就是升序，这里只是不让「调用方顺序错了」变成静默的错数字。
 */
function normalizePoints(series: readonly BacktestNavPoint[]): BacktestNavPoint[] {
  return series
    .filter(p => p.nav > 0)
    .slice()
    .sort((a, b) => (a.navDate < b.navDate ? -1 : a.navDate > b.navDate ? 1 : 0));
}

/** 把净值点收成「期」：每期只留首个有净值的交易日 */
function groupFirstPoints(
  points: readonly BacktestNavPoint[],
  frequency: DcaFrequency,
): BacktestNavPoint[] {
  const result: BacktestNavPoint[] = [];
  let seen = "";
  for (const p of points) {
    const key = dcaPeriodKey(p.navDate, frequency);
    if (key !== seen) {
      result.push(p);
      seen = key;
    }
  }
  return result;
}

/** 该序列在给定频率下能支撑多少期：页面拿它提示上限、领域拿它截断 */
export function countDcaPeriods(
  series: readonly BacktestNavPoint[],
  frequency: DcaFrequency,
): number {
  return groupFirstPoints(normalizePoints(series), frequency).length;
}

/** 份额（×10000）× 净值（×10000）→ 市值（分） */
function valueCents(sharesScaled: number, nav: number): number {
  return roundInt(new Decimal(sharesScaled).mul(nav).div(1_000_000));
}

/** 收益率（万分之）：(现值 − 投入) ÷ 投入 */
function rateOf(currentCents: number, investedCents: number): number {
  return roundInt(
    new Decimal(currentCents).minus(investedCents).div(investedCents).mul(RATE_SCALE),
  );
}

/** 年化用的现金流：day = 距首期买入日的天数，流出为负、流入为正 */
interface AnnualizedFlow {
  day: number;
  cents: number;
}

/** 年化搜索区间：−99.99% ~ +10000%/年。再往外不是收益率，是数据脏了 */
const XIRR_LOW = -0.9999;
const XIRR_HIGH = 100;

/**
 * 资金加权年化（XIRR）：解 Σ cf ÷ (1+r)^(天数÷365) = 0。
 *
 * 为什么二分而不是牛顿：NPV 对 r 单调（前期全是流出、末期一次流入），
 * 二分必收敛，不需要导数、也不会在某些区间乱跳。60 轮把搜索区间压到
 * 1e-16，远细于万分之的刻度。
 *
 * 为什么用浮点而不是 Decimal：这是求根，只要精度到 0.01%（RATE_SCALE）——
 * float64 的 15 位有效数字绰绰有余；而 Decimal 的非整数次幂要过 ln/exp，
 * 60 轮 × 十几笔现金流就是上千次高精度超越函数调用（免费版 Worker 每请求
 * 只有 10ms CPU）。金额口径仍然全走 Decimal，只有这个比值用浮点。
 */
function xirr(flows: readonly AnnualizedFlow[]): number | null {
  const npv = (r: number): number =>
    flows.reduce((sum, f) => sum + f.cents / (1 + r) ** (f.day / 365), 0);

  let low = XIRR_LOW;
  let high = XIRR_HIGH;
  let fLow = npv(low);
  const fHigh = npv(high);
  // 同号 = 区间内无解（极端情形，如末日市值归零）：宁可给 null，也不硬凑一个数
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) {
    return null;
  }
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (fMid === 0) {
      return mid;
    }
    if (fMid * fLow > 0) {
      low = mid;
      fLow = fMid;
    }
    else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

export function runDcaBacktest(
  series: readonly BacktestNavPoint[],
  input: DcaBacktestInput,
): DcaBacktestResult | null {
  const frequency = input.frequency ?? "month";
  const requested = input.periods ?? DCA_BACKTEST_DEFAULT_PERIODS[frequency];

  // 脏数据防御：入参非法宁可不算（卡片整块不渲染），也不要抛出去把整页打成 500
  if (
    input.amountCents <= 0
    || input.purchaseRate < 0
    || !Number.isInteger(requested)
    || requested < DCA_BACKTEST_MIN_PERIODS
  ) {
    return null;
  }

  const points = normalizePoints(series);
  if (points.length < 2) {
    return null;
  }

  // 每期的首个点即当期买入日（见文件头口径 1）
  const periodPoints = groupFirstPoints(points, frequency);
  if (periodPoints.length < DCA_BACKTEST_MIN_PERIODS) {
    return null;
  }
  // 要的期数多于库里可用的期数时按可用期数算（不假装有更长的历史）
  const buys = periodPoints.slice(-requested);

  const investedCents = buys.length * input.amountCents;

  // 逐点推进：到买入日先买入、再按当日净值估值——同一笔钱当天就在市场里
  const first = buys[0]!;
  const last = points.at(-1)!;
  let buyCursor = 0;
  let shares = 0;
  let investedSoFar = 0;
  const schedule: DcaBacktestPeriod[] = [];
  let peak: Decimal | null = null;
  let maxDrawdown = new Decimal(0);

  for (const p of points) {
    if (p.navDate < first.navDate) {
      continue;
    }
    while (buyCursor < buys.length && buys[buyCursor]!.navDate <= p.navDate) {
      const buy = buys[buyCursor]!;
      // 每期买入直接复用撮合用过的 calcPurchase（内扣费 + 份额取整的唯一出处）
      const bought = calcPurchase({
        amountCents: input.amountCents,
        navScaled: buy.nav,
        purchaseRate: input.purchaseRate,
      }).sharesScaled;
      shares += bought;
      investedSoFar += input.amountCents;
      // 逐期明细记**累计**投入与累计收益率：页面表格的最后一行必须与概览
      // 的累计投入/总收益率对得上，否则用户会以为算错了
      const boughtValue = valueCents(shares, buy.nav);
      schedule.push({
        navDate: buy.navDate,
        nav: buy.nav,
        sharesScaled: bought,
        investedCents: investedSoFar,
        valueCents: boughtValue,
        returnRate: rateOf(boughtValue, investedSoFar),
      });
      buyCursor += 1;
    }
    const value = new Decimal(shares).mul(p.nav).div(1_000_000);
    if (peak === null || value.gt(peak)) {
      peak = value;
    }
    else {
      const dd = peak.minus(value).div(peak);
      if (dd.gt(maxDrawdown)) {
        maxDrawdown = dd;
      }
    }
  }

  const finalValueCents = valueCents(shares, last.nav);

  // 对照组的「同期一次性买入」是同一笔钱（investedCents）一次买入，所以同样要扣申购费：
  // 只比首末净值会把对照值算高（费率 1.5%、净值 1.0 → 1.3 时是 30% vs 真实 28.08%）
  const lumpShares = calcPurchase({
    amountCents: investedCents,
    navScaled: first.nav,
    purchaseRate: input.purchaseRate,
  }).sharesScaled;
  const lumpFinalCents = valueCents(lumpShares, last.nav);

  // 年化：现金流 = 每期流出（金额）+ 期末一次流入（市值），日期都取真实交易日。
  // 区间不足半年直接不给（见 DCA_BACKTEST_MIN_ANNUALIZE_DAYS）
  const base = dayjs(first.navDate);
  const spanDays = dayjs(last.navDate).diff(base, "day");
  let annualizedRate: number | null = null;
  if (spanDays >= DCA_BACKTEST_MIN_ANNUALIZE_DAYS) {
    const flows: AnnualizedFlow[] = buys.map(b => ({
      day: dayjs(b.navDate).diff(base, "day"),
      cents: -input.amountCents,
    }));
    flows.push({ day: spanDays, cents: finalValueCents });
    const rate = xirr(flows);
    if (rate !== null) {
      const scaled = roundInt(new Decimal(rate).mul(RATE_SCALE));
      // +0 归一：极小的负值会被舍成 -0，-0 在断言、JSON、展示里都是噪音
      annualizedRate = scaled === 0 ? 0 : scaled;
    }
  }

  return {
    frequency,
    periods: buys.length,
    investedCents,
    finalValueCents,
    returnRate: rateOf(finalValueCents, investedCents),
    maxDrawdown: roundInt(maxDrawdown.mul(RATE_SCALE)),
    avgCostNav: roundInt(new Decimal(investedCents).mul(1_000_000).div(shares)),
    lumpSumRate: rateOf(lumpFinalCents, investedCents),
    annualizedRate,
    schedule,
    from: first.navDate,
    to: last.navDate,
  };
}
