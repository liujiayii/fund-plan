import Decimal from 'decimal.js';
import { decimalToShares, navToDecimal, rateToRatio, roundInt, YUAN } from './money';

/** 申购入参 */
export interface PurchaseInput {
  /** 申购金额（分） */
  amountCents: number;
  /** 确认日单位净值 ×10000 */
  navScaled: number;
  /** 申购费率（万分之，如 1.5% = 150） */
  purchaseRate: number;
}

/** 申购结果 */
export interface PurchaseResult {
  /** 净申购金额（分），真正用于买份额的钱 */
  netAmountCents: number;
  /** 申购费用（分） */
  feeCents: number;
  /** 确认份额 ×10000 */
  sharesScaled: number;
}

/**
 * 按真实「内扣法」计算申购结果。
 *
 * 内扣法（中国公募基金通行做法）：费用从申购金额里扣出来，而非在金额之外另收。
 *   净申购金额 = 申购金额 ÷ (1 + 申购费率)
 *   申购费用   = 申购金额 − 净申购金额
 *   确认份额   = 净申购金额 ÷ 确认日单位净值
 *
 * 注意这里是「除以 (1+费率)」而不是「乘以 (1−费率)」——
 * 后者是外扣法，会算出更高的费用，与真实对账不上。
 *
 * 费用用减法反推，保证「净申购 + 费用 === 申购金额」一分不差。
 */
export function calcPurchase(input: PurchaseInput): PurchaseResult {
  const { amountCents, navScaled, purchaseRate } = input;

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error(`申购金额必须为正整数（分），收到 ${amountCents}`);
  }
  if (!Number.isFinite(navScaled) || navScaled <= 0) {
    throw new Error(`确认日净值必须为正数，收到 ${navScaled}`);
  }
  if (purchaseRate < 0) {
    throw new Error(`申购费率不能为负，收到 ${purchaseRate}`);
  }

  // 净申购金额 = 金额 ÷ (1 + 费率)
  const ratio = rateToRatio(purchaseRate);
  const netAmountCents = roundInt(
    new Decimal(amountCents).div(new Decimal(1).plus(ratio)),
  );

  // 费用用减法反推，确保总额守恒（不会因两次独立取整而差一分）
  const feeCents = amountCents - netAmountCents;

  // 确认份额 = 净申购金额（元）÷ 净值
  const netYuan = new Decimal(netAmountCents).div(YUAN);
  const sharesScaled = decimalToShares(netYuan.div(navToDecimal(navScaled)));

  return { netAmountCents, feeCents, sharesScaled };
}
