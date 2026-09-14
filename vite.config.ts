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
    // ⚠️ 必须 "esbuild"：Vite 8 默认的 lightningcss 有同名属性级联去重 bug
    // （parcel-bundler/lightningcss#1327，open）——手写 -webkit-backdrop-filter
    // 时，排在它前面的无前缀 backdrop-filter 被当作级联冗余整个删掉（实测
    // 与 build target 无关：cssTarget 怎么设都删；css.lightningcss.targets
    // 旁路也被 vite 强制覆盖）。叠加「现代 Chromium 已移除 -webkit- 别名」，
    // 生产构建里全站玻璃模糊静默失效（2026-09-14 PR #90 实测：dev 磨砂、
    // build 半透明）。esbuild 只压缩+按 target 补前缀、从不删用户声明。
    // lightningcss 修复 #1327 发版后可切回，顺带源文件可去掉 -webkit- 行。
    cssMinify: "esbuild",
  },
});
