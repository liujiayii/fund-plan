import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 液态玻璃宪法守卫（docs/liquid-glass.md §8 验收 #2 的自动化版）。
 *
 * 这是一组「结构不变式」测试：不测行为，测源码有没有违反材料层的硬约束。
 * 靠人眼 grep 的规矩迟早被忘，钉进测试谁破谁红。
 */

const APP_DIR = path.resolve(import.meta.dirname, "../../app");
const GLASS_CSS = path.join(APP_DIR, "styles/liquid-glass.css");

/** 递归收集目录下指定后缀的文件 */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory())
      out.push(...walk(full, exts));
    else if (exts.some(e => name.endsWith(e)))
      out.push(full);
  }
  return out;
}

describe("液态玻璃宪法守卫", () => {
  const tsxFiles = walk(APP_DIR, [".tsx", ".ts"]);
  const cssFiles = walk(path.join(APP_DIR, "styles"), [".css"]);

  it("tsx 里不出现 backdrop-filter / backdrop-blur（材料只在 liquid-glass.css）", () => {
    const offenders = tsxFiles.filter(f => /backdrop-(?:filter|blur)/.test(readFileSync(f, "utf8")));
    expect(offenders.map(f => path.relative(APP_DIR, f))).toEqual([]);
  });

  it("手写 CSS 里 backdrop-filter 只在 liquid-glass.css", () => {
    const offenders = cssFiles
      .filter(f => f !== GLASS_CSS)
      .filter(f => /backdrop-filter/.test(readFileSync(f, "utf8")));
    expect(offenders.map(f => path.basename(f))).toEqual([]);
  });

  it("晨雾靛蓝旧色零命中（#3B6BFF / #4E6BFF / #6E5BFF / antd #1677FF）", () => {
    const offenders = [...tsxFiles, ...cssFiles]
      .filter(f => /#(?:3B6BFF|4E6BFF|6E5BFF|1677FF)/i.test(readFileSync(f, "utf8")));
    expect(offenders.map(f => path.relative(APP_DIR, f))).toEqual([]);
  });

  it("liquid-glass.css 结构完整：玻璃、描边伪元素、高光、色雾、降级、减弱动态", () => {
    const css = readFileSync(GLASS_CSS, "utf8");
    expect(css).toContain(".fp-glass {");
    expect(css).toContain(".fp-glass::before");
    expect(css).toContain("mask-composite");
    expect(css).toContain(".fp-glass-specular");
    expect(css).toContain(".fp-fog");
    expect(css).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("弹层玻璃走 semantic 官方通道：配置在 antd-popup-glass.ts，CSS 不追内部类名", () => {
    // v5→v6 antd 内部面板节点两次改名（drawer content→section、modal
    // content 节点取消），钉旧类名的 CSS 规则静默失效、Modal 裸奔了
    // 整个 v6 早期（主人 2026-09-14 验收抓出）。此后材料一律走
    // ConfigProvider 的 semantic classNames——官方 API 把类挂到面板，
    // 类名叫什么 antd 说了算。CSS 侧只许 Dropdown 追内部类名
    // （它没有 popup 级 semantic，是独苗）。配置本体在
    // antd-popup-glass.ts（root.tsx 与本守卫共用一份真相）。
    // semantic 通道的 DOM 级验证（面板真挂上 fp-glass）由 2026-09-14
    // 的 happy-dom 人工诊断完成，已实锤三件套全过；antd 大版本升级时
    // 建议重跑同款诊断（临时装 happy-dom 渲染 Modal/Drawer/Select）。
    const css = readFileSync(GLASS_CSS, "utf8");
    const popupConf = readFileSync(path.join(APP_DIR, "antd-popup-glass.ts"), "utf8");
    const root = readFileSync(path.join(APP_DIR, "root.tsx"), "utf8");
    expect(popupConf).toContain("container: \"fp-glass\"");
    expect(popupConf).toContain("section: \"fp-glass\"");
    expect(popupConf).toContain("root: \"fp-glass\"");
    expect(root).toContain("POPUP_GLASS");
    expect(css).toMatch(/\.ant-dropdown \.ant-dropdown-menu\s*\{/);
    // modal / drawer / select 的内部类名零命中（选择器形态；注释里
    // 的类名提及不误杀——同条规则里 [,{] 只跟在选择器后面）
    expect(css).not.toMatch(/\.(?:ant-modal|ant-drawer|ant-select)[\w-]*\s*[,{]/);
  });

  it("色雾软边不用 filter: blur（宪法 §2.1 性能纪律）", () => {
    const css = readFileSync(GLASS_CSS, "utf8");
    // 只禁 filter: blur；backdrop-filter: blur 是玻璃本体，允许
    expect(css).not.toMatch(/(^|[^-])filter:\s*blur/m);
  });

  it("旧阴影常量已退役：theme.ts 不再导出 CARD_SHADOW / BAR_SHADOW（阴影是 .fp-glass 的材料）", () => {
    const theme = readFileSync(path.join(APP_DIR, "theme.ts"), "utf8");
    expect(theme).not.toMatch(/export const (?:CARD_SHADOW|BAR_SHADOW)/);
  });

  it("身份 / 方向 Tag 不再用 antd 预设蓝（宪法 §2.5：主色让给紫，蓝是旧身份）", () => {
    const offenders = tsxFiles.filter(f => /color="blue"/.test(readFileSync(f, "utf8")));
    expect(offenders.map(f => path.relative(APP_DIR, f))).toEqual([]);
  });
});
