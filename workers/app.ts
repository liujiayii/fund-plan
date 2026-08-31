import { createContext, createRequestHandler, RouterContextProvider } from "react-router";
import { getDb } from "../app/db/client";
import {
  ANON_CACHE_STALE_MAX_SEC,
  ANON_CACHEABLE_PATHS,
  anonCacheFreshness,
  isAnonCacheablePage,
} from "../app/domain/anon-page-cache";
import { isPageVisit, parseVisitorId, visitorCookie } from "../app/domain/visit";
import { scanDcaPlans } from "../app/services/dca-service";
import { purgeExpiredSessions, readTokenFromRequest } from "../app/services/session";
import { settlePendingOrders, syncNav } from "../app/services/settle";
import { recordVisit } from "../app/services/stats-service";

/**
 * Cloudflare 运行时上下文键。React Router 8 的 loader/action 通过
 * context.get(CloudflareContext) 取到 env（D1/KV/环境变量）与 ctx。
 */
export const CloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();

// React Router 的 SSR 请求处理器，虚拟模块由 @react-router/dev 插件提供
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Cron 表达式 → 任务名，注释标注对应北京时间（UTC+8） */
const CRON_DCA_SCAN = "0 2 * * *"; // 北京 10:00
const CRON_SETTLE = "30 12 * * *"; // 北京 20:30

/**
 * 从 Request 抽出访问判定所需的方法与三个请求头，喂给纯函数 isPageVisit。
 * 抽取层留在这里、判定逻辑留在 domain——domain 保持零 Fetch API 依赖，单测不用模拟 Request。
 */
function extractVisitInfo(request: Request) {
  return {
    method: request.method,
    secFetchDest: request.headers.get("sec-fetch-dest"),
    accept: request.headers.get("accept"),
    userAgent: request.headers.get("user-agent"),
  };
}

/** 缓存副本里盖的写入时间戳头（epoch 秒），供 fresh/stale 判定 */
const CACHED_AT_HEADER = "x-fp-cached-at";

/**
 * 页面请求出站收尾：
 *  - 对浏览器永远 no-store——登录后立刻回首页不能看到游客版残影；
 *  - x-fp-cache 标注本请求走了哪条缓存路径，线上排障用。
 * SSR 返回的 Response headers 可能不可变，复制一份再追加；
 * body 是流，用 new Response(body, init) 原样转交不缓冲。
 */
function finalizePageResponse(
  response: Response,
  cacheState: "hit" | "stale" | "miss" | "bypass",
): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  // 时间戳是缓存内部记账用的，不外泄给浏览器
  headers.delete(CACHED_AT_HEADER);
  headers.set("x-fp-cache", cacheState);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 给响应补一个 Set-Cookie（新访客的 fp_vid）。同样要复制 headers 再追加 */
function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 把一份流式 SSR 响应写进边缘缓存：
 * 剥离 Set-Cookie（cookie 属于具体访客，绝不能随页缓存下发）、
 * 盖写入时间戳（供 stale 判定）、s-maxage 用 stale 上限（到期由 cache API 淘汰）。
 */
async function storeAnonCache(
  cache: Cache,
  cacheKey: Request,
  body: ReadableStream,
  response: Response,
): Promise<void> {
  const copy = new Response(body, {
    status: response.status,
    headers: new Headers(response.headers),
  });
  copy.headers.delete("Set-Cookie");
  copy.headers.set("Cache-Control", `public, s-maxage=${ANON_CACHE_STALE_MAX_SEC}`);
  copy.headers.set(CACHED_AT_HEADER, String(Math.floor(Date.now() / 1000)));
  await cache.put(cacheKey, copy);
}

/**
 * 后台重渲染匿名页并覆盖缓存（stale-while-revalidate 的 revalidate 半边）。
 * 合成一个干净的 GET：匿名缓存页本就无 session cookie，loader 的 me 恒为 null，
 * 产出与真实游客请求一致。它不重复计数访问——统计由触发它的那次真实请求负责。
 */
async function refreshAnonCache(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cache: Cache,
  cacheKey: Request,
): Promise<void> {
  const context = new RouterContextProvider();
  context.set(CloudflareContext, { env, ctx });
  const response = await requestHandler(
    new Request(request.url, { method: "GET", headers: { accept: "text/html" } }),
    context,
  );
  if (response.status === 200 && response.body) {
    await storeAnonCache(cache, cacheKey, response.body, response);
  }
}

/**
 * 匿名页请求处理（浏览器导航与裸 GET 共用）：`/` 与 `/master`（判定见
 * domain/anon-page-cache）走边缘缓存三段式：
 *   fresh（60s 内）→ 直接命中，SSR 与 D1 查询全省，TTFB ≈ 单程 RTT；
 *   stale（60s~1h）→ 立刻把旧页还给用户，后台重渲染覆盖缓存——
 *     SSR 永远不进用户的关键路径。这点对免费版至关重要：10ms CPU 上限下，
 *     大 SSR bundle 在冷启动 isolate 上渲染本就偶发 1102（超 CPU），
 *     挡在游客面前就是随机白屏报错；而在后台刷新里挂掉只是缓存继续旧，自愈；
 *   miss → SSR 照常，成功后 tee 一份写进缓存。
 * 裸 GET（curl / 监控 / 爬虫，如 17ce 的探测节点）也走这里：它们要的
 * HTML 与游客视角一模一样，走缓存还能避免多节点并发把实时 SSR（与 D1）压垮。
 */
async function serveAnonCached(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const cacheable = isAnonCacheablePage({
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    hasSessionCookie: readTokenFromRequest(request) !== "",
  });
  // caches.default 是 Cloudflare 扩展（Workers 运行时存在），但生成的
  // worker-configuration.d.ts 里 CacheStorage 是标准接口、没有这个属性，需断言
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  if (cacheable) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      // 时间戳缺失（异常/旧格式）按无穷大处理，视同没有缓存
      const cachedAt = Number(cached.headers.get(CACHED_AT_HEADER) ?? 0);
      const ageSec = cachedAt > 0
        ? Date.now() / 1000 - cachedAt
        : Number.POSITIVE_INFINITY;
      const freshness = anonCacheFreshness(ageSec);

      if (freshness === "fresh") {
        return finalizePageResponse(cached, "hit");
      }
      if (freshness === "stale") {
        // 先给旧页，再后台刷新；刷新失败缓存继续 stale，下个请求再试——自愈
        ctx.waitUntil(
          refreshAnonCache(request, env, ctx, cache, cacheKey).catch(err =>
            console.error("[cache] 匿名页后台刷新失败：", err)),
        );
        return finalizePageResponse(cached, "stale");
      }
      // expired：太老，落到下面按 miss 重新 SSR
    }
  }

  const context = new RouterContextProvider();
  context.set(CloudflareContext, { env, ctx });
  const response = await requestHandler(request, context);

  // 非 200（重定向/错误页）或不可缓存的请求：不写缓存，直接收尾
  if (!cacheable || response.status !== 200 || !response.body) {
    return finalizePageResponse(response, "bypass");
  }

  // 流式响应 tee 一支给缓存（cache.put 需要完整 body），一支照常还给客户端；
  // 对客户端的 no-store 在收尾统一设置
  const [forClient, forCache] = response.body.tee();
  ctx.waitUntil(
    storeAnonCache(cache, cacheKey, forCache, response).catch(err =>
      console.error("[cache] 匿名页写缓存失败：", err)),
  );

  return finalizePageResponse(
    new Response(forClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    "miss",
  );
}

export default {
  /** HTTP 请求入口：把 Cloudflare env/ctx 注入 RouterContext，再交给 React Router */
  async fetch(request, env, ctx) {
    // 访问人次/独立访客计数：浏览器页面导航（GET + HTML）才算一次，
    // loader/XHR/资源/爬虫全不算。放进 waitUntil 异步执行——
    // 统计挂了也绝不能拖垮页面响应
    const existingVid = parseVisitorId(request.headers.get("cookie"));
    if (isPageVisit(extractVisitInfo(request))) {
      // 老访客带着 fp_vid 来；新访客（无 cookie）现场生成随机 UUID，
      // 并在下面的响应头里下发——同一个人换设备/清 cookie 会被算作新访客（业界通行口径）
      const vid = existingVid ?? crypto.randomUUID();
      ctx.waitUntil(
        recordVisit(getDb(env.DB), vid).catch(err =>
          console.error("[stats] 访问计数失败：", err)),
      );

      const response = await serveAnonCached(request, env, ctx);
      // 新访客才需要下发 cookie（老访客 ID 没变，不重复 Set）
      return existingVid ? response : withCookie(response, visitorCookie(vid));
    }

    // 非页面导航的白名单 GET（curl / 监控 / 爬虫 / 17ce 探测节点）：
    // 匿名页同样走边缘缓存——它们要的 HTML 与游客视角一模一样，
    // 直连实时 SSR 会被多节点并发压垮 D1，探测结果也失真
    const url = new URL(request.url);
    if (request.method === "GET" && ANON_CACHEABLE_PATHS.has(url.pathname)) {
      return serveAnonCached(request, env, ctx);
    }

    const context = new RouterContextProvider();
    context.set(CloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },

  /**
   * Cron 定时任务入口。
   *
   *   "0 2 * * *"（北京 10:00）  → 定投扫描：为到期计划生成 pending 申购单
   *   "30 12 * * *"（北京 20:30）→ 净值同步 + T+1 撮合确认
   *
   * 每个任务独立 try/catch：一个挂了不能让整个 Cron 崩掉，
   * 否则另一个任务也跑不成。
   */
  async scheduled(controller, env, _ctx) {
    const db = getDb(env.DB);
    const now = new Date(controller.scheduledTime);
    console.log(`[cron] 触发：${controller.cron}`);

    if (controller.cron === CRON_DCA_SCAN) {
      try {
        const r = await scanDcaPlans(db, env, now);
        console.log(
          `[cron] 定投扫描完成：触发 ${r.triggered}、跳过 ${r.skipped}、失败 ${r.failed}`,
        );
      }
      catch (err) {
        console.error("[cron] 定投扫描异常：", err);
      }
      return;
    }

    if (controller.cron === CRON_SETTLE) {
      // 先同步净值，再撮合——顺序不能颠倒，否则撮合拿不到当日净值
      try {
        const s = await syncNav(db, env);
        console.log(`[cron] 净值同步完成：写入 ${s.synced} 条`);
      }
      catch (err) {
        console.error("[cron] 净值同步异常：", err);
      }

      try {
        const r = await settlePendingOrders(db, env, now);
        console.log(
          `[cron] 撮合完成：确认 ${r.confirmed}、顺延 ${r.skipped}、失败 ${r.failed}`,
        );
      }
      catch (err) {
        console.error("[cron] 撮合异常：", err);
      }

      // 顺手清理过期会话，避免 session 表无限增长
      try {
        await purgeExpiredSessions(db);
      }
      catch (err) {
        console.error("[cron] 清理过期会话异常：", err);
      }
      return;
    }

    console.warn(`[cron] 未识别的表达式：${controller.cron}`);
  },
} satisfies ExportedHandler<Env>;
