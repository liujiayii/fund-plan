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
 *
 * 口径（对外文案必须与之一致，改实现要同步文案与单测）：
 *   1. 每月**首个有净值的交易日**买一次。不用交易日历硬算——有净值的那天
 *      必然是交易日，1 号逢休市/长假自然顺延，比查节假日表更稳（还顺带
 *      容忍了数据缺口：某月整月没数据就跳过该月，不拿邻月顶替）。
 *   2. 申购费走**内扣法**（`calcPurchase`，与站内真实撮合同一个函数）：
 *      净额 = 金额 ÷ (1 + 费率)——**不是** × (1 − 费率)，后者是外扣法，费用会多算。
 *      投入仍记毛额（用户花的钱没少）。
 *   3. 净值取**复权净值**（累计净值），等价于「分红再投」；缺累计净值的
 *      老数据回落单位净值。
 *   4. 最大回撤取「已投份额市值」序列的峰谷——未投出的现金不算持有，
 *      否则定投的回撤会被现金垫子永远压成 0，失去意义。
 *
 * 期数不足 DCA_BACKTEST_MIN_PERIODS 时返回 null：一两期的「回测」不是内容，
 * 是坏页，宁可让页面不渲染这块（调用方据此回落到通用文案）。
 */

/** 每期投入：1000 元。页面文案写死了这个数，改这里要同步文案与单测 */
export const DCA_BACKTEST_AMOUNT_CENTS = 100_000;

/** 回测期数上限：一年 12 期（历史净值回填的是 400 天，刚好够） */
export const DCA_BACKTEST_MAX_PERIODS = 12;

/** 最少期数：不足就当没算（见文件头注释） */
export const DCA_BACKTEST_MIN_PERIODS = 3;

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
}

/** 回测结果，全部是整数（分 / 万分之 / ×10000 净值） */
export interface DcaBacktestResult {
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
  /** 首期买入日 */
  from: string;
  /** 估值截止日（最后一个净值日） */
  to: string;
}

/** 把 D1 取出的净值行转成回测口径：取复权净值，缺失（0）回落单位净值 */
export function toBacktestSeries(rows: readonly BacktestNavRow[]): BacktestNavPoint[] {
  return rows.map(r => ({ navDate: r.navDate, nav: r.accNav > 0 ? r.accNav : r.unitNav }));
}

/** 份额（×10000）× 净值（×10000）→ 市值（分） */
function valueCents(sharesScaled: number, nav: number): number {
  return roundInt(new Decimal(sharesScaled).mul(nav).div(1_000_000));
}

export function runDcaBacktest(
  series: readonly BacktestNavPoint[],
  input: DcaBacktestInput,
): DcaBacktestResult | null {
  // 脏数据防御：入参非法宁可不算（卡片整块不渲染），也不要抛出去把整页打成 500
  if (input.amountCents <= 0 || input.purchaseRate < 0) {
    return null;
  }

  // 非法净值整点丢弃（0 会把份额除爆），并按日期升序——D1 侧本来就是升序，
  // 这里只是不让「调用方顺序错了」变成静默的错数字
  const points = series
    .filter(p => p.nav > 0)
    .slice()
    .sort((a, b) => (a.navDate < b.navDate ? -1 : a.navDate > b.navDate ? 1 : 0));
  if (points.length < 2) {
    return null;
  }

  // 每月首个点即当期买入日（见文件头口径 1）
  const monthly: BacktestNavPoint[] = [];
  let seenMonth = "";
  for (const p of points) {
    const month = p.navDate.slice(0, 7);
    if (month !== seenMonth) {
      monthly.push(p);
      seenMonth = month;
    }
  }
  if (monthly.length < DCA_BACKTEST_MIN_PERIODS) {
    return null;
  }
  const buys = monthly.slice(-DCA_BACKTEST_MAX_PERIODS);

  const investedCents = buys.length * input.amountCents;

  // 逐点推进：到买入日先买入、再按当日净值估值——同一笔钱当天就在市场里
  const first = buys[0]!;
  const last = points.at(-1)!;
  let buyCursor = 0;
  let shares = 0;
  let peak: Decimal | null = null;
  let maxDrawdown = new Decimal(0);

  for (const p of points) {
    if (p.navDate < first.navDate) {
      continue;
    }
    while (buyCursor < buys.length && buys[buyCursor]!.navDate <= p.navDate) {
      // 每期买入直接复用撮合用过的 calcPurchase（内扣费 + 份额取整的唯一出处）
      shares += calcPurchase({
        amountCents: input.amountCents,
        navScaled: buys[buyCursor]!.nav,
        purchaseRate: input.purchaseRate,
      }).sharesScaled;
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

  return {
    periods: buys.length,
    investedCents,
    finalValueCents,
    returnRate: roundInt(
      new Decimal(finalValueCents).minus(investedCents).div(investedCents).mul(RATE_SCALE),
    ),
    maxDrawdown: roundInt(maxDrawdown.mul(RATE_SCALE)),
    avgCostNav: roundInt(new Decimal(investedCents).mul(1_000_000).div(shares)),
    lumpSumRate: roundInt(
      new Decimal(lumpFinalCents).minus(investedCents).div(investedCents).mul(RATE_SCALE),
    ),
    from: first.navDate,
    to: last.navDate,
  };
}
