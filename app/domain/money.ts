import Decimal from 'decimal.js';

/**
 * 精度换算工具。设计文档「精度铁律」的落地实现。
 *
 * 核心原则：所有金额/份额/净值/费率在数据库里都是整数，
 * 中间运算一律走 decimal.js，最后四舍五入回整数。
 * 绝不让 JS 浮点数碰钱。
 */

/** 元 → 分的缩放倍数 */
export const YUAN = 100;
/** 份额缩放倍数（保留 4 位小数余量） */
export const SHARE_SCALE = 10000;
/** 净值缩放倍数（真实净值即 4 位小数） */
export const NAV_SCALE = 10000;
/** 费率缩放倍数（万分之，如 1.5% 存 150） */
export const RATE_SCALE = 10000;

// 全局配置：四舍五入用 HALF_UP（而非 JS Math.round 对负数的偏向、也非银行家舍入），
// 精度给足，避免中间运算被截断。
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * 统一取整：四舍五入到整数。
 * 用 HALF_UP 保证 2.5 → 3、-1.5 → -2，符合财务直觉。
 */
export function roundInt(v: Decimal.Value): number {
  return new Decimal(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * 元 → 分。入参可以是字符串（推荐，无精度损失）或数字。
 * 传数字时即使已有浮点误差（如 0.1+0.2），也会在这里被四舍五入吃掉。
 */
export function yuanToCents(yuan: number | string): number {
  return roundInt(new Decimal(yuan).mul(YUAN));
}

/** 分 → 元，展示用，固定两位小数 */
export function centsToYuan(cents: number): string {
  return new Decimal(cents).div(YUAN).toFixed(2);
}

/** 份额 → 展示字符串，默认两位小数（存储是 4 位精度） */
export function sharesToDisplay(shares: number, fractionDigits = 2): string {
  return new Decimal(shares).div(SHARE_SCALE).toFixed(fractionDigits);
}

/** 净值 → 展示字符串，固定四位小数 */
export function navToDisplay(nav: number): string {
  return new Decimal(nav).div(NAV_SCALE).toFixed(4);
}

/** 费率（万分之整数）→ 百分比展示字符串，如 150 → "1.50%" */
export function rateToPercent(rate: number): string {
  return `${new Decimal(rate).div(RATE_SCALE).mul(100).toFixed(2)}%`;
}

/**
 * 金额（分）× 比例 → 金额（分）。
 * 比例是普通小数（如 0.015 表示 1.5%），不是万分之整数。
 * 若手上是万分之整数，先用 rateToRatio 转一下。
 */
export function multiplyCents(cents: number, ratio: Decimal.Value): number {
  return roundInt(new Decimal(cents).mul(ratio));
}

/** 费率（万分之整数）→ 普通小数比例，如 150 → 0.015 */
export function rateToRatio(rate: number): Decimal {
  return new Decimal(rate).div(RATE_SCALE);
}

/** 净值（×10000 整数）→ Decimal 实际值，如 12345 → 1.2345 */
export function navToDecimal(nav: number): Decimal {
  return new Decimal(nav).div(NAV_SCALE);
}

/** 份额（×10000 整数）→ Decimal 实际值 */
export function sharesToDecimal(shares: number): Decimal {
  return new Decimal(shares).div(SHARE_SCALE);
}

/** Decimal 份额 → 存储用整数（×10000 四舍五入） */
export function decimalToShares(shares: Decimal.Value): number {
  return roundInt(new Decimal(shares).mul(SHARE_SCALE));
}
