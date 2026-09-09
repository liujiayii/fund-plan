import { fmtYuan } from "./format";

export interface PnlBadgeProps {
  /** 盈亏金额（分）。传了就显示金额 */
  cents?: number;
  /** 盈亏率（0.0231 = +2.31%）。传了就显示百分比 */
  rate?: number;
}

/**
 * 涨跌浅底胶囊（visual-refresh spec §6.5）：涨 #FEECEB 底柔红字、
 * 跌浅绿底翠绿字、平雾灰底——与收益日历、图表 tooltip 同一「浅底深字」语言。
 *
 * ⚠️ 只用于「强调位」（如日历明细的当日金额）；列表与总览的大数字
 * 仍走 PnlText——徽章管强调、文字管信息，两个层级不混用（计划已裁定偏差 1）。
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
