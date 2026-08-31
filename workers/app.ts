import { createContext, createRequestHandler, RouterContextProvider } from "react-router";
import { getDb } from "../app/db/client";
import { isPageVisit, parseVisitorId, visitorCookie } from "../app/domain/visit";
import { scanDcaPlans } from "../app/services/dca-service";
import { purgeExpiredSessions } from "../app/services/session";
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

      const context = new RouterContextProvider();
      context.set(CloudflareContext, { env, ctx });
      const response = await requestHandler(request, context);

      // 新访客才需要下发 cookie（老访客 ID 没变，不重复 Set）。
      // SSR 返回的 Response headers 可能不可变，复制一份再追加；
      // body 是流，用 new Response(body, init) 原样转交不缓冲
      if (!existingVid) {
        const headers = new Headers(response.headers);
        headers.append("Set-Cookie", visitorCookie(vid));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
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
