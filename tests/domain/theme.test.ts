import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { COLOR, parseThemePreference, resolveTheme, THEME_BOOTSTRAP, THEME_COLORS, THEME_CSS } from "~/theme";

describe("双主题偏好与首屏", () => {
  it("只接受 A/B 与系统偏好，淘汰或损坏的值回退到系统", () => {
    expect(parseThemePreference("ceramic")).toBe("ceramic");
    expect(parseThemePreference("graphite")).toBe("graphite");
    for (const value of ["system", "pearl", "", null, undefined, {}, 1]) {
      expect(parseThemePreference(value)).toBe("system");
    }
  });

  it("系统明暗映射 A/B，手动选择优先", () => {
    expect(resolveTheme("system", false)).toBe("ceramic");
    expect(resolveTheme("system", true)).toBe("graphite");
    expect(resolveTheme("ceramic", true)).toBe("ceramic");
    expect(resolveTheme("graphite", false)).toBe("graphite");
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

  it("首屏脚本在 React 前应用手动偏好", () => {
    const result = bootstrap("graphite", false);
    expect(result.dataset.theme).toBe("graphite");
    expect(result.dataset.themePreference).toBe("graphite");
    expect(result.meta.content).toBe(THEME_COLORS.graphite.bg);
  });

  it("首屏脚本默认跟随系统，存储受限也不阻止渲染", () => {
    expect(bootstrap(null, false).dataset.theme).toBe("ceramic");
    expect(bootstrap("pearl", true).dataset.theme).toBe("graphite");
    expect(bootstrap(null, true, true).dataset.theme).toBe("graphite");
  });
});
