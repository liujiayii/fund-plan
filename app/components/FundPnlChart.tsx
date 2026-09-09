import type { LineConfig } from "@ant-design/charts";
import type { FundCumPnlPoint } from "~/domain/fund-pnl";
import { lazy, Suspense, useMemo, useState } from "react";
import { ChartSkeleton, useIsClient } from "~/components/ui/chart";
import { FP_CHART_THEME } from "~/components/ui/chart-theme";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { centsToYuan } from "~/domain/money";

/**
 * @ant-design/charts 是纯客户端库（底层 G2 依赖 canvas / DOM）。
 * ⚠️ 必须懒加载 + 挂载后再渲染，否则 SSR hydration 报
 * `Cannot read properties of null (reading 'useContext')`
 * （完整论证见 NavChart 顶注——这是全站图表的铁律）。
 */
const Line = lazy(async () => {
  const mod = await import("@ant-design/charts");
  return { default: mod.Line };
});

/** 时间范围：近 1 月（默认）/ 持有以来 */
const RANGES = [
  { key: "1m", label: "近 1 月", days: 30 },
  { key: "all", label: "持有以来", days: Number.MAX_SAFE_INTEGER },
] as const;

/**
 * 单基金累计盈亏曲线。cumulative 是「自首笔确认日」的前缀和——
 * 窗口只裁剪显示范围，不重置基准：曲线末点恒等于全期累计盈亏，
 * 与卡头的「累计盈亏」数字同口径（AssetTrendChart 累计收益同款手法）。
 */
export function FundPnlChart({ cumulative }: { cumulative: FundCumPnlPoint[] }) {
  const [range, setRange] = useState<string>("1m");
  const mounted = useIsClient();

  const chartData = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range) ?? RANGES[0];
    const sliced
      = cfg.days === Number.MAX_SAFE_INTEGER
        ? cumulative
        : cumulative.slice(-cfg.days);
    // 「分」→ 元走 centsToYuan（Decimal）；前缀和在整数域已完成，这里只换算
    return sliced.map(p => ({
      date: p.date,
      pnl: Number(centsToYuan(p.cumPnlCents)),
    }));
  }, [cumulative, range]);

  if (cumulative.length === 0) {
    // 走 EmptyState 而不是裸 Empty：全站空态的留白由它统一
    return <EmptyState description="暂无收益数据" hint="份额确认后的第一个交易日开始记账" />;
  }

  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "pnl",
    // 全站图表统一主题（chart-theme.ts 单一出处）
    theme: FP_CHART_THEME,
    // ⚠️ 刻意不传 height：G2 的 sizeOf 让显式 height 压过容器尺寸——
    // 高度由 responsive.css §6 的 .fp-chart-box 全权管理（与 NavChart 同款）
    autoFit: true,
    // 累计盈亏要看正负分界，Y 轴必须含 0 基准线（AssetTrendChart 累计口径同款）
    scale: { y: { nice: true, zero: true } },
    axis: {
      x: { labelAutoHide: true, labelAutoRotate: false },
      y: { labelFormatter: (v: number) => v.toFixed(2) },
    },
    tooltip: {
      items: [
        {
          channel: "y",
          name: "累计盈亏（元）",
          valueFormatter: (v: number) => v.toFixed(2),
        },
      ],
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
