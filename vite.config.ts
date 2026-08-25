import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

/**
 * 注意：UnoCSS 走 PostCSS 模式（见 postcss.config.mjs + app/app.css），
 * 没有用 unocss/vite 插件。
 * 原因：UnoCSS 66 的 Vite 插件依赖 `vite:css-post` 内部插件，
 * 而 Vite 8 换了 Rolldown 内核后该插件不存在，导致样式静默不生成
 * （构建能过、只警告，但产出的 CSS 里只有一个占位符，所有工具类都丢失）。
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
  // antd 体积较大，交给 Vite 自动分包即可，这里只关掉 sourcemap 以加快构建
  build: {
    sourcemap: false,
  },
});
