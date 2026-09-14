import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

/**
 * UnoCSS 走 Vite 插件。`postcss: false` 必须保持——PostCSS 模式历史上
 * 会把本仓库的 RR8 多环境构建挂死（>7 分钟无响应）。
 */
export default defineConfig({
  plugins: [
    // virtual:uno.css 的生成方，放 Cloudflare / RR 之前
    UnoCSS({ postcss: false }),
    // Cloudflare 插件：让 dev/build 跑在真实 workerd 运行时里，绑定 D1/KV 可直接用
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    // React Router framework mode：文件路由 + SSR
    reactRouter(),
  ],
  resolve: {
    // 读 tsconfig.json 的 paths 解析 ~/ 别名。
    // 必须显式开启——否则 workerd 运行时里 import '~/db/schema' 会找不到模块，
    // 而构建阶段却不报错（只在运行时炸），非常隐蔽。
    tsconfigPaths: true,
  },
  server: {
    // 钉死 5173：strictPort 让端口被占时直接报错退出，绝不偷偷跳到 5174/5175。
    // 这样 curl 本地 cron、Local Explorer API 的端口写死 5173 才永远靠谱。
    port: 5173,
    strictPort: true,
  },
  // antd 体积较大，交给 Vite 自动分包即可，这里只关掉 sourcemap 以加快构建
  build: {
    sourcemap: false,
    // ⚠️ 必须 "esbuild"：Vite 8 默认的 lightningcss 会按 build target（含
    // Safari 16）把无前缀 backdrop-filter 判为「无 target 支持」而整个删掉、
    // 只留 -webkit- 前缀版；而现代 Chromium 已移除 -webkit-backdrop-filter
    // 别名——两者叠加 = 生产构建里全站玻璃模糊（liquid-glass 的灵魂）静默
    // 失效（2026-09-14 PR #90 预览与 dev 对比实测：dev 磨砂、build 半透明）。
    // esbuild 只按 target 补前缀、不删标准声明，双声明共存。
    cssMinify: "esbuild",
  },
});
