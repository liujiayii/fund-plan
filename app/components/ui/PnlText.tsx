import { pnlColor } from "~/theme";
import { fmtYuan } from "./format";

export interface PnlTextProps {
  /** 盈亏金额（分）。传了就显示金额 */
  cents?: number;
  /** 盈亏率（普通小数，0.0231 表示 +2.31%）。传了就显示百分比 */
  rate?: number;
  /** 字号，默认 14 */
  size?: number;
}

/**
 * Displays profit or loss amounts and rates with signed formatting and color coding.
 *
 * @param cents - Monetary value in cents.
 * @param rate - Profit or loss rate as a decimal fraction.
 * @param size - Font size in pixels.
 * @returns The formatted profit or loss text.
 */
export function PnlText({ cents, rate, size = 14 }: PnlTextProps) {
  // 判色依据：有金额看金额，只有率就看率。两者都没传当 0（中性灰）
  const basis = cents ?? rate ?? 0;

  const amountText
    = cents === undefined ? null : `${cents > 0 ? "+" : ""}${fmtYuan(cents)} 元`;
  const rateText
    = rate === undefined ? null : `${rate > 0 ? "+" : ""}${(rate * 100).toFixed(2)}%`;

  return (
    <span
      className="font-num"
      style={{
        // 用 inline-flex + gap 分隔两段，而不是往文本里塞空格——
        // HTML 会把连续空白折叠成一个，塞空格达不到分隔效果
        display: "inline-flex",
        alignItems: "baseline",
        gap: 8,
        color: pnlColor(basis),
        fontSize: size,
        // 固定 400（不做成 prop）：涨跌靠红绿表达，再加粗就是把同一件事说两遍；
        // 写死也顺手挡住从父级继承来的粗体
        fontWeight: 400,
      }}
    >
      {amountText !== null && <span>{amountText}</span>}
      {rateText !== null && <span>{rateText}</span>}
    </span>
  );
}
