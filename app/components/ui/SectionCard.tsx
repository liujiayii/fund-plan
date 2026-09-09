import type { ReactNode } from "react";
import { Card } from "antd";
import { CARD_SHADOW } from "~/theme";

export interface SectionCardProps {
  title?: ReactNode;
  /** 右上角操作或「查看全部 →」链接 */
  extra?: ReactNode;
  children: ReactNode;
  /**
   * 透传给内层 Card 的类（进场动画等）。visual-refresh 后全站卡片需要
   * 挂动画类，只开这一档定制；style 仍刻意不透传，保持组件克制。
   */
  className?: string;
}

/**
 * Renders a borderless card with a consistent shadow and optional header content.
 *
 * @param className - Optional utility classes applied to the card.
 * @returns The rendered section card.
 */
export function SectionCard({ title, extra, children, className }: SectionCardProps) {
  return (
    <Card
      title={title}
      extra={extra}
      variant="borderless"
      className={className}
      style={{ boxShadow: CARD_SHADOW }}
    >
      {children}
    </Card>
  );
}
