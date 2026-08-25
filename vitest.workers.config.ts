import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * 应用层集成测试配置：跑在真实 workerd 运行时里，用真实的 D1（miniflare 本地 SQLite）。
 * 与 vitest.config.ts（纯函数、node 环境）分开——workers pool 启动较慢，
 * 只有需要数据库/绑定的测试才值得付这个代价。
 *
 * 注意：@cloudflare/vitest-pool-workers 0.22 起 API 改为插件式的 cloudflareTest()，
 * 旧版的 defineWorkersConfig / "./config" 子路径导出已移除。
 */
const migrations = await readD1Migrations(path.join(import.meta.dirname, "drizzle"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        kvNamespaces: ["KV"],
        bindings: {
          // 测试里把 admin 固定成这个用户名，便于断言角色分配
          ADMIN_USERNAME: "testadmin",
          // setup-d1.ts 读取它来建表
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["tests/db/**/*.test.ts", "tests/services/**/*.test.ts"],
    setupFiles: ["./tests/setup-d1.ts"],
  },
});
