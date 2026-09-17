import type { LineConfig } from "@ant-design/charts";
import type { DcaCurvePoint } from "~/domain/dca-backtest";
import { lazy, Suspense, useMemo } from "react";
import { ChartSkeleton, useIsClient } from "~/components/ui/chart";
import { FP_CHART_THEME } from "~/components/ui/chart-theme";
import { EmptyState } from "~/components/ui/EmptyState";
import { centsToYuan } from "~/domain/money";
import { COLOR } from "~/theme";

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

/**
 * 定投回测的「累计投入 vs 持仓市值」双线图。
 *
 * 为什么画**逐期**（每期一个点）而不是逐日：定投的现金本来就是每期进一次，
 * 逐期图恰好画出「成本台阶 vs 市值曲线」——市值线在成本线之上就是赚、之下就是亏，
 * 一眼能读；而逐日图要多传几百个点、多一份领域计算，回撤与年化在概览里已经给了。
 *
 * 数据取 `dcaCurvePoints(result)`：逐期点 + 期末估值点。补期末那一点是为了让
 * 两条线的终点就是概览里的「期末市值」——只画买入日的话，按周/按天定投的图上终点
 * 会与那个数字对不上（CodeRabbit 评审 #2）。
 */
export function DcaBacktestChart({ curve }: { curve: DcaCurvePoint[] }) {
  const mounted = useIsClient();

  const chartData = useMemo(
    () =>
      curve.flatMap(p => [
        // 金额（分）→ 元：Number(centsToYuan(...)) 与 FundPnlChart 同款换算
        { date: p.navDate, type: "累计投入", value: Number(centsToYuan(p.investedCents)) },
        { date: p.navDate, type: "持仓市值", value: Number(centsToYuan(p.valueCents)) },
      ]),
    [curve],
  );

  if (curve.length === 0) {
    // 走 EmptyState 而不是裸 Empty：全站空态的留白由它统一
    return <EmptyState description="暂无可画的定投曲线" hint="净值历史够 3 期才会出现" />;
  }

  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "value",
    // colorField 按 type 分组画两条线（与 NavChart 的双序列同款）
    colorField: "type",
    // 全站图表统一主题（chart-theme.ts 单一出处）
    theme: FP_CHART_THEME,
    // 显式色序：先出现的「累计投入」走雾灰辅助位、「持仓市值」走品牌靛蓝主线——
    // 与 NavChart 的「主序列靛蓝、辅助线雾灰」是同一条规则（2026-09-09 走查裁定）
    color: [COLOR.neutral, COLOR.primary],
    // ⚠️ 刻意不传 height：高度由 responsive.css §6 的 .fp-chart-box 全权管理
    autoFit: true,
    // 投入与市值都是正数，含 0 基准线才能看出「回本」的位置
    scale: { y: { nice: true, zero: true } },
    axis: {
      x: { labelAutoHide: true, labelAutoRotate: false },
      // 元为单位，整数刻度足够（两位小数在轴标签上纯噪音）
      y: { labelFormatter: (v: number) => v.toFixed(0) },
    },
    tooltip: {
      items: [
        {
          channel: "y",
          name: "金额（元）",
          valueFormatter: (v: number) => v.toFixed(2),
        },
      ],
    },
    // 平滑走 G2v5 形状通道 style.shape（smooth: true 是 plots v1 死配置）
    style: { shape: "smooth", lineWidth: 2 },
  };

  return (
    // fp-chart-box：图表窄屏高度降档的挂载点（responsive.css §6）
    <div className="fp-chart-box">
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
