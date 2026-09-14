import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 移动端任务页底部布局守卫（2026-09-14 操作条贴底改造的自动化钉子）。
 *
 * 背景：基金详情 / 持仓详情两页的 BottomActionBar 原本窄屏上移 72px
 * 叠在 tabbar 胶囊上方——两层玻璃零缝贴脸、底部铬合计 ~144px，又挤又丑
 * （主人 2026-09-14 拍板改业界范式）。改造后：任务页窄屏藏 tabbar
 * （导航由顶部汉堡抽屉兜底），操作条贴底含安全区，与桌面形态统一。
 *
 * 与 liquid-glass-guard 同款「结构不变式」：不测行为，测源码结构没被
 * 误删误改——窄屏媒体查询块历来是 source-order 敏感区（同 specificity
 * 后到者胜），谁动了这几条规则该红就红。
 */

const APP_DIR = path.resolve(import.meta.dirname, "../../app");
const RESPONSIVE_CSS = readFileSync(path.join(APP_DIR, "styles/responsive.css"), "utf8");
const ROOT_TSX = readFileSync(path.join(APP_DIR, "root.tsx"), "utf8");

describe("移动端任务页底部布局守卫", () => {
  it("任务页窄屏藏 tabbar：fp-shell 后续同级的 .fp-tabbar display none", () => {
    // 藏 tabbar 的规则必须在 max-width: 767px 块里（桌面 .fp-mobile 本就隐藏，
    // 这条只管窄屏）；作用域限定 .fp-has-bottom-bar——其余页面 tabbar 常驻。
    // ⚠️ 必须 ~ 同级组合器：MobileTabBar 是 .fp-shell 的后续同级而非后代
    // （root.tsx 里 <MobileTabBar /> 在壳 div 之外），后代选择器匹配不到
    // ——初版翻过的车，CodeRabbit PR #92 抓出，此处钉死不许退回
    expect(RESPONSIVE_CSS).toContain("@media (max-width: 767px)");
    expect(RESPONSIVE_CSS).toMatch(
      /\.fp-shell\.fp-has-bottom-bar ~ \.fp-tabbar\s*\{\s*display:\s*none/,
    );
  });

  it("操作条窄屏贴底含安全区（不再为 tabbar 上移 72px）", () => {
    // 旧的 72px 上移值若回归，说明 tabbar 让位关系被误改回叠罗汉形态
    expect(RESPONSIVE_CSS).not.toContain("bottom: calc(72px + env(safe-area-inset-bottom))");
    // 贴底 = 桌面形态 + iOS home indicator 安全区让位
    expect(RESPONSIVE_CSS).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.fp-bottom-bar\s*\{\s*bottom:\s*env\(safe-area-inset-bottom\)/,
    );
  });

  it("任务页 Footer 窄屏让位 88px（tabbar 让位取消后 176px 已退役）", () => {
    expect(RESPONSIVE_CSS).not.toContain("margin-bottom: calc(176px + env(safe-area-inset-bottom))");
    expect(RESPONSIVE_CSS).toContain("margin-bottom: calc(88px + env(safe-area-inset-bottom))");
  });

  it("root.tsx 壳层挂 fp-has-bottom-bar 类（复用 hasBottomBar 判定）", () => {
    // 判定源必须复用 hasBottomBar（useMatches 正则），不许另起炉灶算一遍
    expect(ROOT_TSX).toContain("hasBottomBar");
    expect(ROOT_TSX).toMatch(/hasBottomBar \? " fp-has-bottom-bar" : ""/);
  });
});
