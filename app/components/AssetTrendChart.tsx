import type { AreaConfig } from "@ant-design/charts";
import type { DailyAsset } from "~/domain/asset-timeline";
import { lazy, Suspense, useMemo, useState } from "react";
import { ChartSkeleton, useIsClient } from "~/components/ui/chart";
import { FP_AREA_FILL, FP_CHART_THEME } from "~/components/ui/chart-theme";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { centsToYuan } from "~/domain/money";
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
// Area（面积图）：支付宝资产走势同款观感——曲线下靛蓝渐变填充，
// 比裸线多一档「体量感」（visual-refresh spec §4.2）
const Area = lazy(async () => {
  const mod = await import("@ant-design/charts");
  return { default: mod.Area };
});

/**
 * 口径切换。默认「累计收益」：开局赠送 100 万本金，总资产曲线在百万基数上
 * 压成一条直线（每日几块~几十块的收益看不出形状），且签到入金 +50 元的跳变
 * 会被误读成收益。累计收益从 0 起步、已剔除净入金，涨跌一目了然。
 */
const MODES = [
  { key: "pnl", label: "累计收益" },
  { key: "asset", label: "总资产" },
] as const;

/** 时间范围选项 */
const RANGES = [
  { key: "1m", label: "近 1 月", days: 30 },
  { key: "3m", label: "近 3 月", days: 90 },
  { key: "1y", label: "近 1 年", days: 365 },
  { key: "all", label: "全部", days: Number.MAX_SAFE_INTEGER },
] as const;

/**
 * Displays asset or cumulative profit/loss trends across selectable time ranges.
 *
 * @param data - Daily asset records with monetary values represented in cents.
 */
export function AssetTrendChart({ data }: { data: DailyAsset[] }) {
  const [range, setRange] = useState<string>("3m");
  const [mode, setMode] = useState<string>("pnl");
  const mounted = useIsClient();

  const chartData = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range) ?? RANGES[1];
    // data 是正序（旧→新），取最后 N 条即为最近 N 天
    const sliced
      = cfg.days === Number.MAX_SAFE_INTEGER ? data : data.slice(-cfg.days);

    // 累计收益口径：先对**全量**数据做前缀和，再截取展示区间——
    // 这样曲线末点 = 全期累计收益，与上方「累计收益」数字、收益日历完全同口径
    // （Σ dayPnl，含已实现盈亏与费用，净入金已逐日剔除）。
    // 累加在「分」整数域进行——JS 整数在 2^53 内精确、此处量级远低于它，
    // 前缀和零误差，无需 Decimal；分→元换算则统一走 centsToYuan（Decimal）。
    if (mode === "pnl") {
      let cum = 0;
      const cumulative = data.map((d) => {
        cum += d.dayPnlCents;
        return { date: d.date, cents: cum };
      });
      return cumulative.slice(data.length - sliced.length).map(p => ({
        date: p.date,
        asset: Number(centsToYuan(p.cents)),
      }));
    }

    // 总资产口径：totalAssetCents 是分，走 centsToYuan 转成元（保留两位小数）
    return sliced.map(d => ({
      date: d.date,
      asset: Number(centsToYuan(d.totalAssetCents)),
    }));
  }, [data, range, mode]);

  if (data.length === 0) {
    // 走 EmptyState 而不是裸 Empty：全站空态的留白由它统一
    return <EmptyState description="暂无资产走势数据" hint="买入第一只基金后，这里会长出曲线" />;
  }

  // 累计收益要看盈亏分界，Y 轴必须含 0 基准线；
  // 总资产波动幅度小，Y 轴不从 0 起，否则曲线压成一条直线
  const isPnl = mode === "pnl";
  const config: AreaConfig = {
    data: chartData,
    xField: "date",
    yField: "asset",
    // 全站图表统一主题（chart-theme.ts 单一出处）
    theme: FP_CHART_THEME,
    // ⚠️ 刻意不传 height：G2 的 sizeOf 让显式 height 压过容器尺寸——
    // 传了它，CSS 压容器（窄屏 220）canvas 也不跟随，会竖向溢出容器。
    // 不传时 autoFit 读容器 clientHeight，高度由 responsive.css §6 全权管理
    autoFit: true,
    scale: { y: { nice: true, zero: isPnl } },
    axis: {
      x: { labelAutoHide: true, labelAutoRotate: false },
      y: { labelFormatter: (v: number) => v.toFixed(2) },
    },
    tooltip: {
      items: [
        {
          channel: "y",
          name: isPnl ? "累计收益（元）" : "总资产（元）",
          valueFormatter: (v: number) => v.toFixed(2),
        },
      ],
    },
    // 渐变面积 + 2px 平滑主线：填充给体量、线给走向。
    // ⚠️ 必须拆成 area + line 双 mark（2026-09-09 用户走查实测修复）：
    // 单 Area mark 传 lineWidth 会沿**闭合路径**整圈描边（stroke 回落到
    // color 通道的品牌色），累计收益口径 zero:true 时底边正好压在 y=0，
    // 渲染出一条「0 元处的品牌色横线」。拆开后 area 显式杀描边只管填充，
    // line mark 无闭合路径、只画上边缘曲线。
    // 平滑走 G2v5 的形状通道 style.shape（Area mark 的 shape 表注册了 smooth
    // 形状，运行时只认 style.shape 分发，见 g2 runtime/plot.js）；
    // 不能沿用 plots v1 时代的 smooth: true——plots 2.x / G2 v5 无任何读取方，
    // 且 AreaConfig 类型（Omit 折叠后丢了宽松索引签名）会直接报 TS2353。
    // 顶层 data/xField/yField/scale/axis 由 plots 的 transformOptions 自动
    // 分发给每个 child（core/utils/transform.js），children 只需各自给 style。
    children: [
      {
        type: "area",
        style: { shape: "smooth", fill: FP_AREA_FILL, lineWidth: 0, stroke: "transparent" },
      },
      {
        type: "line",
        style: { shape: "smooth", stroke: COLOR.primary, lineWidth: 2 },
      },
    ],
  };

  return (
    // fp-chart-box：图表窄屏高度降档的挂载点（responsive.css §6），包住切换行 + 图区
    <div className="fp-chart-box">
      {/* 口径切换是主叙事放左侧，时间范围靠右；窄屏 flexWrap 换行不顶穿 */}
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <PeriodTabs
          options={MODES.map(m => ({ key: m.key, label: m.label }))}
          value={mode}
          onChange={setMode}
        />
        <PeriodTabs
          options={RANGES.map(r => ({ key: r.key, label: r.label }))}
          value={range}
          onChange={setRange}
        />
      </div>
      {mounted
        ? (
            <Suspense fallback={<ChartSkeleton />}>
              <Area {...config} />
            </Suspense>
          )
        : (
            <ChartSkeleton />
          )}
    </div>
  );
}
