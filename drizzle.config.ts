import type { Config } from "drizzle-kit";

/**
 * drizzle-kit 配置：从 app/db/schema.ts 生成 SQLite 迁移到 drizzle/ 目录。
 * 生成后由 wrangler d1 migrations apply 应用到 D1（本地或线上）。
 */
export default {
  schema: "./app/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
