import type { ReactNode } from "react";
import { Card } from "antd";

export interface SectionCardProps {
  title?: ReactNode;
  /** 右上角操作或「查看全部 →」链接 */
  extra?: ReactNode;
  children: ReactNode;
  /**
   * 透传给内层 Card 的类（进场动画、门面高光 fp-glass-specular 等）。
   * style 仍刻意不透传，保持组件克制。
   */
  className?: string;
}

/**
 * 统一卡片外壳：液态玻璃（`.fp-glass`，材料见 app/styles/liquid-glass.css）、
 * 22 圆角（ANTD_TOKEN 的 Card.borderRadiusLG）、透明底（Card.colorBgContainer）。
 *
 * 阴影不再内联：内联 box-shadow 的优先级压过任何类，hover 抬升永远不生效
 * （visual-refresh 的老坑）。现在阴影是 .fp-glass 的一部分，hover 只做 2px
 * 位移（仅 md: 以上，触屏不加位移；reduced-motion 下由 responsive.css 关掉）。
 *
 * 用 variant="borderless" 而非已废弃的 bordered={false}（antd 6 已移除后者）。
 *
 * className 只开了「挂工具类」这一档；需要内联样式的地方继续用裸 Card 并自己
 * 挂 fp-glass——避免这个组件长成什么都能干的万能壳。
 */
export function SectionCard({ title, extra, children, className }: SectionCardProps) {
  return (
    <Card
      title={title}
      extra={extra}
      variant="borderless"
      className={`fp-glass transition-transform duration-[240ms] md:hover:-translate-y-[2px] ${className ?? ""}`}
    >
      {children}
    </Card>
  );
}
