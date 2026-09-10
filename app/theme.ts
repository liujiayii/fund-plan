/**
 * 全站视觉 token —— 颜色、渐变与数字字体的**唯一出处**。
 *
 * ⚠️ 本文件刻意零 import：它被 node 环境的单测导入，
 * 一旦引入 antd 就会把整个组件库拖进测试进程。
 * `ANTD_TOKEN` 只是普通对象，`theme.darkAlgorithm` 请在 root.tsx 里引。
 *
 * 2026-09-10 液态玻璃换血（docs/liquid-glass.md 是上位法，本文件的 hex
 * 必须与宪法 §2 逐字相同）：暗底夜盘 + 全站玻璃拟物。
 *
 * 为什么主色是紫而不是红：涨跌用红绿是国内习惯，主色让给品牌紫粉，
 * 按钮/选中/进度条才不会和「涨」撞成一片。涨改霓虹粉红、跌改青绿，
 * 是同一原则在暗底上的版本——它们和主色紫粉仍隔着可辨的色相距离。
 */

export const COLOR = {
  /** 品牌 / 操作：选中、链接、进度条、图表主序列（宪法 §2.5） */
  primary: "#7C5CFF",
  /** 渐变终点（粉）：主 CTA 药丸 `primary → primaryTo`、Logo、favicon */
  primaryTo: "#FF3D6E",
  /** 主色浅底：玻璃上的紫雾（选中项底、焦点环、Table 行 hover），不是实色块 */
  primaryBg: "rgba(124, 92, 255, 0.22)",
  /** 涨 / 收益为正（霓虹粉红） */
  up: "#FF5D8F",
  /** 跌 / 收益为负（青绿） */
  down: "#39FFCE",
  /** 涨浅底：涨跌胶囊、日历格 */
  upBg: "rgba(255, 93, 143, 0.16)",
  /** 跌浅底 */
  downBg: "rgba(57, 255, 206, 0.16)",
  /** 待办 / 在途（第三语义，宪法 §2.4）：待确认订单、在途资金。不跟涨跌混 */
  pending: "#F0D078",
  /** 待办浅底 */
  pendingBg: "rgba(240, 208, 120, 0.16)",
  /** 平（0 或无数据）——与三级文字同值，语义不同 */
  neutral: "#8A82B0",
  /** 页面底：近黑紫（宪法 §2.1） */
  bg: "#07060C",
  /**
   * 卡片底。⚠️ 与 well 同值：玻璃卡本身的材料在 .fp-glass（liquid-glass.css），
   * 本键只为兼容既有 bg-card 消费方（AuthShell 右屏等）；新代码一律写 well
   */
  card: "rgba(255, 255, 255, 0.06)",
  /** 内井（宪法 §2.6）：表头、输入框填充、行 hover、侧栏选中底、签到条 */
  well: "rgba(255, 255, 255, 0.06)",
  /** 分割线 / 输入框描边 / 表格行线 */
  border: "rgba(255, 255, 255, 0.16)",
  /** 不透明浮面：Tooltip / Popover / G2 tooltip / @supports 降级玻璃（宪法 §2.6） */
  elevated: "rgba(18, 14, 32, 0.92)",
  /** Modal / Drawer 遮罩（antd colorBgMask） */
  mask: "rgba(7, 6, 12, 0.55)",
  // ── 色雾三团（宪法 §2.1）。只被 liquid-glass.css 以 --fp-fog-* 消费，不出 uno 类 ──
  fogA: "#6D4DFF",
  fogB: "#FF3D8A",
  fogC: "#39D6FF",
  // ── 文字四档（对齐 antd colorText* 语义，宪法 §2.4）──
  textPrimary: "#F7F4FF",
  textSecondary: "#B9A8FF",
  textTertiary: "#8A82B0",
  textPlaceholder: "#6E6688",
} as const;

/**
 * 品牌渐变：主 CTA 药丸、Logo 视觉锤、favicon 的唯一出处（宪法 §2.5）。
 * 90deg：左紫 → 右粉。
 */
export const PRIMARY_GRADIENT = "linear-gradient(90deg, #7C5CFF 0%, #FF3D6E 100%)";

/**
 * 数字用等宽字体栈。Space Grotesk 头部优先（自托管），
 * 等宽纪律由 font-num 工具类自带的 tabular-nums 保证。
 */
export const NUM_FONT
  = "\"Space Grotesk\", \"DIN Alternate\", \"SF Mono\", ui-monospace, \"Menlo\", monospace";

/**
 * 涨红跌绿（国内习惯；暗底上是粉红 / 青绿）。
 *
 * ⚠️ 0 返回中性灰而非 undefined：让「0 盈亏」看起来像正常文字会分不清
 * 「不赚不亏」与「这列不是盈亏」。
 */
export function pnlColor(v: number): string {
  if (v > 0)
    return COLOR.up;
  if (v < 0)
    return COLOR.down;
  return COLOR.neutral;
}

/**
 * antd ConfigProvider 的 theme 配置（暗底，配合 root.tsx 的 theme.darkAlgorithm）。
 *
 * 为什么切暗色算法：默认算法在暗底上派生的是白容器、浅灰边、深字，
 * 每个组件都要手改、改不完；暗色算法把 Tag / Alert / Table / Segmented /
 * Dropdown 的中性色一次派生对，这里只钉品牌与材料（宪法 §7）。
 *
 * ⚠️ 绝不要把 colorSuccess 映射成 COLOR.up、colorError 映射成 COLOR.down。
 * 那会反向污染所有非金融语义：错误 Alert 变绿、成功 Alert 变红。
 * antd 的语义色保持原样，涨跌只通过 COLOR.up / COLOR.down / pnlColor 表达。
 */
export const ANTD_TOKEN = {
  token: {
    colorPrimary: COLOR.primary,
    colorInfo: COLOR.primary,
    // 暗色算法从 colorBgBase 派生全部中性面；Layout 底同色
    colorBgBase: COLOR.bg,
    colorBgLayout: COLOR.bg,
    colorTextBase: COLOR.textPrimary,
    colorText: COLOR.textPrimary,
    colorTextSecondary: COLOR.textSecondary,
    colorTextTertiary: COLOR.textTertiary,
    colorTextQuaternary: COLOR.textPlaceholder,
    // 显式钉死：与 --fp-primary-bg 零漂移，不赌派生算法
    colorPrimaryBg: COLOR.primaryBg,
    // 材料：容器填充 = 内井，浮面 = 不透明深色，边线 = 白 16%
    colorBgContainer: COLOR.well,
    colorBgElevated: COLOR.elevated,
    colorBorder: COLOR.border,
    colorBorderSecondary: COLOR.border,
    colorSplit: COLOR.border,
    colorBgMask: COLOR.mask,
    borderRadius: 12,
    controlHeight: 36,
  },
  components: {
    // 卡片：透明底让 .fp-glass 渐变透出来；圆角 22 是「卡片」角色档（宪法 §2.2）
    Card: { colorBgContainer: "transparent", headerBg: "transparent", borderRadiusLG: 22 },
    // 主按钮紫粉辉光取代黑影；次按钮玻璃胶囊（井底 + 描边，无影）
    Button: {
      primaryShadow: "0 8px 20px rgba(124, 92, 255, 0.35)",
      defaultShadow: "none",
      defaultBg: COLOR.well,
      defaultBorderColor: COLOR.border,
      fontWeight: 500,
    },
    // 表格扁着画：表头井、无表头竖线、行 hover 紫雾、表体透明（吃卡片玻璃）
    Table: {
      headerBg: COLOR.well,
      headerSplitColor: "transparent",
      rowHoverBg: COLOR.primaryBg,
      borderColor: COLOR.border,
      colorBgContainer: "transparent",
    },
    // 输入框：填充井（全局 colorBgContainer），焦点环品牌淡环
    Input: {
      activeShadow: `0 0 0 3px ${COLOR.primaryBg}`,
      hoverBorderColor: COLOR.primary,
      activeBorderColor: COLOR.primary,
    },
    // Modal / Drawer 面板透明——材料由 liquid-glass.css 直接写在内部类上
    Modal: { contentBg: "transparent", headerBg: "transparent", footerBg: "transparent" },
    Drawer: { colorBgElevated: "transparent" },
    Tabs: { inkBarColor: COLOR.primary },
    Segmented: {
      trackBg: COLOR.well,
      itemSelectedBg: COLOR.primaryBg,
      itemSelectedColor: COLOR.textPrimary,
    },
    Alert: { borderRadius: 12 },
    // 无色 Tag = 井底次要字（身份 Tag 去预设色后全走这里）
    Tag: { defaultBg: COLOR.well, defaultColor: COLOR.textSecondary },
    Progress: { remainingColor: COLOR.well },
    // 骨架屏闪光：黑色透明度在暗底隐形，改白
    Skeleton: {
      gradientFromColor: "rgba(255, 255, 255, 0.06)",
      gradientToColor: "rgba(255, 255, 255, 0.14)",
    },
  },
};
