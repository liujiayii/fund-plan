import {
  defineConfig,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";
import { BAR_SHADOW, CARD_SHADOW, CARD_SHADOW_HOVER, COLOR, NUM_FONT, PRIMARY_GRADIENT } from "./app/theme";

/**
 * UnoCSS 配置。
 *
 * ⚠️ 与 antd 共存的三条关键取舍：
 *
 * 1. **关闭 preflight/reset**。UnoCSS 的全局重置会把 antd 的按钮、表单样式冲掉，
 *    出现按钮没背景色、输入框没边框之类的诡异问题。antd 自带 reset，不需要第二套。
 *    （注意区分：下面 config 级 preflights 输出的 --fp-* 变量不受此开关影响，
 *    preset 的 reset 关的是「全局样式重置」。）
 *
 * 2. **不启用 presetAttributify**。属性化写法（<div flex gap-2>）会把 antd 组件的
 *    普通 props 误当成工具类：`<Tag color="red">` 生成 `[color~="red"]{color:red}`、
 *    `<Table align="middle">` 生成 `[align~="middle"]{vertical-align:middle}`，
 *    这些规则会直接污染 antd 组件的渲染。
 *
 * 3. **token 单一出处**。颜色/字体/阴影的唯一出处是 app/theme.ts，本文件直接
 *    import 映射成主题类与 --fp-* CSS 变量，漂移在结构上不可能发生。
 */

/** camelCase → kebab-case（CSS 变量命名用）：textPrimary → text-primary */
function kebab(s: string): string {
  return s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

/**
 * COLOR 全量输出为 --fp-* CSS 变量（config 级 preflight）。
 * 消费方：app/styles/*.css——手写 CSS 进不了 JS 模块图，import 不到 theme.ts，
 * 只能靠这些变量共享 token（responsive.css 的 var(--fp-card) 等即来源于此）。
 * ⚠️ 本文件是 --fp-* 唯一的定义处；给 theme.ts 加新 token 时记得这里自动带上
 * （COLOR 上的键全自动，其余——字体/阴影/渐变——是手写的几行）。
 */
const FP_ROOT_VARS = [
  ...Object.entries(COLOR).map(([k, v]) => `  --fp-${kebab(k)}: ${v};`),
  `  --fp-num-font: ${NUM_FONT};`,
  `  --fp-card-shadow: ${CARD_SHADOW};`,
  // 注意 --fp-primary-to 不在这里手写：COLOR.primaryTo 键已被上面的
  // 全量映射自动输出（曾手写+自动各出一份导致变量重复定义，Task 12 收尾删除）
  `  --fp-primary-gradient: ${PRIMARY_GRADIENT};`,
  `  --fp-card-shadow-hover: ${CARD_SHADOW_HOVER};`,
  // 动效 token（visual-refresh spec §5：动效也是 token，不散写）。
  // 消费方：手写 CSS 与任意值类（如 duration-[240ms]）想换基准时长时引变量
  `  --fp-duration-fast: 150ms;`,
  `  --fp-duration-base: 240ms;`,
  `  --fp-duration-slow: 360ms;`,
  `  --fp-ease: cubic-bezier(0.22, 1, 0.36, 1);`,
].join("\n");

export default defineConfig({
  presets: [
    // Wind4 是 UnoCSS 对齐 Tailwind v4 的预设，工具类名与 Tailwind 一致
    presetWind4({
      // 关掉预设自带的全局重置，交给 antd
      preflights: {
        reset: false,
      },
    }),
    // 图标按需引入（用法：<div class="i-carbon-fund" />）
    // 需要图标集时：pnpm add -D @iconify-json/carbon
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
  ],
  transformers: [
    // 支持在 CSS 里写 @apply
    transformerDirectives(),
    // 支持 hover:(bg-red-500 text-white) 这种分组写法
    transformerVariantGroup(),
  ],
  rules: [
    // font-num：数字字体类（font-family + 表格数字双纪律合一）。
    // 自定义 rule 优先于 preset 的 fontFamily 主题类，把 tabular-nums
    // 钉进类本身——等宽不再依赖每个消费方记得补（spec 验收 #2）
    [/^font-num$/, () => ({
      "font-family": NUM_FONT,
      "font-variant-numeric": "tabular-nums",
    })],
  ],
  // 项目里常用的组合，抽成快捷方式
  shortcuts: {
    // 常用布局。（text-rise / text-fall 快捷方式已退役：theme.colors 直出同名类）
    "flex-center": "flex items-center justify-center",
    "flex-between": "flex items-center justify-between",
  },
  theme: {
    colors: {
      // 全量映射 app/theme.ts 的 COLOR——色值唯一出处，别在本文件写字面量。
      // 类名刻意用语义词而非 TS 键名：text-ink 好过 text-text-primary。
      "primary": COLOR.primary, // 品牌紫：text-primary / bg-primary / outline-primary
      "primary-bg": COLOR.primaryBg, // 主色紫雾底：bg-primary-bg（选中态）
      "rise": COLOR.up, // 涨：text-rise
      "fall": COLOR.down, // 跌：text-fall
      "flat": COLOR.neutral, // 平：text-flat
      "pending": COLOR.pending, // 待办第三语义：text-pending
      "pending-soft": COLOR.pendingBg, // 待办浅底：bg-pending-soft
      "page": COLOR.bg, // 页面底：bg-page
      "card": COLOR.card, // 兼容键（= well）：bg-card；新代码写 bg-well
      "well": COLOR.well, // 内井：bg-well（表头 / 行 hover / 选中底）
      "elevated": COLOR.elevated, // 不透明浮面：bg-elevated
      "line": COLOR.border, // 分割线：border-line
      "ink": COLOR.textPrimary, // 主文字：text-ink
      "muted": COLOR.textSecondary, // 次文字：text-muted
      "tertiary": COLOR.textTertiary, // 三级文字：text-tertiary
      "placeholder": COLOR.textPlaceholder, // 占位/禁用：text-placeholder
      "rise-soft": COLOR.upBg, // 涨浅底：bg-rise-soft
      "fall-soft": COLOR.downBg, // 跌浅底：bg-fall-soft
    },
    /**
     * 阴影与动效（visual-refresh spec §3.3/§5）。
     *
     * ⚠️ Wind4 的阴影主题键是单数 `shadow`（对齐 Tailwind v4 的 --shadow-* 变量），
     * 写 `boxShadow` 会静默无效——shadow-card 只会被 colors.card 兜成「阴影颜色」
     * 类（--un-shadow-color），永远出不了真的 box-shadow（Task 5 实测踩坑，
     * preset-wind4 的 handleShadow 读的是 theme.shadow）。
     */
    shadow: {
      // 卡片阴影：shadow-card，替代内联 boxShadow: CARD_SHADOW
      "card": CARD_SHADOW,
      // 页底固定操作条阴影（朝上、重一档）：shadow-bar
      "bar": BAR_SHADOW,
      // 卡片 hover 抬升影：shadow-card-hover（Task 5 消费）
      "card-hover": CARD_SHADOW_HOVER,
    },
    /**
     * 动效：animate-fade-up（区块淡入）/ animate-float（空态呼吸，Task 10 消费）。
     * animate-<name> 由 keyframes/durations/timingFns/counts 四表拼装
     * （fade-up 不给 counts → 默认 1 次；float 给 infinite）。
     *
     * ⚠️ 交错延迟用 `animate-delay-[60ms]` 而非 `[animation-delay:60ms]`：
     * animate-fade-up 的 animation 简写会重置 animation-delay 为 0，而
     * 任意属性类（[prop:value]）在产物里排在 animations 规则**之前**——
     * 简写后到反而压掉延迟，交错失效。animate-delay-* 与 animate-* 同属
     * animations 规则组且排在它后面，靠源序稳定取胜。另注意 important
     * 后缀必须写在方括号外（`[animation-delay:60ms]!`），写进值里
     * （`60ms!`）是非法 CSS 会被浏览器整条丢弃。
     */
    animation: {
      keyframes: {
        // 区块淡入：透明度 + 上移 8px（visual-refresh spec §5）
        "fade-up": "{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}",
        // 空态呼吸：缓慢上下浮动（Task 10 消费）
        "float": "{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}",
      },
      durations: { "fade-up": "360ms", "float": "4s" },
      timingFns: { "fade-up": "cubic-bezier(0.22, 1, 0.36, 1)", "float": "ease-in-out" },
      // counts 里只有不需要引号的键，eslint quote-props 要求此表裸写
      counts: { float: "infinite" },
    },
    /**
     * 断点显式对齐 antd 栅格（responsiveObserver：xs 480 / sm 576 / md 768 /
     * lg 992 / xl 1200 / xxl 1600）。presetWind4 默认走 Tailwind v4 的
     * sm 640 / md 768 / lg 1024，与 antd 只有 md 撞对——混用 Col sm={12}
     * （576）与 sm:xxx 类（640）会在 576~640px 出现两套断点错位跳变。
     *
     * ⚠️ 键名是单数 breakpoint（Wind4 对齐 Tailwind v4 --breakpoint-* 变量），
     * 写复数 breakpoints 会静默无效。本项目当前不使用断点变体类
     * （媒体查询全在手写 responsive.css），此项是防御性对齐：
     * 挡住将来有人顺手写 md:p-3 时与 antd 栅格错位。
     */
    breakpoint: {
      xs: "480px",
      sm: "576px",
      md: "768px",
      lg: "992px",
      xl: "1200px",
      xxl: "1600px",
    },
  },
  /**
   * --fp-* 变量输出（内容见 FP_ROOT_VARS 的注释）。
   */
  preflights: [
    {
      getCSS: () => `:root {\n${FP_ROOT_VARS}\n}`,
    },
  ],
  /**
   * 提取器：刻意不配置，用默认的全文扫描。
   *
   * 踩坑史（2026-09-08 定案，别再走回头路）：
   * - 曾写过 class-attribute-only 自定义提取器想挡 JS 裸词误报，但 @unocss/core
   *   会把默认 extractorSplit 强插队首（除非 extractorDefault: false），自定义
   *   提取器从未生效过；
   * - 而若真用 extractorDefault: false 关掉默认提取器，三元/模板串里的条件类
   *   （`isMe ? "bg-primary/6" : ""`）会静默提取不到——样式凭空消失，比死类可怕
   *   得多，且与「新增样式优先工具类」的规约直接冲突；
   * - 两害相权：保留全文扫描，接受它顺手捞出的死类。
   *
   * 死类 = 源码里恰好长得像工具类的词生成的无人引用规则（如 PeriodReturnGrid
   * 的周期 key "m1"、注释里的「fixed 条」）。它们无害——没有元素挂这些类，
   * 规则就是死文本。uno.gen.css 里看到属正常现象，不要追杀，
   * 更不要为消灭它们去改业务代码或注释。
   */
});
