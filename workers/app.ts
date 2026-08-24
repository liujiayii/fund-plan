import { createRequestHandler } from 'react-router';

/**
 * 扩展 React Router 的 AppLoadContext，把 Cloudflare 运行时环境注入到
 * 所有 loader / action 里，这样应用层可以直接拿到 D1、KV 与环境变量。
 */
declare module 'react-router' {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

// React Router 的 SSR 请求处理器，虚拟模块由 @react-router/dev 插件提供
const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  /** HTTP 请求入口：全部交给 React Router 处理 */
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
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
