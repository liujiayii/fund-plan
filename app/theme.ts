/**
 * 全站视觉 token —— 颜色、卡片阴影与数字字体的**唯一出处**。
 *
 * ⚠️ 本文件刻意零 import：它被 node 环境的单测导入，
 * 一旦引入 antd 就会把整个组件库拖进测试进程。
 * `ANTD_TOKEN` 只是普通对象，`theme.defaultAlgorithm` 请在 root.tsx 里引。
 *
 * 为什么主色是蓝而不是红：涨跌用红绿是国内习惯，如果主色也是红，
 * 按钮/标签/进度条就和「涨」撞成一片，用户分不清「这是操作」还是「这是赚钱」。
 * 支付宝的解法就是把主色让给品牌蓝，红绿只留给涨跌。
 * 2026-09-09 换晨雾靛蓝（visual-refresh spec §3.1）；同日走查修正：
 * 首版 #4E6BFF 色相 230° 处在蓝紫边缘，大面积渲染观感发紫——
 * 调至 #3B6BFF（色相 225°），保住晨雾气质但不再显紫（用户验收裁定）
 */

export const COLOR = {
  /** 品牌 / 操作：按钮、链接、选中态、进度条（晨雾靛蓝，visual-refresh spec §3.1） */
  primary: "#3B6BFF",
  /** 主色浅底（圆底图标、选中态底色）。与 antd token colorPrimaryBg 同值，别散写字面量 */
  primaryBg: "#EEF1FF",
  /** 渐变终点色（靛蓝→紫罗兰）：Logo SVG 的 stop 与 --fp-primary-to 消费 */
  primaryTo: "#6E5BFF",
  /** 涨 / 收益为正（柔红：降饱和，脱离 Excel 条件格式感） */
  up: "#F04438",
  /** 跌 / 收益为负（翠绿） */
  down: "#12B76A",
  /** 涨浅底：涨跌徽章、日历格、图表柱底 */
  upBg: "#FEECEB",
  /** 跌浅底 */
  downBg: "#E6F6EF",
  /** 平（0 或无数据）——雾蓝灰，与品牌色同调 */
  neutral: "#98A2B8",
  /** 页面底色：蓝调雾白 */
  bg: "#F6F7FB",
  /** 卡片底色 */
  card: "#FFFFFF",
  /** 分割线：微蓝调 */
  border: "#E9EAF2",
  // ── 文字四档（对齐 antd colorText* 语义，visual-refresh spec §3.2）──
  textPrimary: "#181A2D",
  textSecondary: "#5C637E",
  textTertiary: "#8A90A6",
  textPlaceholder: "#B7BCCB",
} as const;

/**
 * 品牌渐变：hero、Logo 视觉锤、登录分屏的唯一出处（spec §3.1）。
 * 135deg：左上靛蓝 → 右下紫罗兰。
 */
export const PRIMARY_GRADIENT = "linear-gradient(135deg, #3B6BFF 0%, #6E5BFF 100%)";

/**
 * 卡片阴影（双层）：接触影定层次 + 品牌色调氛围影给「浮起感」（spec §3.3）。
 * 氛围层带 8% 靛蓝，比纯黑影通透。全站卡片唯一出处。
 */
export const CARD_SHADOW = "0 1px 2px rgba(24, 26, 45, 0.04), 0 12px 32px -8px rgba(59, 107, 255, 0.08)";

/** 卡片 hover 抬升影：氛围层加深加大，配合 240ms 过渡（spec §5 动效 #1） */
export const CARD_SHADOW_HOVER = "0 2px 4px rgba(24, 26, 45, 0.05), 0 20px 48px -12px rgba(59, 107, 255, 0.14)";

/**
 * 页底固定操作条阴影：方向朝上（条浮在内容之上），比卡片阴影重一档。
 * 操作条是全页唯一的「悬浮层」，轻了读不出浮起。
 */
export const BAR_SHADOW = "0 -4px 24px rgba(24, 26, 45, 0.06)";

/**
 * 数字用等宽字体栈。Space Grotesk 头部优先（自托管，Task 2 接入），
 * 等宽纪律由 font-num 工具类自带的 tabular-nums 保证（spec §3.3）。
 */
export const NUM_FONT
  = "\"Space Grotesk\", \"DIN Alternate\", \"SF Mono\", ui-monospace, \"Menlo\", monospace";

/**
 * 涨红跌绿（国内习惯）。
 *
 * ⚠️ 与旧实现的区别：0 返回灰色而非 undefined。
 * 旧实现返回 undefined 让它继承正文色，导致「0 盈亏」看起来像正常文字，
 * 分不清是「不赚不亏」还是「这列不是盈亏」。
 */
export function pnlColor(v: number): string {
  if (v > 0)
    return COLOR.up;
  if (v < 0)
    return COLOR.down;
  return COLOR.neutral;
}

/**
 * antd ConfigProvider 的 theme 配置。
 *
 * ⚠️ 绝不要把 colorSuccess 映射成 COLOR.up、colorError 映射成 COLOR.down。
 * 那会反向污染所有非金融语义：错误 Alert 变绿、成功 Alert 变红、
 * <Tag color="success"> 变红。antd 的语义色保持原样（成功绿、错误红），
 * 涨跌只通过 COLOR.up / COLOR.down / pnlColor 表达，两套色系各管一摊。
 *
 * 四档文字显式映射：antd 组件与自绘文字同一灰阶体系，spec §4.1
 */
export const ANTD_TOKEN = {
  token: {
    colorPrimary: COLOR.primary,
    colorInfo: COLOR.primary,
    colorBgLayout: COLOR.bg,
    colorText: COLOR.textPrimary,
    colorTextSecondary: COLOR.textSecondary,
    colorTextTertiary: COLOR.textTertiary,
    colorTextQuaternary: COLOR.textPlaceholder,
    // 显式钉死：与 --fp-primary-bg 零漂移，不赌 antd 的派生算法
    colorPrimaryBg: COLOR.primaryBg,
    colorBorderSecondary: COLOR.border,
    borderRadius: 10,
  },
  components: {
    // 卡片圆角比控件大一档（10→16），支付宝式大圆角的关键一档
    Card: { borderRadiusLG: 16 },
    // 主按钮投影带品牌色调（纯黑投影在浅蓝紫系里显脏）
    Button: { primaryShadow: "0 6px 16px rgba(59, 107, 255, 0.24)" },
    Layout: {
      headerBg: COLOR.card,
      bodyBg: COLOR.bg,
      footerBg: "transparent",
    },
    Menu: { itemBg: "transparent" },
  },
};
