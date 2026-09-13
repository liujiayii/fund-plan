import { describe, expect, it } from "vitest";
import { FP_CHART_THEME } from "~/components/ui/chart-theme";
import { COLOR } from "~/theme";

/**
 * G2 tooltip 文字色守卫。
 *
 * 根因：@antv/component 默认 stylesheet 给 title / value 钉了浅底深字
 * （rgba(0,0,0,.45 / .85)），特异性压过容器 color。只刷 `.g2-tooltip` 底色
 * 会得到「深色弹窗 + 深色日期/金额」——冰川暗底上糊成一团。
 * G2 自带 Dark 主题就是靠这几个子选择器覆盖的，这里对齐钉到 COLOR 文字档。
 *
 * 放 tests/domain：chart-theme.ts 只引 theme.ts，零 antd / DOM，node 环境毫秒级。
 */
describe("FP_CHART_THEME tooltip 文字对比", () => {
  const css = FP_CHART_THEME.tooltip.css;

  it("容器是 elevated 实色浮面，字走主文字", () => {
    expect(css[".g2-tooltip"]["background-color"]).toBe(COLOR.elevated);
    expect(css[".g2-tooltip"].color).toBe(COLOR.textPrimary);
  });

  it("日期（title）与系列名走次要档，金额走主文字——不继承默认深字", () => {
    expect(css[".g2-tooltip-title"].color).toBe(COLOR.textSecondary);
    expect(css[".g2-tooltip-list-item-name-label"].color).toBe(COLOR.textSecondary);
    expect(css[".g2-tooltip-list-item-value"].color).toBe(COLOR.textPrimary);
  });
});
