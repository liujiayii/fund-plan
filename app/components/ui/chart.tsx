import { useSyncExternalStore } from "react";

/**
 * 图表统一高度的 JS 侧定义点：两处骨架屏的 inline 高度。
 *
 * ⚠️ 图表 config 刻意不传 height（G2 的 sizeOf 让显式 height 压过容器
 * 尺寸，传了 CSS 就管不住高度）——图区真实高度由 responsive.css §6 的
 * `.fp-chart-box > div:last-child` 全权管理（桌面 320 / 窄屏 220）。
 * 本常量与那段 CSS 是镜像关系，改的时候两处同改。
 */
export const CHART_HEIGHT = 320;

/**
 * 图表占位骨架：SSR 与懒加载期间都用它，保证前后结构一致不闪。
 * 用 div + antd 的骨架动画色，而不是 Skeleton.Node ——
 * 后者默认渲染成圆形 avatar，跟横向的曲线图对不上。
 * （2026-09-07 从 NavChart / AssetTrendChart 各一份合一抽出，
 *   FundPnlChart / AssetAllocationChart 是第三、四个消费方）
 */
export function ChartSkeleton() {
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
export function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
