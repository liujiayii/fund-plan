import { Line } from "@ant-design/charts";
import { Empty, Radio } from "antd";
import { useMemo, useState } from "react";
import { NAV_SCALE } from "~/domain/money";

export interface NavPoint {
  navDate: string;
  unitNav: number;
  growthRate: number;
}

/** 时间范围选项 */
const RANGES = [
  { key: "1m", label: "近 1 月", days: 30 },
  { key: "3m", label: "近 3 月", days: 90 },
  { key: "1y", label: "近 1 年", days: 365 },
  { key: "all", label: "全部", days: Number.MAX_SAFE_INTEGER },
] as const;

/**
 * 净值曲线图。数据传入时是 ×10000 的整数，这里转成真实净值再画。
 * 图表只在客户端渲染（antd charts 依赖 canvas），SSR 时先占位。
 */
export function NavChart({ data }: { data: NavPoint[] }) {
  const [range, setRange] = useState<string>("3m");

  const chartData = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range) ?? RANGES[1];
    // data 是正序（旧→新），取最后 N 条即为最近 N 天
    const sliced
      = cfg.days === Number.MAX_SAFE_INTEGER ? data : data.slice(-cfg.days);
    return sliced.map(d => ({
      date: d.navDate,
      nav: Number((d.unitNav / NAV_SCALE).toFixed(4)),
    }));
  }, [data, range]);

  if (data.length === 0) {
    return <Empty description="暂无净值数据" />;
  }

  return (
    <div>
      <Radio.Group
        value={range}
        onChange={e => setRange(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        size="small"
        style={{ marginBottom: 16 }}
        options={RANGES.map(r => ({ label: r.label, value: r.key }))}
      />
      <Line
        data={chartData}
        xField="date"
        yField="nav"
        height={320}
        smooth
        autoFit
        // 净值波动幅度小，Y 轴不从 0 起，否则曲线压成一条直线
        scale={{ y: { nice: true, zero: false } }}
        axis={{
          x: { labelAutoHide: true, labelAutoRotate: false },
          y: { labelFormatter: (v: number) => v.toFixed(4) },
        }}
        tooltip={{
          items: [{ channel: "y", name: "单位净值", valueFormatter: (v: number) => v.toFixed(4) }],
        }}
        style={{ lineWidth: 2 }}
      />
    </div>
  );
}
