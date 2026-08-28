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

/** db.batch 要求「至少一条」的元组类型 */
type BatchWrites = Parameters<Db["batch"]>[0];

/**
 * 安全地执行一组写操作：空数组直接跳过，
 * 非空时收窄成 batch 需要的非空元组类型。
 *
 * 超过 100 条自动分块多次 batch——D1 单个 batch 塞几百条语句
 * （净值回填 400 条）容易撞语句数/参数量上限，分块后每批独立原子提交。
 * 住在 db 层是因为消费方不止 settle（cron 撮合）——
 * 路由 loader 的大批量回填同样需要「空数组安全 + 元组收窄 + 分块」。
 */
export async function runBatch(db: Db, writes: unknown[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK);

    await db.batch(chunk as unknown as BatchWrites);
  }
}
