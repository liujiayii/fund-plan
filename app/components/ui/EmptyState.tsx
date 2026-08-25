import type { ReactNode } from "react";
import { Empty } from "antd";

export interface EmptyStateProps {
  description: ReactNode;
  /** 引导用的按钮等 */
  children?: ReactNode;
}

/**
 * 统一空态。包一层只为统一上下留白 ——
 * 裸 Empty 在不同卡片里高度参差，页面看起来不整齐。
 */
export function EmptyState({ description, children }: EmptyStateProps) {
  return (
    <div style={{ padding: "32px 0" }}>
      <Empty description={description}>{children}</Empty>
    </div>
  );
}
