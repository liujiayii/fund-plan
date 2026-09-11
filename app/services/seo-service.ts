import type { Db } from "~/db/client";
import { fund } from "~/db/schema";

/**
 * sitemap 用的基金代码清单。
 *
 * 只收录库里已经落档的基金——详情页首次访问才会 ensureFund 写入，
 * 没人点过的代码进 sitemap 会 404，搜索引擎当死链。按代码升序方便 diff。
 *
 * ⚠️ 一条查询拿全表 code，不要 N+1。基金档案是全站共享、量级小（百～千），
 * 远不到 D1 单次读上限。
 */
export async function listFundCodes(db: Db): Promise<string[]> {
  const rows = await db
    .select({ code: fund.code })
    .from(fund)
    .orderBy(fund.code);
  return rows.map(r => r.code);
}
