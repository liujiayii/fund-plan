/**
 * A/B 双主题的唯一 token 来源，保持零框架依赖以供 UnoCSS 与领域测试直接读取。
 * A：瓷白钴蓝，内容面轻、玻璃集中导航；B：墨蓝香槟，保留烟晶层次。
 * DOM 消费 COLOR 的 CSS 引用；canvas 与 antd 算法消费 THEME_COLORS 的实际色值。
 */
export const THEME_COLORS = {
  ceramic: {
    primary: "#305BDC",
    primaryTo: "#6687ED",
    primaryBg: "rgba(48,91,220,0.10)",
    onPrimary: "#FFFFFF",
    // 金银铜奖牌始终是浅装饰底，前景独立于主按钮的明暗规则。
    medalInk: "#253242",
    up: "#C43C48",
    down: "#21775F",
    upBg: "rgba(196,60,72,0.10)",
    downBg: "rgba(33,119,95,0.10)",
    pending: "#956717",
    pendingBg: "rgba(149,103,23,0.10)",
    neutral: "#68788D",
    bg: "#F1F5FA",
    card: "#FFFFFF",
    well: "rgba(34,61,103,0.045)",
    border: "rgba(35,55,90,0.11)",
    elevated: "#FCFDFF",
    mask: "rgba(24,39,63,0.32)",
    textPrimary: "#202D43",
    textSecondary: "#52647D",
    textTertiary: "#64758A",
    textPlaceholder: "#8793A4",
    glassBase: "rgba(255,255,255,0.86)",
    glassTop: "rgba(255,255,255,0.18)",
    glassBottom: "rgba(233,242,255,0.035)",
    glassBorder: "rgba(28,56,105,0.065)",
    glassEdgeStart: "rgba(255,255,255,0.38)",
    glassEdgeMiddle: "rgba(143,172,215,0.08)",
    glassEdgeEnd: "rgba(255,255,255,0.16)",
    glassShadow: "0 4px 20px rgba(39,66,112,0.045)",
    glassInsetShadow: "inset 0 0 0 transparent",
    glassBlur: "0px",
    glassRimOpacity: "0",
    chromeBase: "rgba(246,251,255,0.58)",
    chromeBlur: "14px",
    chromeShadow: "0 5px 22px rgba(35,64,109,0.08)",
    chromeBorder: "rgba(255,255,255,0.35)",
    chromeRimOpacity: "0.48",
    plate: "rgba(34,61,103,0.04)",
    plateBorder: "rgba(35,55,90,0.07)",
    plateHighlight: "rgba(255,255,255,0.6)",
    backdropGrid: "rgba(66,103,159,0.045)",
    backdropGlow: "rgba(118,164,237,0.19)",
    backdropGlowSecondary: "rgba(153,208,220,0.15)",
    // 粒子与抓线为低浓度装饰色，canvas 直接消费实际值。
    particleA: "#305BDC",
    particleB: "#5796B8",
    particleC: "#7EA7D6",
    ribbonStart: "#D2E0F6",
    ribbonMiddle: "#B0CBEE",
    ribbonEnd: "#D8EBF4",
    ribbonEdge: "rgba(255,255,255,0.52)",
    ribbonShadow: "rgba(72,111,173,0.09)",
    primaryGradient: "linear-gradient(115deg, #305BDC 0%, #456DDF 100%)",
    skeletonFrom: "rgba(40,65,110,0.045)",
    skeletonTo: "rgba(40,65,110,0.09)",
  },
  graphite: {
    primary: "#D3BD93",
    primaryTo: "#E4D5B8",
    primaryBg: "rgba(211,189,147,0.14)",
    onPrimary: "#1B232B",
    medalInk: "#253242",
    up: "#F28E89",
    down: "#75C5A6",
    upBg: "rgba(242,142,137,0.14)",
    downBg: "rgba(117,197,166,0.13)",
    pending: "#E3BE76",
    pendingBg: "rgba(227,190,118,0.14)",
    neutral: "#9CAFBE",
    bg: "#101C29",
    card: "rgba(24,44,62,0.6)",
    well: "rgba(213,232,249,0.055)",
    border: "rgba(169,197,222,0.17)",
    elevated: "#203141",
    mask: "rgba(3,9,16,0.62)",
    textPrimary: "#F0F4F7",
    textSecondary: "#BFCCD7",
    textTertiary: "#A0B3C4",
    textPlaceholder: "#76899B",
    glassBase: "rgba(22,42,60,0.57)",
    glassTop: "rgba(191,219,243,0.12)",
    glassBottom: "rgba(4,17,30,0.08)",
    glassBorder: "rgba(161,195,223,0.20)",
    glassEdgeStart: "rgba(213,235,251,0.53)",
    glassEdgeMiddle: "rgba(101,156,210,0.18)",
    glassEdgeEnd: "rgba(186,204,221,0.24)",
    glassShadow: "0 12px 34px rgba(0,9,21,0.24)",
    glassInsetShadow: "inset 0 1px 0 rgba(209,231,249,0.18)",
    glassBlur: "4px",
    glassRimOpacity: "0.7",
    chromeBase: "rgba(25,44,61,0.55)",
    chromeBlur: "8px",
    chromeShadow: "0 8px 26px rgba(0,9,21,0.27)",
    chromeBorder: "rgba(184,211,232,0.25)",
    chromeRimOpacity: "0.8",
    plate: "rgba(3,14,24,0.25)",
    plateBorder: "rgba(170,201,227,0.09)",
    plateHighlight: "rgba(211,232,249,0.1)",
    backdropGrid: "rgba(155,193,227,0.045)",
    backdropGlow: "rgba(46,102,165,0.30)",
    backdropGlowSecondary: "rgba(148,125,83,0.13)",
    particleA: "#D3BD93",
    particleB: "#A5CDE8",
    particleC: "#729DBC",
    ribbonStart: "#274764",
    ribbonMiddle: "#416C8C",
    ribbonEnd: "#858D8D",
    ribbonEdge: "rgba(184,218,247,0.22)",
    ribbonShadow: "rgba(0,8,21,0.28)",
    primaryGradient: "linear-gradient(115deg, #D3BD93 0%, #E4D5B8 100%)",
    skeletonFrom: "rgba(213,232,249,0.055)",
    skeletonTo: "rgba(213,232,249,0.13)",
  },
} as const;

export type ThemeId = keyof typeof THEME_COLORS;
export type ThemePreference = ThemeId | "system";
export type ThemeColors = { readonly [K in keyof typeof THEME_COLORS.ceramic]: string };
export const THEME_STORAGE_KEY = "fp-theme-preference";
export const THEME_LABELS = { system: "跟随系统", ceramic: "A · 瓷白钴蓝", graphite: "B · 墨蓝金属" } as const;

/** 旧偏好、损坏的值及已淘汰的 C 都回到系统，不把任意值写进 DOM。 */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === "ceramic" || value === "graphite" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, dark: boolean): ThemeId {
  return preference === "system" ? (dark ? "graphite" : "ceramic") : preference;
}

export function cssTokenName(key: string): string {
  return `--fp-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
}

/** CSS 变量可在浏览器首帧和主题切换时直接更新，存量内联颜色也能同步。 */
export const COLOR = Object.freeze(
  Object.fromEntries(Object.keys(THEME_COLORS.ceramic).map(key => [key, `var(${cssTokenName(key)})`])),
) as ThemeColors;

export const PRIMARY_GRADIENT = "var(--fp-primary-gradient)";
export const NUM_FONT = "\"Space Grotesk\", \"DIN Alternate\", \"SF Mono\", ui-monospace, \"Menlo\", monospace";

/** 国内涨红跌绿；普通成功/错误不复用这一金融语义。 */
export function pnlColor(value: number): string {
  return value > 0 ? COLOR.up : value < 0 ? COLOR.down : COLOR.neutral;
}

function paletteCss(id: ThemeId): string {
  const variables = Object.entries(THEME_COLORS[id]).map(([key, value]) => `  ${cssTokenName(key)}: ${value};`);
  return [...variables, `  color-scheme: ${id === "graphite" ? "dark" : "light"};`].join("\n");
}

/** 无 JS 时也可跟随系统；显式 data-theme 优先于媒体查询，避免手动主题被系统覆盖。 */
export const THEME_CSS = [
  `:root, :root[data-theme="ceramic"] {\n${paletteCss("ceramic")}\n}`,
  `:root[data-theme="graphite"] {\n${paletteCss("graphite")}\n}`,
  `@media (prefers-color-scheme: dark) { :root:not([data-theme]) {\n${paletteCss("graphite")}\n} }`,
].join("\n");

/**
 * CSS 加载前执行，避免深浅首屏闪烁；不读 Cookie、不改变游客缓存键。
 * 存储禁用时仍可跟随系统，脚本只含内部常量，不拼接用户输入。
 */
export const THEME_BOOTSTRAP = `(function(){var p="system";try{var v=localStorage.getItem("${THEME_STORAGE_KEY}");if(v==="ceramic"||v==="graphite")p=v;}catch(e){}var d=false;try{d=matchMedia("(prefers-color-scheme: dark)").matches;}catch(e){}var t=p==="system"?(d?"graphite":"ceramic"):p;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=${JSON.stringify({ ceramic: THEME_COLORS.ceramic.bg, graphite: THEME_COLORS.graphite.bg })}[t];})();`;
