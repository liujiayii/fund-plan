import type { ReactNode } from "react";

export interface StatusBadgeProps {
  /**
   * pending：待确认 / 在途（第三语义，宪法 §2.4 的 pending 色）
   * danger：失败（antd 语义红，不是涨色——这里刻意不用 text-rise）
   * default：已撤单等中性状态
   */
  tone: "pending" | "danger" | "default";
  children: ReactNode;
}

/**
 * 订单状态胶囊。取代 `<Tag color="orange">待确认</Tag>`：
 * antd 预设橙在暗底派生后接近涨色粉红，会把「等着确认」读成「赚了」。
 * 三档条件类互斥（每档带全自己的 bg/text），与 PnlBadge 同手法。
 */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  const cls = tone === "pending"
    ? "bg-pending-soft text-pending"
    : tone === "danger"
      ? "bg-well text-red-400"
      : "bg-well text-tertiary";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${cls}`}>
      {children}
    </span>
  );
}
