import antfu from "@antfu/eslint-config";

/**
 * ESLint 配置，基于 @antfu/eslint-config。
 *
 * 与本项目已有代码风格的取舍说明：
 *  - 保留单引号 + 分号（现有代码全是这个风格，改动会产生巨量无意义 diff）
 *  - 关掉 antfu 默认的 no-console：Worker 里 console.log/error 是唯一的日志手段
 *  - 放开 react-refresh 限制：路由模块必须同时导出 loader/action 与组件
 */
export default antfu(
  {
    type: "app",
    react: true,
    typescript: true,
    // 项目里没有 vue/svelte，显式关掉省得扫描
    vue: false,
    // 格式化交给 ESLint 自己（不引入 prettier，少一层工具链）
    formatters: {
      css: true,
      html: true,
      markdown: true,
    },
    stylistic: {
      indent: 2,
      quotes: "double",
      semi: true,
    },
    ignores: [
      "build/**",
      ".wrangler/**",
      ".react-router/**",
      "drizzle/**",
      "worker-configuration.d.ts",
      "pnpm-lock.yaml",
      "uno.config.ts.timestamp-*",
      // 文档里的代码块是讲解用的片段，不是可运行代码，
      // 不该按生产代码的规则检查（会因为「一行多语句」之类报错）
      "docs/**/*.md",
      // SDD 工作区（.superpowers/sdd/**）是本次重构的计划简报与实施报告，
      // 已被 git ignore；里面的代码块同样是讲解用片段，不是可运行代码。
      // 不豁免则 markdown formatter 会报数百个错，把真实的 lint 失败淹没。
      ".superpowers/**",
      // UnoCSS CLI 生成的产物，改它没意义（下次生成就被覆盖）
      "app/uno.gen.css",
    ],
  },
  {
    rules: {
      // Worker 环境里 console 就是日志系统，撮合/Cron 的排查全靠它
      "no-console": "off",

      // React Router 的路由模块必须同时导出 loader/action/meta 与默认组件，
      // 这是框架约定，不是坏味道
      "react-refresh/only-export-components": "off",

      // 领域层大量使用 interface 描述入参出参，不强制 type
      "ts/consistent-type-definitions": "off",

      // 允许 process.env 之类的 node 全局（构建脚本里会用）
      "node/prefer-global/process": "off",

      // antd 的组件 props 顺序不做强制排序
      "perfectionist/sort-objects": "off",
    },
  },
  {
    // 测试文件放宽一些：允许非空断言（大量 findFirst 后直接取值）
    files: ["tests/**/*.ts"],
    rules: {
      "ts/no-non-null-assertion": "off",
      "test/prefer-lowercase-title": "off",
    },
  },
);
