import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * 每个测试 worker 启动前，把 drizzle 生成的迁移应用到内存 D1，
 * 这样测试用的是和生产完全一致的表结构。
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
