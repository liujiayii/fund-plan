import type { ReactNode } from "react";
import { COLOR, NUM_FONT } from "~/theme";

export interface StatBigProps {
  /** 标签，如「总资产」 */
  label: ReactNode;
  /** 主数值，传已格式化好的字符串（如 centsToYuan 的产物） */
  value: ReactNode;
  /** 数值颜色，默认正文色；盈亏类传 pnlColor(v) */
  color?: string;
  /** 数值字号。主位 32、次位 24、三级 20 */
  size?: number;
  /** 单位后缀，如「元」，渲染成小一号灰字 */
  suffix?: ReactNode;
  /** 副行说明，如「收益率 +2.31%」 */
  extra?: ReactNode;
}

/**
 * 大数字展示。取代 antd 的 Statistic —— Statistic 的字号与字体栈不可控，
 * 且用比例字体导致一列金额纵向对不齐（"1" 比 "8" 窄）。
 * 这里强制用 NUM_FONT 等宽栈。
 */
export function StatBig({
  label,
  value,
  color,
  size = 32,
  suffix,
  extra,
}: StatBigProps) {
  return (
    <div>
      <div style={{ fontSize: 13, color: COLOR.textSecondary, lineHeight: 1.6 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 2,
        }}
      >
        <span
          style={{
            fontSize: size,
            fontFamily: NUM_FONT,
            fontWeight: 500,
            lineHeight: 1.2,
            color: color ?? COLOR.textPrimary,
          }}
        >
          {value}
        </span>
        {suffix !== undefined && (
          <span style={{ fontSize: 13, color: COLOR.textSecondary }}>{suffix}</span>
        )}
      </div>
      {extra !== undefined && (
        <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
          {extra}
        </div>
      )}
    </div>
  );
}
