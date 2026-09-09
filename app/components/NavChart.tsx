import type { LineConfig } from "@ant-design/charts";
import { lazy, Suspense, useMemo, useState } from "react";
import { ChartSkeleton, useIsClient } from "~/components/ui/chart";
import { FP_CHART_THEME } from "~/components/ui/chart-theme";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { NAV_SCALE } from "~/domain/money";
import { COLOR } from "~/theme";

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
 * Renders a fund NAV line chart with optional normalized benchmark data and selectable time ranges.
 *
 * @param data - Fund NAV points, with unit NAV values scaled by `NAV_SCALE`.
 * @param benchmark - Optional benchmark closing values aligned to the selected period and normalized to the fund's starting NAV.
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
    return <EmptyState description="暂无净值数据" hint="基金净值通常在交易日 20:30 后同步" />;
  }

  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "value",
    // colorField 按 type 分组画多条线；单线时只有一类「本基金」也正常
    colorField: "type",
    // 全站图表统一主题（chart-theme.ts 单一出处）
    theme: FP_CHART_THEME,
    // 基准线（沪深300）退到雾灰辅助位（2026-09-09 用户走查裁定）：此前吃
    // category10 第二位的紫罗兰，与本基金主线同属蓝紫区，两条线缠在一起
    // 分不清主次。显式 color 数组覆盖主题色环：主序列品牌靛蓝、基准雾灰。
    // 消费方仅此一处双序列折线，不动 chart-theme 的 category10（饼图在用）
    color: [COLOR.primary, COLOR.neutral],
    // ⚠️ 刻意不传 height：G2 的 sizeOf 让显式 height 压过容器尺寸——
    // 传了它，CSS 压容器（窄屏 220）canvas 也不跟随，会竖向溢出容器。
    // 不传时 autoFit 读容器 clientHeight，高度由 responsive.css §6 全权管理
    autoFit: true,
    // 净值波动幅度小，Y 轴不从 0 起，否则曲线压成一条直线
    scale: { y: { nice: true, zero: false } },
    axis: {
      // labelAutoRotate 放开旋转：窄屏 X 轴标签斜排可读，桌面宽度足够时 G2 自行不转
      x: { labelAutoHide: true, labelAutoRotate: true },
      y: { labelFormatter: (v: number) => v.toFixed(4) },
    },
    // 平滑走 G2v5 形状通道 style.shape（smooth: true 是 plots v1 死配置，
    // G2v5 无读取方——2026-09-09 走查修复时顺手转正，恢复曲线平滑意图）
    style: { shape: "smooth", lineWidth: 2 },
  };

  return (
    // fp-chart-box：图表窄屏高度降档的挂载点（responsive.css §6），包住 PeriodTabs + 图区
    <div className="fp-chart-box">
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
