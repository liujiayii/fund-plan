import type { LineConfig } from "@ant-design/charts";
import type { DailyAsset } from "~/domain/asset-timeline";
import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { CHART_HEIGHT } from "~/components/ui/chart";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { centsToYuan } from "~/domain/money";

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
 * 图表占位骨架：SSR 与懒加载期间都用它，保证前后结构一致不闪。
 * 用 div + antd 的骨架动画色，而不是 Skeleton.Node ——
 * 后者默认渲染成圆形 avatar，跟横向的曲线图对不上。
 */
function ChartSkeleton() {
  return (
    <div
      style={{
        width: "100%",
        // 窄屏由 responsive.css §6 的 .fp-chart-box > div 压到 220（骨架同样是直接子 div）
        height: CHART_HEIGHT,
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
 * 资产走势曲线图。
 * 数据传入时金额是「分」整数，这里用 centsToYuan（Decimal）转成元再画。
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
    return <EmptyState description="暂无资产走势数据" />;
  }

  // 累计收益要看盈亏分界，Y 轴必须含 0 基准线；
  // 总资产波动幅度小，Y 轴不从 0 起，否则曲线压成一条直线
  const isPnl = mode === "pnl";
  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "asset",
    // ⚠️ 刻意不传 height：G2 的 sizeOf 让显式 height 压过容器尺寸——
    // 传了它，CSS 压容器（窄屏 220）canvas 也不跟随，会竖向溢出容器。
    // 不传时 autoFit 读容器 clientHeight，高度由 responsive.css §6 全权管理
    smooth: true,
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
    style: { lineWidth: 2 },
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
              <Line {...config} />
            </Suspense>
          )
        : (
            <ChartSkeleton />
          )}
    </div>
  );
}
