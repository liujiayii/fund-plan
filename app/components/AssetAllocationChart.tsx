import type { PieConfig } from "@ant-design/charts";
import { lazy, Suspense } from "react";
import { ChartSkeleton, useIsClient } from "~/components/ui/chart";
import { FP_CHART_THEME } from "~/components/ui/chart-theme";
import { EmptyState } from "~/components/ui/EmptyState";

/**
 * @ant-design/charts 是纯客户端库（底层 G2 依赖 canvas / DOM），必须懒加载 +
 * 挂载后再渲染（同 NavChart 顶注的完整论证），否则 SSR hydration 直接炸。
 */
const Pie = lazy(async () => {
  const mod = await import("@ant-design/charts");
  return { default: mod.Pie };
});

/**
 * Renders a donut chart showing the proportions of stocks, bonds, and cash in net assets.
 *
 * @param stocks - Stock allocation percentage, such as `85.2` for 85.2%.
 * @param bonds - Bond allocation percentage, such as `10` for 10%.
 * @param cash - Cash allocation percentage, such as `4.8` for 4.8%.
 */
export function AssetAllocationChart({
  stocks,
  bonds,
  cash,
}: {
  /** 三类资产占净值比（百分数，85.2 = 85.2%） */
  stocks: number;
  bonds: number;
  cash: number;
}) {
  const mounted = useIsClient();

  // 全 0 / 负值过滤后为空 → 空态（调用方已挡 null，这里是双保险）
  const data = [
    { type: "股票", value: stocks },
    { type: "债券", value: bonds },
    { type: "现金", value: cash },
  ].filter(d => d.value > 0);

  if (data.length === 0) {
    return <EmptyState description="暂无资产配置数据" />;
  }

  const config: PieConfig = {
    data,
    angleField: "value",
    colorField: "type",
    // 全站图表统一主题（chart-theme.ts 单一出处）：
    // 环形三段自动吃色环前三：股票=靛蓝、债券=紫罗兰、现金=翠绿
    theme: FP_CHART_THEME,
    // 环形（支付宝基金页同款观感）：中心留白弱化面积对比、聚焦占比
    innerRadius: 0.6,
    // ⚠️ 刻意不传 height：与 Line 同理，高度交给 .fp-chart-box 的 CSS 管理
    autoFit: true,
    tooltip: {
      items: [
        {
          channel: "y",
          name: "占净值比",
          valueFormatter: (v: number) => `${v.toFixed(2)}%`,
        },
      ],
    },
  };

  return (
    // fp-chart-box：窄屏高度降档的挂载点（responsive.css §6）
    <div className="fp-chart-box">
      {mounted
        ? (
            <Suspense fallback={<ChartSkeleton />}>
              <Pie {...config} />
            </Suspense>
          )
        : (
            <ChartSkeleton />
          )}
    </div>
  );
}
