import type { LineConfig } from "@ant-design/charts";
import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
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

/** 基准（沪深300 等）净值点：close 为真实收盘点数（非缩放整数） */
export interface BenchmarkPoint {
  date: string;
  close: number;
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

/**
 * 净值曲线图。数据传入时净值是 ×10000 的整数，这里转成真实净值再画。
 *
 * 可选叠加一条基准线（沪深300）：基准与基金窗口对齐后，按基金窗口首日净值
 * 归一化——两条线从同一个 Y 点出发，直观对比相对涨跌而非绝对值。
 * 拉不到基准（空数组）则不画，自动降级为单线图。
 */
export function NavChart({
  data,
  benchmark,
}: {
  data: NavPoint[];
  benchmark?: BenchmarkPoint[];
}) {
  const [range, setRange] = useState<string>("3m");
  const mounted = useIsClient();

  const chartData = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range) ?? RANGES[1];
    // data 是正序（旧→新），取最后 N 条即为最近 N 天
    const sliced
      = cfg.days === Number.MAX_SAFE_INTEGER ? data : data.slice(-cfg.days);
    // 基金净值：×10000 整数转回真实值
    const navRows = sliced.map(d => ({
      date: d.navDate,
      type: "本基金",
      value: Number((d.unitNav / NAV_SCALE).toFixed(4)),
    }));
    if (benchmark && benchmark.length > 0) {
      // 基准与基金同窗口切片
      const benchSliced
        = cfg.days === Number.MAX_SAFE_INTEGER
          ? benchmark
          : benchmark.slice(-cfg.days);
      // 归一化基准到基金窗口首日净值：两者首日对齐到同一 Y 点
      const fundFirst = sliced[0]?.unitNav ?? NAV_SCALE;
      const benchFirst = benchSliced[0]?.close ?? 1;
      const benchRows = benchSliced.map(b => ({
        date: b.date,
        type: "沪深300",
        value: Number(
          ((b.close / benchFirst) * (fundFirst / NAV_SCALE)).toFixed(4),
        ),
      }));
      return [...navRows, ...benchRows];
    }
    return navRows;
  }, [data, range, benchmark]);

  if (data.length === 0) {
    // 走 EmptyState 而不是裸 Empty：全站空态的留白由它统一
    return <EmptyState description="暂无净值数据" />;
  }

  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "value",
    // colorField 按 type 分组画多条线；单线时只有一类「本基金」也正常
    colorField: "type",
    height: 320,
    smooth: true,
    autoFit: true,
    // 净值波动幅度小，Y 轴不从 0 起，否则曲线压成一条直线
    scale: { y: { nice: true, zero: false } },
    axis: {
      x: { labelAutoHide: true, labelAutoRotate: false },
      y: { labelFormatter: (v: number) => v.toFixed(4) },
    },
    style: { lineWidth: 2 },
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <PeriodTabs
          options={RANGES.map(r => ({ key: r.key, label: r.label }))}
          value={range}
          onChange={setRange}
        />
      </div>
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
