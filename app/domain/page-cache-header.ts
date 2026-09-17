/**
 * 页面响应对外的 Cache-Control 策略（纯函数，不依赖 Fetch / 运行环境）。
 *
 * 两档，取决于这次请求带不带 session cookie（即内容是否个性化）：
 *
 *  - 匿名（游客与搜索引擎爬虫同一份内容）→ `private, no-cache`：
 *    「可以存，但每次使用前必须回源校验」。爬虫视野里没有 `no-store`
 *    （「任何缓存都不许留」）这个负信号——2026-09-17 排查收录时发现，
 *    全站最该被收录的 `/` 与 `/master` 恰恰对爬虫发的是 `no-store`；
 *    对浏览器而言语义与 no-store 等价（本站 HTML 不发 ETag / 不处理
 *    If-Modified-Since，永远返回 200 全量，拿不到 304 就不会有旧页复用）。
 *
 *  - 登录态 → `private, no-store`：页面内容个性化（me 有值），
 *    任何缓存都不许落地，否则「登录后回首页看到游客版残影」。
 *
 * 两个取值都刻意只给 `private`，不给 `public` / `s-maxage`：
 * 一旦允许共享缓存落地，CDN 就可能把游客版页面发给登录用户（同上残影）。
 */
export function pageCacheControl(hasSessionCookie: boolean): string {
  return hasSessionCookie ? "private, no-store" : "private, no-cache";
}
