import { describe, expect, it } from "vitest";
import { createAreaFill, createChartTheme } from "~/components/ui/chart-theme";
import { THEME_COLORS } from "~/theme";

/** Canvas 不解析 CSS 变量；两套主题都必须直接交给 G2 实际色值。 */
describe.each(Object.entries(THEME_COLORS))("%s 图表主题", (_id, colors) => {
  it("主线、序列与坐标轴都使用当前色板的实际颜色", () => {
    const theme = createChartTheme(colors);
    expect(theme.color).toBe(colors.primary);
    expect(theme.category10).toContain(colors.neutral);
    expect(theme.category10).toContain(colors.down);
    const canvasColors = [theme.color, ...theme.category10, theme.axis.labelFill, theme.axis.lineStroke, theme.axis.gridStroke];
    for (const color of canvasColors) {
      expect(color).toMatch(/^(?:#[0-9a-f]{6}|rgba?\()/i);
      expect(color).not.toContain("var(");
    }
    // G2 默认透明度会把轴字和网格再次稀释，这几项必须继续覆盖。
    expect(theme.axis.labelOpacity).toBe(1);
    expect(theme.axis.lineStrokeOpacity).toBe(1);
    expect(theme.axis.gridStrokeOpacity).toBe(1);
  });

  it("tooltip 各子节点同步配色，避免继承默认浅底深字", () => {
    const css = createChartTheme(colors).tooltip.css;
    expect(css[".g2-tooltip"]["background-color"]).toBe(colors.elevated);
    expect(css[".g2-tooltip"].color).toBe(colors.textPrimary);
    expect(css[".g2-tooltip-title"].color).toBe(colors.textSecondary);
    expect(css[".g2-tooltip-list-item-name-label"].color).toBe(colors.textSecondary);
    expect(css[".g2-tooltip-list-item-value"].color).toBe(colors.textPrimary);
  });

  it("面积渐变自上向下淡出，两个色标都是可解析的 hex8", () => {
    const fill = createAreaFill(colors);
    const stops = fill.match(/^linear-gradient\(180deg, (#[0-9a-f]{8}) 0%, (#[0-9a-f]{8}) 100%\)$/i);
    expect(stops).not.toBeNull();
    expect(stops![1]!.slice(0, 7)).toBe(colors.primary);
    expect(Number.parseInt(stops![1]!.slice(-2), 16)).toBeGreaterThan(0);
    expect(stops![2]).toBe(`${colors.primaryTo}00`);
  });
});
