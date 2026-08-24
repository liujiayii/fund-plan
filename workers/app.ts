import { createContext, createRequestHandler, RouterContextProvider } from 'react-router';

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

export default {
  /** HTTP 请求入口：把 Cloudflare env/ctx 注入 RouterContext，再交给 React Router */
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },

  /**
   * Cron 定时任务入口。
   * 表达式一律写 UTC，对应北京时间（UTC+8）如下：
   *   "0 2 * * *"   → 北京 10:00：定投扫描，为到期计划生成 pending 申购单
   *   "30 12 * * *" → 北京 20:30：拉取当日净值并撮合所有 pending 订单
   * 具体任务在 Task 17 接线，这里先留出分派骨架。
   */
  async scheduled(controller, env, ctx) {
    console.log(`[cron] 触发：${controller.cron}`);
  },
} satisfies ExportedHandler<Env>;
