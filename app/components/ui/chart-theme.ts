import { CARD_SHADOW, COLOR } from "~/theme";

/**
 * G2 图表主题（visual-refresh spec §4.2）——五个图表组件的视觉单一出处。
 * 色值全部引用 COLOR，不写字面量；tooltip 与卡片同质感（白底 12 圆角双层影）。
 *
 * ⚠️ 键名以所装 @antv/g2@5.4.8 的真实主题 schema 为准（theme 对象与配置一样
 * 是宽松索引类型，typecheck 拦不住写错的键，以下均为运行时考证过的有效结构）：
 *   - G2 主题**没有** `components.xxx` / `axis.common` 这类分组命名空间：
 *     组件直接按名字查 `theme[type]`（axis / legendCategory / tooltip …），
 *     axis 的样式键**平铺**（线性轴消费 theme.axis + axisLeft/axisY 等位置键）；
 *   - 多序列（colorField）配色走 `category10`（runtime/scale.js 的
 *     categoricalColors 只读它），`color` 只是无 colorField 的单序列默认色；
 *   - tooltip 由同名交互消费：useThemeInteraction 把 theme.tooltip 深合进
 *     交互选项，其 `css` 键是对应 DOM 的 CSS 类选择器（容器类 `g2-tooltip`），
 *     属性键必须 kebab-case（@antv/component 用 cssText 拼接样式）；
 *   - 默认主题给坐标轴各部件挂了透明度（label .45 / grid .1 / line .45 /
 *     tick .45），不显式钉 1 的话下面的色值会被稀释到不可读，故一并覆盖。
 *
 * 个别图表要局部改观感时，config 的 axis/tooltip 内联值优先级高于主题，
 * 不必改这里。
 */
export const FP_CHART_THEME = {
  // 主序列默认色（无 colorField 的单线/面积）：品牌靛蓝
  color: COLOR.primary,
  // 多序列色环（spec §4.2；2026-09-09 走查调整）：品牌靛蓝 → 雾灰 → 翠绿
  // → 琥珀 → 压暗紫罗兰。第二位刻意给雾灰而非紫罗兰——基准线/债券等
  // 第二序列是辅助角色，与主线同属蓝紫区会缠成一片（用户走查实测）；
  // 紫罗兰压到第五位做五序列兜底。NavChart 的基准线另有显式 color 覆盖。
  // （琥珀 #F59E0B 是图表专用延伸色，不进 theme.ts——后者只放跨页复用的语义色）
  category10: [
    COLOR.primary,
    COLOR.neutral,
    COLOR.down,
    "#F59E0B",
    COLOR.primaryTo,
  ],
  // 坐标轴：文字雾灰 11px；轴线/刻度线/网格线同用分割线浅色，网格 4-4 虚线
  axis: {
    labelFill: COLOR.textTertiary,
    labelFontSize: 11,
    labelOpacity: 1,
    lineStroke: COLOR.border,
    lineStrokeOpacity: 1,
    tickStroke: COLOR.border,
    tickOpacity: 1,
    gridStroke: COLOR.border,
    gridStrokeOpacity: 1,
    gridLineDash: [4, 4],
  },
  // 图例文字与坐标轴同灰阶（多序列折线图 / 资产配置饼图）
  legendCategory: {
    itemLabelFill: COLOR.textTertiary,
  },
  // tooltip 走交互选项的 css（选择器键），白底 12 圆角双层影、与卡片同质感
  tooltip: {
    css: {
      ".g2-tooltip": {
        "background-color": COLOR.card,
        "border-radius": "12px",
        "box-shadow": CARD_SHADOW,
        "color": COLOR.textPrimary,
      },
    },
  },
};

/**
 * 面积渐变填充（AssetTrendChart 用）：靛蓝 16% → 透明，自上而下淡出
 * （曲线侧实、基线侧透明）。180deg 即 CSS 语义的顶部起点（0% 色在顶部）；
 * ⚠️ 不要写成 270deg——那是水平渐变（右实左透明），与「自顶向基淡出」意图不符。
 * hex8 后缀拼透明度（29 ≈ 16%），保持与 COLOR 同源。
 */
export const FP_AREA_FILL = `linear-gradient(180deg, ${COLOR.primary}29 0%, ${COLOR.primary}00 100%)`;
