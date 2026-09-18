import Decimal from "decimal.js";
import { NAV_SCALE, navToDecimal, roundInt, safeRate, sharesToDecimal, YUAN } from "./money";

/** 单只持仓的估值结果 */
export interface HoldingValuation {
  fundCode: string;
  /** 持有份额 ×10000 */
  sharesScaled: number;
  /** 持仓成本（分） */
  costCents: number;
  /** 估值所用净值 ×10000 */
  navScaled: number;
  /** 市值（分） */
  marketValueCents: number;
  /** 浮动盈亏（分） */
  pnlCents: number;
  /** 收益率（普通小数，如 0.0667 表示 +6.67%） */
  pnlRate: number;
}

/** 组合汇总估值结果 */
export interface PortfolioValuation {
  /** 总资产（分）= 持仓市值 + 现金 */
  totalAssetCents: number;
  /** 持仓市值合计（分） */
  marketValueCents: number;
  /** 可用现金（分） */
  cashCents: number;
  /**
   * 总浮动盈亏（分）= 市值 − 持仓成本。
   *
   * ⚠️ **持仓口径**：既不含已实现盈亏，也不含现金与在途，与排行榜的「总收益」
   * 不是同一个数（见 docs/money-audit.md）。字段名里的 total 指的是「全部持仓
   * 之和」，不是「全站总收益」——展示时请标明「浮动盈亏 / 持仓收益」，别只写「总收益」。
   */
  totalPnlCents: number;
}

/**
 * 份额 × 净值 → 市值（分）。估值取整的**唯一入口**。
 * valuateHolding、replayDailyAssets 与 fund-pnl 归因三处必须同源调用本函数——
 * 任何一处手写这个公式都可能取整不一致，导致 Σ归因 ≠ 当日总收益。
 */
export function fundMarketValueCents(
  sharesScaled: number,
  navScaled: number,
): number {
  return roundInt(
    sharesToDecimal(sharesScaled).mul(navToDecimal(navScaled)).mul(YUAN),
  );
}

/**
 * 单只持仓估值。
 *   市值 = 份额 × 净值
 *   浮动盈亏 = 市值 − 成本
 *   收益率 = 浮动盈亏 ÷ 成本（成本为 0 时返回 0，避免除零得 NaN/Infinity）
 */
export function valuateHolding(i: {
  fundCode: string;
  totalSharesScaled: number;
  totalCostCents: number;
  navScaled: number;
}): HoldingValuation {
  // 市值取整收口在 fundMarketValueCents（全站唯一入口）
  const marketValueCents = fundMarketValueCents(
    i.totalSharesScaled,
    i.navScaled,
  );
  const pnlCents = marketValueCents - i.totalCostCents;
  // 成本为 0（清仓行 / 空仓）时 safeRate 给 null，这里回落 0：
  // 持仓级收益率没有「无数据」的展示态，0 是唯一安全的默认
  const pnlRate = safeRate(pnlCents, i.totalCostCents) ?? 0;

  return {
    fundCode: i.fundCode,
    sharesScaled: i.totalSharesScaled,
    costCents: i.totalCostCents,
    navScaled: i.navScaled,
    marketValueCents,
    pnlCents,
    pnlRate,
  };
}

/**
 * 无净值时的成本价兜底净值：把「每份成本」换算成净值口径（×10000）。
 *   navScaled = 成本（分）× 10⁶ ÷ 份额（×10000）
 * 用它喂 valuateHolding 可得 市值 ≈ 成本、盈亏 ≈ 0（先取整再估值，极端数字差 1 分内）。
 * 份额为 0 时返回 NAV_SCALE（净值 1.0）：市值恒为 0，清仓行不给假数字。
 *
 * ⚠️ 曾有一版内联公式少乘 100（算出的是「分/份」而非「元/份」），兜底市值被
 * 低估百倍。调用方（getPortfolio / getHoldingDetail / leaderboard-service）
 * 别再内联手写这个换算，统一走本函数。
 */
export function costBasisNavScaled(
  costCents: number,
  sharesScaled: number,
): number {
  if (sharesScaled <= 0)
    return NAV_SCALE;
  return roundInt(new Decimal(costCents).mul(1_000_000).div(sharesScaled));
}

/**
 * 组合汇总。总资产 = 持仓市值 + 现金。
 *
 * 刻意**不再产出组合级收益率**：这个率的分母是「总成本」（不含现金），与
 * 总览卡 / 排行榜账户口径的分母（累计入金）不是一个东西，而它们都会被叫做
 * 「收益率」。实测同一份持仓在两种口径下能差 2.8 倍（64,071 元闲钱进分母），
 * 曾导致排行榜 −0.77% 与持仓列表 −2.15% 同屏对不上。需要账户级收益率的
 * 调用方请用 domain/leaderboard 的 computeLeaderboard 或 domain/money 的 safeRate。
 */
export function valuatePortfolio(
  holdings: HoldingValuation[],
  cashCents: number,
): PortfolioValuation {
  const marketValueCents = holdings.reduce((s, h) => s + h.marketValueCents, 0);
  const totalCostCents = holdings.reduce((s, h) => s + h.costCents, 0);
  const totalPnlCents = marketValueCents - totalCostCents;

  return {
    totalAssetCents: marketValueCents + cashCents,
    marketValueCents,
    cashCents,
    totalPnlCents,
  };
}

/**
 * 持仓对账：校验 Σshare_lot 是否与 holding 汇总完全一致。
 *
 * 撮合引擎在同一个 D1 batch 内维护 share_lot 与 holding，
 * 本函数是撮合后的自检闸门——差一分就说明写错了，应当告警。
 */
export function reconcile(
  lots: { sharesScaled: number; costCents: number }[],
  holding: { totalSharesScaled: number; totalCostCents: number },
): boolean {
  const shares = lots.reduce((s, l) => s + l.sharesScaled, 0);
  const cost = lots.reduce((s, l) => s + l.costCents, 0);
  return (
    shares === holding.totalSharesScaled && cost === holding.totalCostCents
  );
}
