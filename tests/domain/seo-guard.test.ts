import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SEO 结构守卫：私页必须 noindex、公开页必须走 pageMeta、
 * robots/sitemap 资源路由必须在。靠人眼 grep 迟早漏，钉进测试谁破谁红。
 */

const ROUTES_DIR = path.resolve(import.meta.dirname, "../../app/routes");

function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR).filter(n =>
    n.endsWith(".tsx") || n.endsWith(".ts"));
}

function readRoute(name: string): string {
  return readFileSync(path.join(ROUTES_DIR, name), "utf8");
}

describe("SEO 路由守卫", () => {
  it("robots.txt 与 sitemap.xml 资源路由在", () => {
    const names = routeFiles();
    expect(names).toEqual(expect.arrayContaining([
      "robots[.]txt.ts",
      "sitemap[.]xml.ts",
    ]));
  });

  it("有 meta 的 /me 与 /admin 页必须 pageMeta + index: false", () => {
    const privateFiles = routeFiles().filter(n =>
      /^(?:me\.|admin)/.test(n) && n.endsWith(".tsx"));
    expect(privateFiles.length).toBeGreaterThan(0);

    const offenders = privateFiles.filter((name) => {
      const src = readRoute(name);
      if (!src.includes("export function meta"))
        return false;
      return !src.includes("pageMeta(") || !src.includes("index: false");
    });
    expect(offenders).toEqual([]);
  });

  it("首页 hero 主标是真 h1（页面主题的第一信号）", () => {
    // 2026-09-17 实测：全站唯一 h1 只在错误边界里，首页主标是 h2、其余页是 h3。
    // 首页是全站唯一有机会排「模拟基金定投系统」这类品牌词的页，先给它真 h1。
    // 其余公开页仍是 antd Title level={3}（字号即 level，component 被内部覆盖，
    // 改成 h1 会连带字号漂移），属已知技术债，见 docs/seo.md。
    const src = readRoute("_index.tsx");
    expect(src).toMatch(/<h1[\s>]/);
  });

  it("公开页 meta 走 pageMeta，且不带 noindex", () => {
    const publicFiles = [
      "_index.tsx",
      "master.tsx",
      "leaderboard.tsx",
      "funds._index.tsx",
      "funds.$code.tsx",
      "tools.fee-calculator.tsx",
      "login.tsx",
      "register.tsx",
    ];
    for (const name of publicFiles) {
      const src = readRoute(name);
      expect(src, name).toContain("pageMeta(");
      expect(src, name).not.toContain("index: false");
    }
  });
});
