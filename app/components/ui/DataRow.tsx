import type { ReactNode } from "react";
import { COLOR } from "~/theme";

export interface DataRowProps {
  label: ReactNode;
  value: ReactNode;
  /** 列表最后一行传 true，不画分割线 */
  last?: boolean;
}

/**
 * 左标签右值的一行。取代 antd 的 Descriptions ——
 * Descriptions 的 bordered 模式在窄屏会把 label 与 value 挤成两行、
 * 且列宽不可控，信息密度反而更低。
 */
export function DataRow({ label, value, last }: DataRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderBottom: last ? undefined : `1px solid ${COLOR.border}`,
      }}
    >
      <span style={{ fontSize: 13, color: COLOR.textSecondary, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: COLOR.textPrimary, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
