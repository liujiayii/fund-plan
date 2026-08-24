import { defineConfig } from 'vitest/config';

/**
 * 领域层纯函数测试用普通 node 环境即可，跑得快。
 * 需要真实 D1 的应用层集成测试（Task 2 起）单独用 @cloudflare/vitest-pool-workers 配置，
 * 见 vitest.workers.config.ts。
 *
 * 路径别名 ~/ 由 Vite 8 原生的 resolve.tsconfigPaths 读取 tsconfig.json 解析，
 * 无需 vite-tsconfig-paths 插件。
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/domain/**/*.test.ts', 'tests/smoke.test.ts'],
  },
});
