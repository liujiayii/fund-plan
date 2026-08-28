import Decimal from "decimal.js";
import { NAV_SCALE, navToDecimal, roundInt, sharesToDecimal, YUAN } from "./money";

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
  /** 总浮动盈亏（分） */
  totalPnlCents: number;
  /** 总收益率（普通小数） */
  totalPnlRate: number;
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
  const marketValueCents = roundInt(
    sharesToDecimal(i.totalSharesScaled).mul(navToDecimal(i.navScaled)).mul(YUAN),
  );
  const pnlCents = marketValueCents - i.totalCostCents;
  const pnlRate
    = i.totalCostCents === 0
      ? 0
      : new Decimal(pnlCents).div(i.totalCostCents).toNumber();

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
 * 组合汇总。总收益率按「总盈亏 ÷ 总成本」计算，
 * 不含现金——现金没有成本，掺进去会稀释真实投资收益率。
 */
export function valuatePortfolio(
  holdings: HoldingValuation[],
  cashCents: number,
): PortfolioValuation {
  const marketValueCents = holdings.reduce((s, h) => s + h.marketValueCents, 0);
  const totalCostCents = holdings.reduce((s, h) => s + h.costCents, 0);
  const totalPnlCents = marketValueCents - totalCostCents;
  const totalPnlRate
    = totalCostCents === 0
      ? 0
      : new Decimal(totalPnlCents).div(totalCostCents).toNumber();

  return {
    totalAssetCents: marketValueCents + cashCents,
    marketValueCents,
    cashCents,
    totalPnlCents,
    totalPnlRate,
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
