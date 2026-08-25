import { centsToYuan } from "~/domain/money";
import { NUM_FONT, pnlColor } from "~/theme";

export interface PnlTextProps {
  /** 盈亏金额（分）。传了就显示金额 */
  cents?: number;
  /** 盈亏率（普通小数，0.0231 表示 +2.31%）。传了就显示百分比 */
  rate?: number;
  /** 字号，默认 14 */
  size?: number;
  /** 加粗，用于主位盈亏（如总览的大数字） */
  strong?: boolean;
  /** 显式指定判色依据；不传则用 cents，没有 cents 再用 rate */
  colorBy?: number;
}

/**
 * 涨跌数字。自动带 +/− 号与红绿配色 ——
 * 收敛此前散落在 6 个文件里、每次都手写一遍的
 * `{v > 0 ? "+" : ""}{centsToYuan(v)}` + `style={{ color: pnlColor(v) }}`。
 *
 * cents 与 rate 都传时渲染成「+1,203.55  +2.31%」两段。
 * 负数由 centsToYuan 自带 "-" 号，所以只在正数时补 "+"。
 */
export function PnlText({ cents, rate, size = 14, strong, colorBy }: PnlTextProps) {
  const basis = colorBy ?? cents ?? rate ?? 0;

  const amountText
    = cents === undefined ? null : `${cents > 0 ? "+" : ""}${centsToYuan(cents)}`;
  const rateText
    = rate === undefined ? null : `${rate > 0 ? "+" : ""}${(rate * 100).toFixed(2)}%`;

  return (
    <span
      style={{
        // 用 inline-flex + gap 分隔两段，而不是往文本里塞空格——
        // HTML 会把连续空白折叠成一个，塞空格达不到分隔效果
        display: "inline-flex",
        alignItems: "baseline",
        gap: 8,
        color: pnlColor(basis),
        fontFamily: NUM_FONT,
        fontSize: size,
        fontWeight: strong ? 600 : 400,
      }}
    >
      {amountText !== null && <span>{amountText}</span>}
      {rateText !== null && <span>{rateText}</span>}
    </span>
  );
}
