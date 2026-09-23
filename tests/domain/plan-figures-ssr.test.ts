import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MethodCurve, TriVenn } from "~/components/PlanDiagrams";

/**
 * 理念三图的 SSR 结构守卫（2026-09-23 立）。
 *
 * 钉的是一条**产品约束**：`/plan` 的 SEO 是刻意做到首屏 HTML 里的，
 * 所以服务端渲染出来的标记必须是**画好的图**——入场编排的闸门类
 * （`fp-reveal` / `is-play`）只能由 `ui/Reveal.tsx` 在客户端挂上。
 * 若哪天有人图省事把闸门写进 className，爬虫与无 JS 用户拿到的就是三张空图，
 * 而这一条在浏览器里**看不出来**（有 JS 的人永远看到动画那版）。
 *
 * 为什么能在这里渲染组件：`PlanDiagrams.tsx` 零 import 依赖（只引 domain 的几何），
 * 不碰 antd / canvas / window，node 环境毫秒级跑完——与 chart-theme 那条守卫同源。
 */
describe("理念三图 SSR 结构", () => {
  const vennA = renderToStaticMarkup(
    TriVenn({
      idPrefix: "plan-venn-variety",
      labels: ["宽基指数基金", "策略指数基金", "行业指数基金"],
      center: ["低估阶段", "投资价值较高"],
      ariaLabel: "定投品种的挑选",
    }),
  );
  const vennB = renderToStaticMarkup(
    TriVenn({
      idPrefix: "plan-venn-selection",
      variant: "line",
      labels: ["费率较低", "跟踪误差较小", "规模较大"],
      center: ["场外基金"],
      ariaLabel: "基金选择的三条件",
    }),
  );
  const curve = renderToStaticMarkup(MethodCurve());

  it("服务端产物里没有闸门类（爬虫/无 JS 看到的是画好的图）", () => {
    for (const svg of [vennA, vennB, curve]) {
      expect(svg).not.toMatch(/fp-reveal/);
      expect(svg).not.toMatch(/is-play/);
    }
  });

  it("动效类在标记里是齐的（它们只是标签，静态渲染不改外观）", () => {
    // 三片玻璃 + 棱镜三层组：入场/悬停/呼吸各挂一处，缺一个就少一层动效
    expect(vennA.match(/fp-fig-sheet/g)).toHaveLength(3);
    expect(vennA).toContain("fp-fig-lens-zoom");
    expect(vennA).toContain("animate-float");
    expect(vennA.match(/fp-fig-label/g)).toHaveLength(3);
    // 曲线：三条描线路径 + 四枚宝石 + 五枚胶囊
    expect(curve.match(/data-fp-draw/g)).toHaveLength(3);
    expect(curve.match(/fp-fig-gem/g)).toHaveLength(4);
    expect(curve.match(/fp-fig-late/g)).toBeTruthy();
  });

  it("两张 venn 的渐变 id 各自成前缀（同页 id 重名会让第二张引到第一张）", () => {
    expect(vennA).toContain("plan-venn-variety-fill");
    expect(vennB).toContain("plan-venn-selection-fill");
    expect(vennA).not.toContain("plan-venn-selection-");
  });

  it("不许出现 SVG 滤镜（宪法 §3：低端安卓与 workerd 都扛不住）", () => {
    for (const svg of [vennA, vennB, curve]) {
      expect(svg).not.toMatch(/<filter|feGaussianBlur|feDisplacementMap/);
    }
  });
});
