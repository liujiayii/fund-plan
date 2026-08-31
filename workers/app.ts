import { createContext, createRequestHandler, RouterContextProvider } from "react-router";
import { getDb } from "../app/db/client";
import { ANON_CACHE_TTL_SEC, isAnonCacheablePage } from "../app/domain/anon-page-cache";
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

/**
 * 页面请求出站收尾：
 *  - 对浏览器永远 no-store——登录后立刻回首页不能看到游客版残影；
 *  - 新访客补发 fp_vid（老访客 ID 没变，不重复 Set）；
 *  - x-fp-cache 标注本请求走了哪条缓存路径，线上排障用。
 * SSR 返回的 Response headers 可能不可变，复制一份再追加；
 * body 是流，用 new Response(body, init) 原样转交不缓冲。
 */
function finalizePageResponse(
  response: Response,
  cacheState: "hit" | "miss" | "bypass",
  existingVid: string | null,
  vid: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("x-fp-cache", cacheState);
  if (!existingVid) {
    headers.append("Set-Cookie", visitorCookie(vid));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 页面请求处理：匿名页（/ 与 /master 的游客视角，判定见 domain/anon-page-cache）
 * 先查入口机房的 Cache API，命中直接返回——SSR 与全部 D1 查询都省掉，
 * 绕路入境的国内游客 TTFB 从数秒降到约等于单程 RTT。
 * 未命中照常 SSR，并把 200 的流式响应 tee 一份写进缓存（60s，副本剥离 Set-Cookie）。
 * 命中与否都会照常计数访问统计、给新访客补发 fp_vid——被缓存的只有 HTML 本体。
 */
async function servePage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  vid: string,
  existingVid: string | null,
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
      // 缓存副本写入时已剥离 Set-Cookie，新访客的 fp_vid 在收尾时补发
      return finalizePageResponse(cached, "hit", existingVid, vid);
    }
  }

  const context = new RouterContextProvider();
  context.set(CloudflareContext, { env, ctx });
  const response = await requestHandler(request, context);

  // 非 200（重定向/错误页）或不可缓存的请求：不写缓存，直接收尾
  if (!cacheable || response.status !== 200 || !response.body) {
    return finalizePageResponse(response, "bypass", existingVid, vid);
  }

  // 流式响应 tee 一支给缓存（cache.put 需要完整 body），一支照常还给客户端。
  // 存档副本显式带 s-maxage 控制边缘侧 TTL；对客户端的 no-store 在收尾统一设置
  const [forClient, forCache] = response.body.tee();
  ctx.waitUntil(
    (async () => {
      const copy = new Response(forCache, {
        status: response.status,
        headers: new Headers(response.headers),
      });
      copy.headers.delete("Set-Cookie");
      copy.headers.set("Cache-Control", `public, s-maxage=${ANON_CACHE_TTL_SEC}`);
      await cache.put(cacheKey, copy);
    })().catch(err => console.error("[cache] 匿名页写缓存失败：", err)),
  );

  return finalizePageResponse(
    new Response(forClient, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    "miss",
    existingVid,
    vid,
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

      return servePage(request, env, ctx, vid, existingVid);
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
