import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UnoCSS 接入方式守卫。
 *
 * 历史上 CLI 预生成是为了绕开 `unocss/vite` 在 RR8 Environment API 下
 * 找不到 `vite:css-post`、产物只剩 48 字节占位符的坑。66.10.2 修好后
 * 改走 Vite 插件；这组测试钉死接入方式，防止有人把 CLI 接回来、
 * 或者把 `virtual:uno.css` 又换成入库的 `uno.gen.css`。
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("UnoCSS Vite 插件接入守卫", () => {
  it("root.tsx 吃 virtual:uno.css，不再导入 CLI 产物 uno.gen.css", () => {
    const src = read("app/root.tsx");
    expect(src).toMatch(/import ["']virtual:uno\.css["']/);
    // 只禁 import 路径；注释里提旧文件名无害
    expect(src).not.toMatch(/import ["'][^"']*uno\.gen\.css["']/);
  });

  it("vite.config.ts 挂了 unocss/vite，并且关掉 PostCSS（历史上会把构建挂死）", () => {
    const src = read("vite.config.ts");
    expect(src).toMatch(/from ["']unocss\/vite["']/);
    expect(src).toMatch(/UnoCSS\s*\(/);
    expect(src).toMatch(/postcss:\s*false/);
  });

  it("dev / build 脚本不再前置 uno:build", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.dev).not.toContain("uno:build");
    expect(pkg.scripts.build).not.toContain("uno:build");
    expect(pkg.scripts).not.toHaveProperty("uno:build");
    expect(pkg.scripts).not.toHaveProperty("uno:watch");
  });

  it("app/uno.gen.css 已删除（不再入库预生成产物）", () => {
    expect(existsSync(path.join(ROOT, "app/uno.gen.css"))).toBe(false);
  });
});
