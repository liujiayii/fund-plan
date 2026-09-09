import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** 主文案，如「暂无净值数据」 */
  description: ReactNode;
  /** 次级说明（visual-refresh spec §6.4：带情绪的引导语），可选 */
  hint?: ReactNode;
  /** 引导用的按钮等 */
  children?: ReactNode;
}

/**
 * 统一空态（visual-refresh spec §6.4）：品牌浅底圆 + 净值曲线简笔插画
 * + 呼吸浮动 + 主/次两级文案。取代 antd Empty 的默认灰插图。
 * 插画刻意与 Logo 同语言（曲线 + 圆点），视觉锤处处重复（spec §6.1）。
 */
export function EmptyState({ description, hint, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-10">
      {/* 呼吸浮动：animate-float（Task 5 定义），reduced-motion 自动关 */}
      <div className="animate-float py-2">
        <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
          <circle cx="36" cy="36" r="36" fill="var(--fp-primary-bg)" />
          <path
            d="M22 42 L32 32 L38 38 L50 24"
            stroke="var(--fp-primary)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="50" cy="24" r="3" fill="var(--fp-primary)" />
        </svg>
      </div>
      <div className="mt-3 text-sm text-ink">{description}</div>
      {hint !== undefined && <div className="mt-1 text-xs text-tertiary">{hint}</div>}
      {children !== undefined && <div className="mt-4">{children}</div>}
    </div>
  );
}
