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
 */

export const COLOR = {
  /** 品牌 / 操作：按钮、链接、选中态、进度条 */
  primary: "#1677FF",
  /** 涨 / 收益为正 */
  up: "#F5222D",
  /** 跌 / 收益为负 */
  down: "#00A870",
  /** 平（0 或无数据） */
  neutral: "#8C8C8C",
  /** 页面底色 */
  bg: "#F5F7FA",
  /** 卡片底色 */
  card: "#FFFFFF",
  /** 分割线 */
  border: "#EEF0F4",
  textPrimary: "#1F2329",
  textSecondary: "#8A9099",
} as const;

/**
 * 卡片阴影。全站卡片抬升感的**唯一出处** ——
 * SectionCard 与首页那两张裸 Card 都引它，别在组件里再写一遍字面量，
 * 否则同一页上会出现深浅不一的两种卡片。
 */
export const CARD_SHADOW = "0 1px 2px rgba(0, 0, 0, 0.04)";

/**
 * 数字用等宽字体栈，保证金额纵向对齐 ——
 * 比例字体下 "1" 比 "8" 窄，一列金额会参差不齐。
 */
export const NUM_FONT
  = "\"DIN Alternate\", \"SF Mono\", ui-monospace, Menlo, monospace";

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
 */
export const ANTD_TOKEN = {
  token: {
    colorPrimary: COLOR.primary,
    colorInfo: COLOR.primary,
    colorBgLayout: COLOR.bg,
    colorTextSecondary: COLOR.textSecondary,
    borderRadius: 8,
  },
  components: {
    // 卡片圆角比控件大一档，支付宝那套观感的关键
    Card: { borderRadiusLG: 12 },
    Layout: {
      headerBg: COLOR.card,
      bodyBg: COLOR.bg,
      footerBg: "transparent",
    },
    Menu: { itemBg: "transparent" },
  },
};
