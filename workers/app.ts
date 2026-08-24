import { createContext, createRequestHandler, RouterContextProvider } from 'react-router';
import { getDb } from '../app/db/client';
import { scanDcaPlans } from '../app/services/dca-service';
import { settlePendingOrders, syncNav } from '../app/services/settle';
import { purgeExpiredSessions } from '../app/services/session';

/**
 * Cloudflare 运行时上下文键。React Router 8 的 loader/action 通过
 * context.get(cloudflareContext) 取到 env（D1/KV/环境变量）与 ctx。
 */
export const cloudflareContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();

// React Router 的 SSR 请求处理器，虚拟模块由 @react-router/dev 插件提供
const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

/** Cron 表达式 → 任务名，注释标注对应北京时间（UTC+8） */
const CRON_DCA_SCAN = '0 2 * * *'; // 北京 10:00
const CRON_SETTLE = '30 12 * * *'; // 北京 20:30

export default {
  /** HTTP 请求入口：把 Cloudflare env/ctx 注入 RouterContext，再交给 React Router */
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
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
      } catch (err) {
        console.error('[cron] 定投扫描异常：', err);
      }
      return;
    }

    if (controller.cron === CRON_SETTLE) {
      // 先同步净值，再撮合——顺序不能颠倒，否则撮合拿不到当日净值
      try {
        const s = await syncNav(db, env);
        console.log(`[cron] 净值同步完成：写入 ${s.synced} 条`);
      } catch (err) {
        console.error('[cron] 净值同步异常：', err);
      }

      try {
        const r = await settlePendingOrders(db, env, now);
        console.log(
          `[cron] 撮合完成：确认 ${r.confirmed}、顺延 ${r.skipped}、失败 ${r.failed}`,
        );
      } catch (err) {
        console.error('[cron] 撮合异常：', err);
      }

      // 顺手清理过期会话，避免 session 表无限增长
      try {
        await purgeExpiredSessions(db);
      } catch (err) {
        console.error('[cron] 清理过期会话异常：', err);
      }
      return;
    }

    console.warn(`[cron] 未识别的表达式：${controller.cron}`);
  },
} satisfies ExportedHandler<Env>;
