import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

/**
 * 由 D1 绑定构造 Drizzle 实例。
 * 在 loader / action 里这样用：
 *   const db = getDb(context.cloudflare.env.DB)
 *
 * 注意：D1 不支持交互式事务，多表写入必须用 db.batch([...]) 一次原子提交。
 */
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof getDb>;
