import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/**
 * 注意：UnoCSS 走 CLI 预生成（`pnpm uno:build` → `app/uno.gen.css`，由 root.tsx 导入），
 * 没有用 unocss/vite 插件。
 * 原因：**不是 Vite 8 的问题**（裸 Vite 8 + unocss/vite 实测正常），
 * 而是 UnoCSS 的 Vite 插件与 React Router 8 的 Vite Environment API 不兼容——
 * RR8 把构建拆成 client/ssr 多环境，UnoCSS 找不到 `vite:css-post` 来注入样式，
 * 于是产物 CSS 只剩 48 字节占位符，所有工具类静默丢失（构建只报一行警告就"成功"）。
 * 纯 SPA 项目（单环境构建）不受影响，可正常用 unocss/vite 插件。
 */
export default defineConfig({
  plugins: [
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
  },
});
