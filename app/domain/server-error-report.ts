/**
 * 服务端错误该不该打进 Worker 日志（纯函数，不依赖 Fetch / React Router）。
 *
 * 背景：React Router 默认 handleError 对所有捕获的错误 `console.error`。
 * Cloudflare Observability 把 console.error 当 error 上报。扫描器每天
 * 探测 /firebase-key.json、/wp-admin、/.env 这类不存在路径时，框架会抛
 * 内部 404（ErrorResponseImpl，status=404），于是 Observability 被噪声淹没。
 *
 * 判定口径：
 *  - 请求已中止（客户端取消 / 框架中断导航）→ 不报
 *  - 路由错误且 status < 500（404/403/400/405…）→ 不报，这是预期响应
 *  - 5xx 路由错误、以及非路由错误（未知异常）→ 报
 *
 * 入参与框架解耦：调用方从 isRouteErrorResponse / request.signal 抽出数字与布尔，
 * 本函数不 import react-router，领域层单测不用模拟 Request。
 */

export interface ServerErrorReportInfo {
  /** 请求是否已被中止（request.signal.aborted） */
  aborted: boolean;
  /**
   * 若错误是 React Router 的路由错误（isRouteErrorResponse），传入其 status。
   * 未知异常不传——按「要报」处理。
   */
  routeStatus?: number;
}

/**
 * 判定这次被框架捕获的错误该不该 `console.error`。
 * 返回 false 表示静音：页面仍按 ErrorBoundary 正常渲染 404，只是不污染日志。
 */
export function shouldReportServerError(info: ServerErrorReportInfo): boolean {
  // 中止的请求不是故障——客户端走了、框架中断了导航，再打 error 没人看
  if (info.aborted)
    return false;

  // 4xx 是预期响应（未匹配路由、鉴权拒绝、方法不允许），不是运行时故障
  if (info.routeStatus !== undefined && info.routeStatus < 500)
    return false;

  return true;
}
