/**
 * 匿名页边缘缓存的判定逻辑（纯函数，不依赖 Fetch API，与 visit.ts 同款手法）。
 *
 * 背景：/ 与 /master 对未登录访客渲染的内容与「具体哪个访客」无关
 * （me=null 的游客视角，页面数据全是主理人的公开盘 + 平台统计），
 * 可以整页缓存在入口机房的 Cache API 里——国内流量绕路入境时
 * （如联通 → 阿姆斯特丹），一次 SSR 的十几条跨洲 D1 查询全部省掉，
 * 游客首屏 TTFB 降到约等于单程 RTT。
 *
 * 缓存只对「无 session cookie」的请求生效：
 * 登录用户的页面是个性化的（me 有值），命中游客缓存等于内容错乱，绝不能发生。
 */

/** 允许整页缓存的匿名页路径（精确匹配，不带查询串） */
export const ANON_CACHEABLE_PATHS = new Set(["/", "/master"]);

/** fresh 窗口（秒）：窗口内的副本直接当命中用，统计数字最多迟这一会儿 */
export const ANON_CACHE_TTL_SEC = 60;

/**
 * stale 上限（秒）：超过 fresh 窗口但没超过它的副本走「先给旧页、后台刷新」
 * （stale-while-revalidate）。边缘缓存里存的副本 s-maxage 用这个值，到期淘汰。
 *
 * 为什么必须容忍 stale 而不是到期就回源：免费版 Worker 每请求只有 10ms CPU，
 * 本站 SSR bundle 很大，冷启动 isolate 上渲染本就偶发 1102（超 CPU）。
 * SSR 一旦挡在用户关键路径上，游客就会随机看到 Cloudflare 错误页；
 * 而旧页 + 后台刷新的组合里，1102 最多杀掉后台任务，用户永远拿到页面。
 */
export const ANON_CACHE_STALE_MAX_SEC = 60 * 60;

/** 判定输入：与 Fetch API 解耦的请求特征，便于单测 */
export interface AnonCacheRequestInfo {
  /** HTTP 方法，如 "GET" */
  method: string;
  /** URL pathname，如 "/" 或 "/master" */
  pathname: string;
  /** 查询串（含 ?）。非空一律不缓存：Cache API 按完整 URL 做键，带参页面多半也有个性内容 */
  search: string;
  /** 请求里是否带着 session cookie。只看存在性不校验有效性——宁可少缓存，不可错缓存 */
  hasSessionCookie: boolean;
}

/**
 * 判定该请求能否走匿名页缓存。
 * 四个条件全过才缓存：GET + 白名单路径 + 无查询串 + 无 session cookie。
 */
export function isAnonCacheablePage(r: AnonCacheRequestInfo): boolean {
  return (
    r.method === "GET"
    && r.search === ""
    && ANON_CACHEABLE_PATHS.has(r.pathname)
    && !r.hasSessionCookie
  );
}

/** 缓存副本的新鲜度判定结果 */
export type AnonCacheFreshness = "fresh" | "stale" | "expired";

/**
 * 按副本年龄决定怎么用：
 *  - fresh：直接命中，SSR 与 D1 查询全省
 *  - stale：立刻把旧页还给用户，同时后台重渲染覆盖缓存
 *  - expired：太老，视同没有缓存（正常情况下 cache API 已按 s-maxage 淘汰）
 */
export function anonCacheFreshness(ageSec: number): AnonCacheFreshness {
  if (ageSec <= ANON_CACHE_TTL_SEC)
    return "fresh";
  if (ageSec <= ANON_CACHE_STALE_MAX_SEC)
    return "stale";
  return "expired";
}
