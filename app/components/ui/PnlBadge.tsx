import { fmtYuan } from "./format";

export interface PnlBadgeProps {
  /** 盈亏金额（分）。传了就显示金额 */
  cents?: number;
  /** 盈亏率（0.0231 = +2.31%）。传了就显示百分比 */
  rate?: number;
}

/**
 * Displays a pill-shaped badge for a profit or loss amount, rate, or both.
 *
 * @param cents - Optional profit or loss amount in cents, formatted as yuan.
 * @param rate - Optional profit or loss rate represented as a decimal.
 * @returns A styled badge displaying the provided amount and rate.
 */
export function PnlBadge({ cents, rate }: PnlBadgeProps) {
  // 判色依据与 PnlText 同款：有金额看金额，只有率看率
  const basis = cents ?? rate ?? 0;
  // 条件类刻意互斥（每个分支带全自己的 bg-*/text-*），避免同类属性两分支同挂
  const tone = basis > 0
    ? "bg-rise-soft text-rise"
    : basis < 0
      ? "bg-fall-soft text-fall"
      : "bg-page text-tertiary";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-num ${tone}`}>
      {cents !== undefined && (
        <span>{`${cents > 0 ? "+" : ""}${fmtYuan(cents)} 元`}</span>
      )}
      {rate !== undefined && (
        <span>{`${rate > 0 ? "+" : ""}${(rate * 100).toFixed(2)}%`}</span>
      )}
    </span>
  );
}
