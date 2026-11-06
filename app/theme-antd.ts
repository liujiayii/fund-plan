import type { ThemeConfig } from "antd";
import type { ThemeId } from "~/theme";
import { token2CSSVar } from "@ant-design/cssinjs";
import { theme } from "antd";
import { COLOR, THEME_COLORS } from "~/theme";

// antd 自定义 key 就是实际类名，不会自动增加 css-var- 前缀。
const ANTD_CSS_KEY = "fp";
const ANTD_CSS_SCOPE = `.${ANTD_CSS_KEY}`;
const antVar = (key: string) => `var(${token2CSSVar(key, "ant")})`;

function createAntdTheme(id: ThemeId): ThemeConfig {
  const colors = THEME_COLORS[id];
  const inputColors = {
    activeShadow: `0 0 0 3px ${COLOR.primaryBg}`,
    errorActiveShadow: `0 0 0 2px ${antVar("colorErrorOutline")}`,
    warningActiveShadow: `0 0 0 2px ${antVar("colorWarningOutline")}`,
    hoverBorderColor: COLOR.primary,
    activeBorderColor: COLOR.primary,
    hoverBg: COLOR.well,
    activeBg: COLOR.well,
    addonBg: antVar("colorFillAlter"),
  };
  return {
    // 固定变量作用域：主题切换不重挂组件，首屏可直接选用另一套变量。
    cssVar: { key: ANTD_CSS_KEY },
    algorithm: id === "graphite" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: colors.primary,
      colorInfo: colors.primary,
      colorTextLightSolid: colors.onPrimary,
      colorBgBase: colors.bg,
      colorBgLayout: colors.bg,
      colorTextBase: colors.textPrimary,
      colorText: colors.textPrimary,
      colorTextSecondary: colors.textSecondary,
      colorTextTertiary: colors.textTertiary,
      colorTextQuaternary: colors.textPlaceholder,
      colorTextDescription: colors.textSecondary,
      colorTextLabel: colors.textSecondary,
      colorPrimaryBg: colors.primaryBg,
      colorBgContainer: colors.well,
      colorBgElevated: colors.elevated,
      colorBorder: colors.border,
      colorBorderSecondary: colors.border,
      colorSplit: colors.border,
      colorBgMask: colors.mask,
      borderRadius: 12,
      controlHeight: 36,
    },
    // 组件私有 token 也绑定变量，否则深色首屏会残留服务端 A 的表单标签和未选中项。
    components: {
      Form: { labelColor: COLOR.textPrimary, labelRequiredMarkColor: antVar("colorError") },
      Card: { colorBgContainer: "transparent", headerBg: "transparent", borderRadiusLG: 22, extraColor: COLOR.textPrimary },
      Button: {
        primaryShadow: "none",
        defaultShadow: "none",
        dangerShadow: "none",
        fontWeight: 500,
        defaultBg: COLOR.well,
        defaultBorderColor: COLOR.border,
        defaultColor: COLOR.textPrimary,
        primaryColor: COLOR.onPrimary,
        dangerColor: antVar("colorTextLightSolid"),
        textTextColor: COLOR.textPrimary,
        textTextHoverColor: COLOR.textPrimary,
        textTextActiveColor: COLOR.textPrimary,
        textHoverBg: antVar("colorFillTertiary"),
        defaultHoverBg: COLOR.well,
        defaultActiveBg: COLOR.well,
        defaultHoverColor: antVar("colorPrimaryHover"),
        defaultHoverBorderColor: antVar("colorPrimaryHover"),
        defaultActiveColor: antVar("colorPrimaryActive"),
        defaultActiveBorderColor: antVar("colorPrimaryActive"),
        defaultBgDisabled: antVar("colorBgContainerDisabled"),
        borderColorDisabled: antVar("colorBorderDisabled"),
      },
      Table: { headerColor: COLOR.textPrimary, headerBg: COLOR.well, headerSplitColor: "transparent", rowHoverBg: COLOR.primaryBg, borderColor: COLOR.border, colorBgContainer: "transparent" },
      Input: inputColors,
      InputNumber: {
        ...inputColors,
        handleBg: COLOR.well,
        handleActiveBg: antVar("colorFillAlter"),
        handleHoverColor: COLOR.primary,
        handleBorderColor: COLOR.border,
      },
      Select: {
        selectorBg: COLOR.well,
        clearBg: COLOR.well,
        optionSelectedColor: COLOR.textPrimary,
        optionSelectedBg: COLOR.primaryBg,
        optionActiveBg: antVar("controlItemBgHover"),
        hoverBorderColor: antVar("colorPrimaryHover"),
        activeBorderColor: COLOR.primary,
        activeOutlineColor: antVar("controlOutline"),
      },
      Modal: { titleColor: COLOR.textPrimary, contentBg: "transparent", headerBg: "transparent", footerBg: "transparent" },
      Drawer: { colorBgElevated: "transparent" },
      Tabs: {
        inkBarColor: COLOR.primary,
        itemColor: COLOR.textPrimary,
        itemSelectedColor: COLOR.primary,
        itemHoverColor: antVar("colorPrimaryHover"),
        itemActiveColor: antVar("colorPrimaryActive"),
      },
      Segmented: {
        trackBg: COLOR.well,
        itemSelectedBg: COLOR.primaryBg,
        itemSelectedColor: COLOR.textPrimary,
        itemColor: COLOR.textSecondary,
        itemHoverColor: COLOR.textPrimary,
        itemHoverBg: antVar("colorFillSecondary"),
        itemActiveBg: antVar("colorFill"),
      },
      Pagination: {
        itemBg: COLOR.well,
        itemActiveBg: COLOR.well,
        itemLinkBg: COLOR.well,
        itemActiveColor: COLOR.primary,
        itemActiveColorHover: antVar("colorPrimaryHover"),
        itemActiveColorDisabled: antVar("colorTextDisabled"),
        itemActiveBgDisabled: antVar("controlItemBgActiveDisabled"),
      },
      Alert: { borderRadius: 12 },
      Tag: { defaultBg: COLOR.well, defaultColor: COLOR.textSecondary },
      Progress: { defaultColor: COLOR.primary, remainingColor: COLOR.well },
      Timeline: { tailColor: COLOR.border },
      Skeleton: { gradientFromColor: COLOR.skeletonFrom, gradientToColor: COLOR.skeletonTo },
      Tooltip: { colorBgSpotlight: COLOR.elevated, colorTextLightSolid: COLOR.textPrimary },
      Message: { contentBg: COLOR.elevated },
    },
  };
}

const ANTD_THEMES = { ceramic: createAntdTheme("ceramic"), graphite: createAntdTheme("graphite") };
export function getAntdTheme(id: ThemeId): ThemeConfig {
  return ANTD_THEMES[id];
}

function antdVariables(id: ThemeId): string {
  // 沿用官方变量命名，包含 purple1 → --ant-purple-1 等预设色阶，以及控制项底色。
  return Object.entries(theme.getDesignToken(ANTD_THEMES[id]))
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${token2CSSVar(key, "ant")}:${value};`)
    .join("");
}

/** 同一份游客 HTML 服务两套主题；水合前、无 JS 都由根选择器决定配色。 */
export const ANTD_THEME_CSS = [
  `:root ${ANTD_CSS_SCOPE}{ ${antdVariables("ceramic")} }`,
  `:root[data-theme="ceramic"] ${ANTD_CSS_SCOPE}{ ${antdVariables("ceramic")} }`,
  `:root[data-theme="graphite"] ${ANTD_CSS_SCOPE}{ ${antdVariables("graphite")} }`,
  `@media(prefers-color-scheme:dark){:root:not([data-theme]) ${ANTD_CSS_SCOPE}{ ${antdVariables("graphite")} }}`,
].join("\n");
