import { centsToYuan } from "~/domain/money";

/**
 * 金额（分）→ 带千分位的展示字符串，如 12845066 → "128,450.66"。
 *
 * ⚠️ 为什么不直接改 `centsToYuan`：它的返回值会被塞进输入框
 * （`BuyDrawer` 的「全部」快捷按钮 → `Input` 的 value → `Number()` / `yuanToCents()`），
 * 带逗号会让 `Number()` 得到 NaN，下单直接失败。
 * 所以 `centsToYuan` 保持机器可读，千分位只在展示层加。
 *
 * 这个函数纯字符串处理，不参与任何金额运算 ——
 * 精度铁律不受影响（运算仍在 domain 层用 decimal.js 完成）。
 */
export function fmtYuan(cents: number): string {
  const plain = centsToYuan(cents);
  // 负号先摘出来再分组，否则 "-1234.00" 会被当成整数部分 "-1234" 处理
  const negative = plain.startsWith("-");
  const body = negative ? plain.slice(1) : plain;
  const [intPart, decPart] = body.split(".");
  // 从右往左每 3 位插一个逗号：只在「后面剩余位数是 3 的整数倍」的非边界位置插
  const grouped = intPart.replace(/\B(?=(\d{3})+$)/g, ",");
  return `${negative ? "-" : ""}${grouped}.${decPart}`;
}
