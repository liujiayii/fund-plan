import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pageCacheControl } from "~/domain/page-cache-header";

/**
 * 页面响应 Cache-Control 的钉子。
 *
 * 背景（2026-09-17 收录问题排查）：全站页面曾一律发 `private, no-store`，
 * 连搜索引擎爬虫请求也一样。抓取工具（尤其百度）看到「不许存储」会把这页
 * 当不可留存内容处理；而本站最该被收录的恰恰是 `/` 与 `/master`。
 *
 * 同时钉住反向不变量：绝不能变成 `public` / 带 `s-maxage`——那会让共享缓存
 * （CDN）把游客版页面喂给登录用户，即「登录后回首页看到游客残影」。
 */

describe("pageCacheControl", () => {
  it("匿名请求（游客与爬虫）给「可存但每次校验」，不带 no-store", () => {
    const value = pageCacheControl(false);
    expect(value).toBe("private, no-cache");
    expect(value).not.toContain("no-store");
  });

  it("登录态页面内容个性化，一律不许任何缓存留存", () => {
    expect(pageCacheControl(true)).toBe("private, no-store");
  });

  it("两种取值都不许共享缓存落地（无 public / 无 s-maxage）", () => {
    for (const value of [pageCacheControl(true), pageCacheControl(false)]) {
      expect(value.startsWith("private")).toBe(true);
      expect(value).not.toContain("public");
      expect(value).not.toContain("s-maxage");
    }
  });
});

describe("workers 接线守卫", () => {
  /**
   * 页面响应头只能由 pageCacheControl 决定：workers/app.ts 里再出现字面量
   * `private, no-store` 就说明有人把策略抄回去了，绕过登录态判定。
   */
  it("workers/app.ts 的页面收尾走 pageCacheControl，不硬编码 no-store", () => {
    const src = readFileSync(
      path.resolve(import.meta.dirname, "../../workers/app.ts"),
      "utf8",
    );
    expect(src).toContain("pageCacheControl(");
    expect(src).not.toContain("\"private, no-store\"");
  });
});
