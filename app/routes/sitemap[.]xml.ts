import type { Route } from "./+types/sitemap[.]xml";
import { buildSitemapXml } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import { listFundCodes } from "~/services/seo-service";

/**
 * GET /sitemap.xml
 *
 * 静态公开页 + 库里已落档的基金详情。基金代码走一条聚合查询，
 * 条数与用户数无关（D1 免费版每请求 50 条查询硬顶，这里只用 1 条）。
 *
 * Cache-Control 1 小时：新基金被 ensureFund 写入后，最迟一小时进 sitemap。
 * 比 robots 短是因为基金清单会涨，robots 几乎永不改。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const codes = await listFundCodes(db);
  return new Response(buildSitemapXml(codes), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
