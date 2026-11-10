import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeProvider, useAppTheme } from "~/components/ThemeProvider";
import { COLOR, parseThemePreference, THEME_BOOTSTRAP, THEME_COLORS, THEME_CSS } from "~/theme";

describe("双主题偏好与首屏", () => {
  it("仅保留手动深浅色，未选择、旧系统偏好与损坏值都默认深色", () => {
    expect(parseThemePreference("ceramic")).toBe("ceramic");
    expect(parseThemePreference("graphite")).toBe("graphite");
    for (const value of ["system", "pearl", "", null, undefined, {}, 1]) {
      expect(parseThemePreference(value)).toBe("graphite");
    }
  });

  it("服务端和水合初始上下文统一使用深色", () => {
    function ThemeReader() {
      const { theme, preference } = useAppTheme();
      return `${theme}:${preference}`;
    }
    expect(renderToStaticMarkup(createElement(ThemeProvider, null, createElement(ThemeReader))))
      .toBe("graphite:graphite");
  });

  it("没有主题属性或 JavaScript 时，默认 CSS 仍为深色", () => {
    const rootRules = THEME_CSS.match(/:root\s*(?:,[^{]*)?\{([^}]+)\}/)?.[1];
    expect(rootRules).toContain(`--fp-bg: ${THEME_COLORS.graphite.bg};`);
    expect(rootRules).toContain("color-scheme: dark;");
    expect(THEME_CSS).not.toContain("prefers-color-scheme");
  });

  it("两套 palette 拥有同样的语义键，DOM 使用变量，canvas 使用实际颜色", () => {
    expect(Object.keys(THEME_COLORS.ceramic).sort()).toEqual(Object.keys(THEME_COLORS.graphite).sort());
    expect(COLOR.primary).toBe("var(--fp-primary)");
    expect(THEME_COLORS.ceramic.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME_COLORS.graphite.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(THEME_COLORS.ceramic.primary).not.toBe(THEME_COLORS.graphite.primary);
    expect(THEME_CSS).toContain("[data-theme=\"ceramic\"]");
    expect(THEME_CSS).toContain("[data-theme=\"graphite\"]");
    expect(THEME_CSS).not.toContain("--fp-primary: var(--fp-primary)");
  });

  function bootstrap(saved: unknown, dark: boolean, blocked = false) {
    const dataset: Record<string, string> = {};
    const meta = { content: "" };
    // 仿真浏览器首屏；不会请求网络、加载 React 或修改真实 localStorage。
    runInNewContext(THEME_BOOTSTRAP, {
      document: { documentElement: { dataset }, querySelector: () => meta },
      localStorage: { getItem() {
        if (blocked)
          throw new Error("storage blocked");
        return saved;
      } },
      matchMedia: () => ({ matches: dark }),
    });
    return { dataset, meta };
  }

  it.each(["ceramic", "graphite"] as const)("首屏保留手动选择 %s，不受系统明暗影响", (theme) => {
    for (const dark of [false, true]) {
      const result = bootstrap(theme, dark);
      expect(result.dataset.theme).toBe(theme);
      expect(result.dataset.themePreference).toBe(theme);
      expect(result.meta.content).toBe(THEME_COLORS[theme].bg);
    }
  });

  it.each([null, "system", "pearl", ""])("首屏存储值 %s 回退深色，与系统偏好无关", (saved) => {
    for (const dark of [false, true]) {
      const result = bootstrap(saved, dark);
      expect(result.dataset).toEqual({ theme: "graphite", themePreference: "graphite" });
      expect(result.meta.content).toBe(THEME_COLORS.graphite.bg);
    }
  });

  it("存储受限仍默认深色，不阻止首屏渲染", () => {
    expect(bootstrap(null, false, true).dataset.theme).toBe("graphite");
    expect(bootstrap(null, true, true).dataset.theme).toBe("graphite");
  });
});
