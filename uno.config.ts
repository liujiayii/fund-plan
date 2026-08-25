import {
  defineConfig,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

/**
 * UnoCSS 配置。
 *
 * ⚠️ 与 antd 共存的三条关键取舍：
 *
 * 1. **关闭 preflight/reset**。UnoCSS 的全局重置会把 antd 的按钮、表单样式冲掉，
 *    出现按钮没背景色、输入框没边框之类的诡异问题。antd 自带 reset，不需要第二套。
 *
 * 2. **不启用 presetAttributify**。属性化写法（<div flex gap-2>）会把 antd 组件的
 *    普通 props 误当成工具类：`<Tag color="red">` 生成 `[color~="red"]{color:red}`、
 *    `<Table align="middle">` 生成 `[align~="middle"]{vertical-align:middle}`，
 *    这些规则会直接污染 antd 组件的渲染。实测生成的 23 条规则里有 8 条是这类垃圾。
 *
 * 3. **只用 UnoCSS 写布局与间距**，颜色/圆角/阴影仍走 antd 主题 token，
 *    保证视觉统一，也避免两套设计系统打架。
 */
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
  // 项目里常用的组合，抽成快捷方式
  shortcuts: {
    // 涨红跌绿（国内习惯），与 antd 主题色呼应
    "text-rise": "text-[#c62828]",
    "text-fall": "text-[#2e7d32]",
    // 常用布局
    "flex-center": "flex items-center justify-center",
    "flex-between": "flex items-center justify-between",
  },
  theme: {
    colors: {
      // 与 antd ConfigProvider 里的 colorPrimary 保持一致
      primary: "#c62828",
      rise: "#c62828",
      fall: "#2e7d32",
    },
  },
  /**
   * 只从 className="..." / class="..." 里提取工具类。
   *
   * 默认提取器会扫全文，把 JS 代码当成 class 误报：
   *   `m[s] ?? {...}`（取值）→ 生成 `.m\[s\]{margin:s}`
   *   `{!me && (`（条件渲染）→ 生成 `.me` 与 `.!me`
   * 这些垃圾规则虽然无害，但污染产物、也让人怀疑配置有问题。
   */
  extractors: [
    {
      name: "class-attribute-only",
      extract({ code }) {
        const found = new Set<string>();
        // 匹配 className="..." 或 class="..."（含模板字符串里的静态部分）
        const re = /(?:class|className)\s*=\s*["'`]([^"'`]*)["'`]/g;
        for (const m of code.matchAll(re)) {
          for (const token of m[1].split(/\s+/)) {
            if (token)
              found.add(token);
          }
        }
        return found;
      },
    },
  ],
});
