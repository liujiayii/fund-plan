import type { LineConfig } from "@ant-design/charts";
import { Empty, Radio } from "antd";
import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { NAV_SCALE } from "~/domain/money";

/**
 * @ant-design/charts 是纯客户端库（底层 G2 依赖 canvas / DOM）。
 *
 * ⚠️ 必须懒加载 + 挂载后再渲染，否则会踩两个坑：
 *  1. 服务端 import 它会把整个 G2 拉进 SSR bundle，而 Workers 里没有 canvas；
 *  2. SSR 渲染出空内容、客户端 hydration 时结构对不上，
 *     报 `Cannot read properties of null (reading 'useContext')`。
 *
 * 所以这里用 lazy() 把它切成独立 chunk，再靠 mounted 标志确保
 * 只有在浏览器里（首次 effect 之后）才真正渲染图表。
 */
const Line = lazy(async () => {
  const mod = await import("@ant-design/charts");
  return { default: mod.Line };
});

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
 * 图表占位骨架：SSR 与懒加载期间都用它，保证前后结构一致不闪。
 * 用 div + antd 的骨架动画色，而不是 Skeleton.Node ——
 * 后者默认渲染成圆形 avatar，跟横向的曲线图对不上。
 */
function ChartSkeleton() {
  return (
    <div
      style={{
        width: "100%",
        height: 320,
        borderRadius: 8,
        background:
          "linear-gradient(90deg, rgba(0,0,0,.06) 25%, rgba(0,0,0,.15) 37%, rgba(0,0,0,.06) 63%)",
        backgroundSize: "400% 100%",
        animation: "ant-skeleton-loading 1.4s ease infinite",
      }}
    />
  );
}

/**
 * 净值曲线图。数据传入时净值是 ×10000 的整数，这里转成真实净值再画。
 */
/**
 * 判断当前是否已在浏览器端 hydrate 完成。
 * 用 useSyncExternalStore 而非「useEffect 里 setState」——
 * 后者会多一次渲染，也会触发 react/set-state-in-effect 告警。
 * getSnapshot 返回 true（客户端），getServerSnapshot 返回 false（SSR）。
 */
const emptySubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function NavChart({ data }: { data: NavPoint[] }) {
  const [range, setRange] = useState<string>("3m");
  const mounted = useIsClient();

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

  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "nav",
    height: 320,
    smooth: true,
    autoFit: true,
    // 净值波动幅度小，Y 轴不从 0 起，否则曲线压成一条直线
    scale: { y: { nice: true, zero: false } },
    axis: {
      x: { labelAutoHide: true, labelAutoRotate: false },
      y: { labelFormatter: (v: number) => v.toFixed(4) },
    },
    tooltip: {
      items: [
        { channel: "y", name: "单位净值", valueFormatter: (v: number) => v.toFixed(4) },
      ],
    },
    style: { lineWidth: 2 },
  };

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
      {mounted
        ? (
            <Suspense fallback={<ChartSkeleton />}>
              <Line {...config} />
            </Suspense>
          )
        : (
            <ChartSkeleton />
          )}
    </div>
  );
}
