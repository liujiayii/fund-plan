import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

/**
 * UnoCSS 走 Vite 插件（unocss ≥ 66.10.2）。
 *
 * 历史：66.10.0 及更早在 RR8 的 Vite Environment API 下找不到
 * `vite:css-post`，产物 CSS 只剩 ~48 字节占位符（完整考证见
 * docs/development.md）。66.10.1/66.10.2 按环境 outDir 登记 css-post
 * 之后，本仓库 `react-router build` 已能吐出真工具类。
 *
 * ⚠️ `postcss: false` 必须保持。PostCSS 模式历史上会把构建挂死
 * （超过 7 分钟无响应），css-post 注入本身不依赖 PostCSS。
 */
export default defineConfig({
  plugins: [
    // 必须进插件链，virtual:uno.css 才有人生成；放 Cloudflare / RR 之前
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
  },
});
