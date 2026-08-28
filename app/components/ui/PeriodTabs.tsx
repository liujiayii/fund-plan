import { Segmented } from "antd";

export interface PeriodOption {
  key: string;
  label: string;
}

export interface PeriodTabsProps {
  options: readonly PeriodOption[];
  value: string;
  onChange: (key: string) => void;
  size?: "small" | "middle" | "large";
}

/**
 * 时间范围切换。用 Segmented 而非 Radio.Group ——
 * Segmented 带滑块背景，是 antd 里视觉最接近支付宝那排周期切换的组件。
 *
 * 期四的阶段涨幅表会复用它，所以做成通用组件而非写死在 NavChart 里。
 */
export function PeriodTabs({ options, value, onChange, size = "small" }: PeriodTabsProps) {
  return (
    // 外层滚动容器只在 767px 以下生效（overflow-x: auto），桌面无副作用
    <div className="fp-h-scroll">
      <Segmented
        size={size}
        value={value}
        onChange={v => onChange(String(v))}
        options={options.map(o => ({ label: o.label, value: o.key }))}
      />
    </div>
  );
}
