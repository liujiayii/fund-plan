import type { ThemeColors } from "~/theme";

/**
 * 五个 G2 图表共享的主题工厂，Canvas 必须消费当前色板的实际颜色，
 * 不能使用 DOM 的 COLOR CSS 变量。切换主题时由 useChartTheme 重新生成。
 *
 * 键名遵循 @antv/g2@5.4.8 的真实 schema，宽松索引类型不会检查拼写：
 * - 没有 components.xxx / axis.common 分组；axis 样式键必须平铺。
 * - 多序列读取 category10，color 只控制没有 colorField 的主序列。
 * - tooltip.css 用 CSS 类选择器，属性名必须 kebab-case。
 * - 默认主题会叠加轴标签与线的透明度，因此显式覆盖为 1。
 */
export function createChartTheme(colors: ThemeColors) {
  return {
    color: colors.primary,
    // 第二序列退到中性辅助位，避免基准线与品牌主线混在一起。
    category10: [
      colors.primary,
      colors.neutral,
      colors.down,
      colors.pending,
      colors.primaryTo,
    ],
    axis: {
      labelFill: colors.textTertiary,
      labelFontSize: 11,
      labelOpacity: 1,
      lineStroke: colors.border,
      lineStrokeOpacity: 1,
      tickStroke: colors.border,
      tickOpacity: 1,
      gridStroke: colors.border,
      gridStrokeOpacity: 1,
      gridLineDash: [4, 4],
    },
    legendCategory: {
      itemLabelFill: colors.textTertiary,
    },
    // tooltip 覆盖 canvas，用 elevated 实色浮面保证金额可读。
    // 子选择器必须一起覆盖，否则库的默认浅底深字会压过容器 color。
    tooltip: {
      css: {
        ".g2-tooltip": {
          "background-color": colors.elevated,
          "border": `1px solid ${colors.border}`,
          "border-radius": "12px",
          "box-shadow": colors.chromeShadow,
          "color": colors.textPrimary,
        },
        ".g2-tooltip-title": {
          color: colors.textSecondary,
        },
        ".g2-tooltip-list-item-name-label": {
          color: colors.textSecondary,
        },
        ".g2-tooltip-list-item-value": {
          color: colors.textPrimary,
        },
      },
    },
  };
}

/**
 * 曲线侧 32% → 基线侧透明；180deg 是自上而下，270deg 会误画成水平渐变。
 * 主色与渐变尾色均为色板里的 hex6，拼透明度前不可换成 CSS 变量。
 */
export function createAreaFill(colors: ThemeColors): string {
  return `linear-gradient(180deg, ${colors.primary}52 0%, ${colors.primaryTo}00 100%)`;
}
