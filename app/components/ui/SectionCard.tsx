import type { ReactNode } from "react";
import { Card } from "antd";
import { CARD_SHADOW } from "~/theme";

export interface SectionCardProps {
  title?: ReactNode;
  /** 右上角操作或「查看全部 →」链接 */
  extra?: ReactNode;
  children: ReactNode;
}

/**
 * 统一卡片外壳：白底、12 圆角（由 ANTD_TOKEN 的 Card.borderRadiusLG 给）、
 * 无边框、极浅阴影（阴影值来自 ~/theme 的 CARD_SHADOW，不在这里写字面量）。
 *
 * 用 variant="borderless" 而非已废弃的 bordered={false}（antd 6 已移除后者）。
 *
 * 刻意不透传 className / style：需要自定义样式的地方（首页的等高栅格、居中 CTA）
 * 继续用裸 Card 并自己带上 variant="borderless" + CARD_SHADOW，
 * 只需要定位的地方（登录/注册的窄卡）在外面套一层 div ——
 * 避免这个组件长成什么都能干的万能壳。
 */
export function SectionCard({ title, extra, children }: SectionCardProps) {
  return (
    <Card
      title={title}
      extra={extra}
      variant="borderless"
      style={{ boxShadow: CARD_SHADOW }}
    >
      {children}
    </Card>
  );
}
