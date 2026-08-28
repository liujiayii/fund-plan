/**
 * 图表统一高度的 JS 侧定义点：两处骨架屏的 inline 高度。
 *
 * ⚠️ 图表 config 刻意不传 height（G2 的 sizeOf 让显式 height 压过容器
 * 尺寸，传了 CSS 就管不住高度）——图区真实高度由 responsive.css §6 的
 * `.fp-chart-box > div:last-child` 全权管理（桌面 320 / 窄屏 220）。
 * 本常量与那段 CSS 是镜像关系，改的时候两处同改。
 */
export const CHART_HEIGHT = 320;
