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

  it("tsx / 手写 CSS 里 var(--fp-*) 引用的变量必须在 theme.ts 里有定义", () => {
    // 2026-09-22 定投计划页实测：SVG 里写了 fill="var(--fp-pending-soft)"，
    // 而 theme.ts 的键是 pendingBg（映射成 --fp-pending-bg）——变量名不存在，
    // var() 解析失败，那块底色**静默掉成黑色**（浏览器不报错、构建不报错、
    // 类型检查也不管字符串）。tooltip 里的类名是 bg-pending-soft，
    // 变量名却是 --fp-pending-bg，两者不同源，很容易写串。
    //
    // 这条守卫把「主题类名」与「CSS 变量名」这对易混的名字钉死：
    // 变量只能来自 COLOR 的键（kebab 化）加 uno.config 里手写的那几个。
    const theme = readFileSync(path.join(APP_DIR, "theme.ts"), "utf8");
    const colorBlock = theme.slice(
      theme.indexOf("export const COLOR"),
      theme.indexOf("} as const"),
    );
    const kebab = (s: string) => s.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
    const defined = new Set<string>([
      ...[...colorBlock.matchAll(/^ {2}([a-z]+):/gim)].map(m => `--fp-${kebab(m[1]!)}`),
      // uno.config.ts 的 FP_ROOT_VARS 里手写的那几个（非 COLOR 映射）
      "--fp-num-font",
      "--fp-primary-gradient",
      "--fp-duration-fast",
      "--fp-duration-base",
      "--fp-duration-slow",
      "--fp-ease",
    ]);

    const used = new Set<string>();
    for (const f of [...tsxFiles, ...cssFiles]) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\((--fp-[a-z0-9-]+)\)/g)) {
        used.add(m[1]!);
      }
    }

    expect([...used].filter(v => !defined.has(v)).sort()).toEqual([]);
  });

  it("图版（宪法 §2.6）落地在 liquid-glass.css，且必须是扁的", () => {
    // 2026-09-23 新增的材料档：装「一整块图」的深底 + 顶边内高光。
    // 它是**扁材料**——没有 backdrop-filter，因此不计入 §6 的玻璃节点预算；
    // 一旦有人给它加模糊，这条会红（那会同时打破 §2.6 与 §6 两条）
    const css = readFileSync(GLASS_CSS, "utf8");
    expect(css).toContain(".fp-plate {");
    const start = css.indexOf(".fp-plate {");
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).not.toMatch(/backdrop-filter/);
  });

  it("图版编排动效（宪法 §5）：动效在 motion.css、关断在 responsive.css、一处不漏", () => {
    const motion = readFileSync(path.join(APP_DIR, "styles/motion.css"), "utf8");
    // 三条 keyframe + 未播态的闸门 + 播放态
    expect(motion).toContain("@keyframes fp-fig-rise");
    expect(motion).toContain("@keyframes fp-fig-pop");
    expect(motion).toContain("@keyframes fp-fig-draw");
    expect(motion).toContain(".fp-reveal .fp-fig-aura");
    expect(motion).toContain(".fp-reveal.is-play .fp-fig-sheet");
    // 动效层不许出现模糊材料（那是 liquid-glass.css 的特权，§7 的 import 顺序也是为此）
    expect(motion).not.toMatch(/backdrop-filter/);

    // 最要紧的一条不变量：motion.css 里出现的**每一个动效类**都必须在
    // responsive.css 的减动效块里有对应关断——漏一个，用户关掉动效后
    // 那一块就会永远停在 opacity: 0（图缺一块，而且看着像渲染 bug）
    const responsive = readFileSync(path.join(APP_DIR, "styles/responsive.css"), "utf8");
    const figClasses = new Set(
      [...motion.matchAll(/\.(fp-fig-[a-z-]+)/g)].map(m => m[1]!),
    );
    expect(figClasses.size).toBeGreaterThanOrEqual(8);
    expect([...figClasses].filter(c => !responsive.includes(c)).sort()).toEqual([]);

    // 关断还必须**压得住**播放规则：motion.css 写的是 `.fp-reveal.is-play .fp-fig-*`
    // （特异性 0,3,0），比只带 `.fp-reveal` 的 0,2,0 高一级——source-order 救不了，
    // 必须 !important。漏了它，「页面已武装 + 用户中途开减少动态 + 元素才进视口」
    // 这个组合下动画照样播（CodeRabbit 评审抓出来的真 bug，别再让人「顺手清理」掉）
    expect(responsive).toMatch(/\.fp-reveal \.fp-fig-label\s*\{[^}]*animation: none !important/);
  });

  it("入场编排不许把「未播态」写进 SSR：闸门只在客户端挂", () => {
    // 这一页的 SEO 是刻意做到首屏 HTML 里的：若 fp-reveal 出现在服务端渲染的
    // 标签里，爬虫与无 JS 用户看到的就是三张空图。约束落在组件内部
    // （classList 只在 useLayoutEffect 里加），这里钉住「它确实是这么写的」
    const reveal = readFileSync(path.join(APP_DIR, "components/ui/Reveal.tsx"), "utf8");
    expect(reveal).toContain("useIsoLayoutEffect");
    expect(reveal).not.toMatch(/className=\{[^}]*fp-reveal/);
    expect(reveal).not.toMatch(/className=\{[^}]*is-play/);
  });
});
