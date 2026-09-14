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

  it("antd v6 面板节点名钉死：Modal 走 ant-modal-container、Drawer 走 ant-drawer-section", () => {
    // v5 旧名（ant-modal-content / ant-drawer-content）在 v6 DOM 里不存在，
    // 钉旧名的规则会**静默失效**——Modal 因此裸奔了整个 v6 早期，主人
    // 2026-09-14 验收「Modal 没吃玻璃」才抓出来。升级 antd 时这条会红，
    // 红了就去查新 DOM 结构改选择器（别急着改测试迁就）。
    // 用「类名后紧跟 , 或 {」的选择器形态匹配，注释里的类名提及不误杀
    const css = readFileSync(GLASS_CSS, "utf8");
    expect(css).toMatch(/\.ant-modal \.ant-modal-container\s*,/);
    expect(css).toMatch(/\.ant-drawer \.ant-drawer-section\s*,/);
    expect(css).not.toMatch(/\.ant-modal-content\s*[,{]/);
    expect(css).not.toMatch(/\.ant-drawer-content\s*[,{]/);
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
