import Decimal from "decimal.js";
import { navToDecimal, rateToRatio, roundInt, sharesToDecimal, YUAN } from "./money";
import { countDays } from "./trading-calendar";

/** 份额批次（来自 share_lot 表） */
export interface ShareLotInput {
  id: number;
  /** 该批剩余份额 ×10000 */
  sharesScaled: number;
  /** 该批剩余成本（分，含当初的申购费） */
  costCents: number;
  /** 该批确认日 YYYY-MM-DD，决定持有天数 */
  confirmDate: string;
}

/** 赎回费率阶梯档 */
export interface RedeemTier {
  /** 区间下界（含），单位：自然日 */
  minDays: number;
  /** 区间上界（不含）；null 表示无上限 */
  maxDays: number | null;
  /** 费率（万分之，如 1.5% = 150） */
  rate: number;
}

export interface RedeemInput {
  lots: ShareLotInput[];
  /** 本次赎回份额 ×10000 */
  redeemSharesScaled: number;
  /** 确认日单位净值 ×10000 */
  navScaled: number;
  /** 确认日 YYYY-MM-DD */
  confirmDate: string;
  tiers: RedeemTier[];
}

/** 单批次的赎回明细 */
export interface RedeemLotResult {
  lotId: number;
  /** 本批被消耗的份额 ×10000 */
  consumedSharesScaled: number;
  /** 本批持有天数 */
  holdDays: number;
  /** 适用费率（万分之） */
  rate: number;
  /** 本批赎回金额（分，未扣费） */
  grossCents: number;
  /** 本批赎回费（分） */
  feeCents: number;
  /** 本批到账金额（分） */
  netCents: number;
  /** 本批被消耗掉的成本（分，按份额比例摊） */
  costCents: number;
}

export interface RedeemResult {
  lotResults: RedeemLotResult[];
  totalGrossCents: number;
  totalFeeCents: number;
  totalNetCents: number;
  totalCostCents: number;
  /** 已实现盈亏（分）= 到账金额 − 消耗成本 */
  realizedPnlCents: number;
}

/**
 * 默认赎回费率阶梯（真实公募基金通行档位）。
 * 具体基金可在 fund.redeem_tiers 里覆盖。
 */
export const DEFAULT_REDEEM_TIERS: RedeemTier[] = [
  { minDays: 0, maxDays: 7, rate: 150 }, // < 7 天：1.5%（惩罚性费率）
  { minDays: 7, maxDays: 365, rate: 50 }, // 7 天 ~ 不满 1 年：0.5%
  { minDays: 365, maxDays: 730, rate: 25 }, // 1 ~ 不满 2 年：0.25%
  { minDays: 730, maxDays: null, rate: 0 }, // 满 2 年：免赎回费
];

/**
 * 按持有天数查费率档。区间规则为「左闭右开」：
 * minDays <= holdDays < maxDays。
 */
export function findRedeemRate(tiers: RedeemTier[], holdDays: number): number {
  for (const t of tiers) {
    const hitLower = holdDays >= t.minDays;
    const hitUpper = t.maxDays === null || holdDays < t.maxDays;
    if (hitLower && hitUpper)
      return t.rate;
  }
  // 没命中任何档（阶梯配置有洞），保守按最高档收费
  return Math.max(...tiers.map(t => t.rate));
}

/**
 * FIFO 逐批计算赎回。
 *
 * 真实规则：份额按批次先进先出消耗，每批按自己的持有天数查费率档单独计费。
 * 因此一笔赎回可能同时按多档费率计费——这正是需要 share_lot 表的原因，
 * 只存一个持仓汇总是算不出正确赎回费的。
 *
 * 成本按消耗份额占该批的比例摊销，保证批次耗尽时成本也正好摊完。
 */
export function calcRedeem(input: RedeemInput): RedeemResult {
  const { lots, redeemSharesScaled, navScaled, confirmDate, tiers } = input;

  if (!Number.isFinite(redeemSharesScaled) || redeemSharesScaled <= 0) {
    throw new Error(`赎回份额必须为正数，收到 ${redeemSharesScaled}`);
  }
  if (!Number.isFinite(navScaled) || navScaled <= 0) {
    throw new Error(`确认日净值必须为正数，收到 ${navScaled}`);
  }
  if (lots.length === 0) {
    throw new Error("没有可赎回的份额批次");
  }

  const totalAvailable = lots.reduce((s, l) => s + l.sharesScaled, 0);
  if (redeemSharesScaled > totalAvailable) {
    throw new Error(
      `份额不足：持有 ${totalAvailable}，尝试赎回 ${redeemSharesScaled}`,
    );
  }

  // FIFO：按确认日升序，同日再按 id 升序（保证顺序稳定可复现）
  const sorted = [...lots].sort((a, b) => {
    if (a.confirmDate !== b.confirmDate) {
      return a.confirmDate < b.confirmDate ? -1 : 1;
    }
    return a.id - b.id;
  });

  const nav = navToDecimal(navScaled);
  const lotResults: RedeemLotResult[] = [];
  let remaining = redeemSharesScaled;

  for (const lot of sorted) {
    if (remaining <= 0)
      break;

    // 本批消耗份额：要么把这批吃光，要么只吃剩余需求
    const consumed = Math.min(lot.sharesScaled, remaining);
    remaining -= consumed;

    const holdDays = countDays(lot.confirmDate, confirmDate);
    const rate = findRedeemRate(tiers, holdDays);

    // 赎回金额（分）= 份额 × 净值 × 100
    const grossCents = roundInt(
      sharesToDecimal(consumed).mul(nav).mul(YUAN),
    );
    const feeCents = roundInt(new Decimal(grossCents).mul(rateToRatio(rate)));
    const netCents = grossCents - feeCents;

    // 成本按份额比例摊；整批吃光时直接取剩余全部成本，避免除法误差留碎渣
    const costCents
      = consumed === lot.sharesScaled
        ? lot.costCents
        : roundInt(
            new Decimal(lot.costCents)
              .mul(consumed)
              .div(lot.sharesScaled),
          );

    lotResults.push({
      lotId: lot.id,
      consumedSharesScaled: consumed,
      holdDays,
      rate,
      grossCents,
      feeCents,
      netCents,
      costCents,
    });
  }

  const totalGrossCents = lotResults.reduce((s, l) => s + l.grossCents, 0);
  const totalFeeCents = lotResults.reduce((s, l) => s + l.feeCents, 0);
  const totalNetCents = lotResults.reduce((s, l) => s + l.netCents, 0);
  const totalCostCents = lotResults.reduce((s, l) => s + l.costCents, 0);

  return {
    lotResults,
    totalGrossCents,
    totalFeeCents,
    totalNetCents,
    totalCostCents,
    realizedPnlCents: totalNetCents - totalCostCents,
  };
}
