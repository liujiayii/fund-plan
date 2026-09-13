import { buildRobotsTxt } from "~/domain/seo";

/**
 * GET /robots.txt
 *
 * 资源路由：不走 Layout，直接吐纯文本。内容由 domain 纯函数生成，
 * 这里只负责 Content-Type 和缓存头。
 *
 * 缓存 1 天：内容几乎不变（域名 / 私页前缀改了才会动），
 * 给搜索引擎和 CDN 省回源。public 是因为这对所有访客都一样。
 */
export function loader() {
  return new Response(buildRobotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
