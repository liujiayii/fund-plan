import type { Db } from "~/db/client";
import { and, eq, ne, sql } from "drizzle-orm";
import { fund } from "~/db/schema";

/** sitemap 里的一条基金页：代码 + 该基金最新净值日期（没有净值行为 null） */
export interface FundSitemapEntry {
  code: string;
  lastmod: string | null;
}

/**
 * sitemap 用的基金清单。
 *
 * 只收录库里已经落档的基金——详情页首次访问才会 ensureFund 写入，
 * 没人点过的代码进 sitemap 会 404，搜索引擎当死链。按代码升序方便 diff。
 *
 * lastmod 取每只基金自己的 max(nav_date)：那是这一页内容真正变动的时间
 * （每晚净值同步就变），比"这次生成 sitemap 的时间"诚实得多。用相关子查询
 * 而不是 join + group by——(fund_code, nav_date) 是 fund_nav 的主键，
 * 每只基金只走一次索引，且**总共一条 SQL**（D1 免费版每请求 50 条查询是硬顶，
 * 基金档案量级百～千，绝不能退化成 N+1）。同一手法见 latestNavMap。
 */
export async function listFundSitemapEntries(db: Db): Promise<FundSitemapEntry[]> {
  const rows = await db
    .select({
      code: fund.code,
      lastmod: sql<string | null>`(select max(n.nav_date) from fund_nav n where n.fund_code = ${fund.code})`,
    })
    .from(fund)
    .orderBy(fund.code);
  return rows.map(r => ({ code: r.code, lastmod: r.lastmod ?? null }));
}

/** 同类基金的轻量条目（内链用：只要代码与名字） */
export interface SiblingFund {
  code: string;
  name: string;
}

/**
 * 同类基金（同 fund.type、排除自己），给基金详情页做内链。
 *
 * 为什么在基金页放内链：爬虫顺着它走到其它基金页，比只靠 sitemap 发现更"自然"，
 * 也把相关性传过去（同类 = 同主题）。只取代码与名字，一条查询。
 *
 * type 为空（东财偶尔给空串）时返回空数组——内链要**相关**才有价值，
 * 凑一堆无关基金既误导用户也稀释页面的主题相关性。
 */
export async function listSiblingFunds(
  db: Db,
  input: { code: string; type: string; limit: number },
): Promise<SiblingFund[]> {
  if (!input.type || input.limit <= 0) {
    return [];
  }
  return db
    .select({ code: fund.code, name: fund.name })
    .from(fund)
    .where(and(eq(fund.type, input.type), ne(fund.code, input.code)))
    .orderBy(fund.code)
    .limit(input.limit);
}
