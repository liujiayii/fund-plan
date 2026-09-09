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
 * 统一卡片外壳：白底、12 圆角（由 ANTD_TOKEN 的 Card.borderRadiusLG 给）、
 * 无边框、极浅阴影（阴影值来自 ~/theme 的 CARD_SHADOW，不在这里写字面量）。
 *
 * 用 variant="borderless" 而非已废弃的 bordered={false}（antd 6 已移除后者）。
 *
 * className 只开了「挂工具类」这一档（animate-fade-up 进场动画等）；
 * style 仍刻意不透传：需要内联样式的地方（首页的等高栅格、居中 CTA）
 * 继续用裸 Card 并自己带上 variant="borderless" + CARD_SHADOW，
 * 只需要定位的地方（登录/注册的窄卡）在外面套一层 div ——
 * 避免这个组件长成什么都能干的万能壳。
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
