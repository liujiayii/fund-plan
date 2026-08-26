import { NUM_FONT, pnlColor } from "~/theme";
import { fmtYuan } from "./format";

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
 * 收敛列表与总览里反复手写的
 * `{v > 0 ? "+" : ""}{centsToYuan(v)}` + `style={{ color: pnlColor(v) }}`。
 *
 * ⚠️ 尚未收敛干净，别把本组件当成唯一出处：
 *  - `SellDrawer` 的「已实现盈亏」**刻意**仍手写这个模式 —— 只换它一处会让它拿到
 *    NUM_FONT，而同一块里的赎回总额/赎回费合计/预计到账仍是比例字体，块内反而更不一致。
 *  - `TxList` 的流水金额也手写着同一个形状（它的判色基准是资金进出，语义与盈亏不同）。
 *  - `PortfolioView` / `me._index` / `me.holdings` 的「浮动盈亏」手写 +/− 号后把
 *    `pnlColor(v)` 传给 `StatBig` —— 那里要的是大字号主位数字，本组件给不了。
 * 也就是说本组件收敛的是**列表行与总览副值**这一类，不是全部。
 *
 * cents 与 rate 都传时渲染成「+1,203.55 元  +2.31%」两段。
 * 金额必须带「元」：本组件用在卡片里，周围没有列头把数字归成金额，
 * 光秃秃的 "+1,203.55" 紧挨着 "+2.31%"，读不出哪个是钱哪个是率。
 * 负数的 "-" 号由 fmtYuan 自带，所以只在正数时补 "+"。
 */
export function PnlText({ cents, rate, size = 14, strong, colorBy }: PnlTextProps) {
  const basis = colorBy ?? cents ?? rate ?? 0;

  const amountText
    = cents === undefined ? null : `${cents > 0 ? "+" : ""}${fmtYuan(cents)} 元`;
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
