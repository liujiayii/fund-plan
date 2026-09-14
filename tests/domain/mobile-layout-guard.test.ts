import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 移动端任务页底部布局守卫（2026-09-14 操作条贴底改造的自动化钉子）。
 *
 * 背景：基金详情 / 持仓详情两页的 BottomActionBar 原本窄屏上移 72px
 * 叠在 tabbar 胶囊上方——两层玻璃零缝贴脸、底部铬合计 ~144px，又挤又丑
 * （主人 2026-09-14 拍板改业界范式）。改造后：任务页窄屏藏 tabbar
 * （导航由顶部汉堡抽屉兜底），操作条以底弹层同款形态贴底（顶角 22，
 * 与 .ant-drawer-bottom 同一语言）——999 大圆角胶囊方案被主人验收
 * 枪毙，勿回魂。桌面从贴边全宽系统条升级为悬浮玻璃卡（左右留缝、
 * 四角 22、底距 16）。
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

  it("操作条窄屏 = 底弹层同款形态：全宽贴底含安全区 + 顶角 22", () => {
    // 旧的 72px 上移值若回归，说明 tabbar 让位关系被误改回叠罗汉形态；
    // 999 大圆角胶囊被主人验收枪毙（太臃肿）——顶角 22 的正断言兜底：
    // 若改回 999 胶囊，本条直接红（tabbar 自己的 999 不在此限）
    expect(RESPONSIVE_CSS).not.toContain("bottom: calc(72px + env(safe-area-inset-bottom))");
    expect(RESPONSIVE_CSS).toMatch(
      /\.fp-bottom-bar\s*\{\s*bottom:\s*env\(safe-area-inset-bottom\);\s*border-radius:\s*22px 22px 0 0;/,
    );
  });

  it("桌面操作条 = 悬浮玻璃卡：左 268（侧栏+缝）、右 24、底 16、四角 22", () => {
    expect(RESPONSIVE_CSS).toMatch(
      /\.fp-bottom-bar\s*\{\s*left:\s*268px;\s*right:\s*24px;\s*bottom:\s*16px;\s*border-radius:\s*22px;/,
    );
  });

  it("条内纵向布局钩子在位：note 不截断全展示 + 按钮组撑满", () => {
    // note 不截断是主人 2026-09-14 验收拍板（display block 盖 inline 的
    // -webkit-box + clamp 2 + overflow hidden 三件套），截断回归就是违约
    expect(RESPONSIVE_CSS).toContain(".fp-bottom-bar-note");
    expect(RESPONSIVE_CSS).toMatch(
      /\.fp-bottom-bar-note\s*\{\s*display:\s*block !important;\s*overflow:\s*visible !important;/,
    );
    expect(RESPONSIVE_CSS).not.toContain("-webkit-line-clamp: 1");
    expect(RESPONSIVE_CSS).toContain(".fp-bottom-bar-actions .ant-space-item");
  });

  it("任务页 Footer 窄屏让位 146px（note 3 行满配 130 + 呼吸 16）", () => {
    expect(RESPONSIVE_CSS).not.toContain("margin-bottom: calc(176px + env(safe-area-inset-bottom))");
    expect(RESPONSIVE_CSS).toContain("margin-bottom: calc(146px + env(safe-area-inset-bottom))");
  });

  it("任务页 fp-content 窄屏追加让位 146px（note 不截断的浮动条高按最坏行数给足）", () => {
    expect(RESPONSIVE_CSS).toMatch(
      /\.fp-has-bottom-bar \.fp-content\s*\{\s*padding-bottom:\s*calc\(146px \+ env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("root.tsx 壳层挂 fp-has-bottom-bar 类（复用 hasBottomBar 判定）", () => {
    // 判定源必须复用 hasBottomBar（useMatches 正则），不许另起炉灶算一遍
    expect(ROOT_TSX).toContain("hasBottomBar");
    expect(ROOT_TSX).toMatch(/hasBottomBar \? " fp-has-bottom-bar" : ""/);
  });
});
