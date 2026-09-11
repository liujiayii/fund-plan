import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router";
import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { renderToReadableStream } from "react-dom/server";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import { shouldReportServerError } from "~/domain/server-error-report";

/**
 * SSR 入口。关键点：用 @ant-design/cssinjs 的 StyleProvider 收集 antd 运行时样式，
 * 渲染后把样式标签注入 </head> 之前，避免首屏无样式闪烁（FOUC）。
 *
 * 注意：这里必须等 stream.allReady 再提取样式——只有整棵树渲染完，
 * cache 里才收集齐所有组件用到的 CSS 规则。
 */
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  let statusCode = responseStatusCode;

  // antd 样式缓存：本次请求内收集所有用到的 CSS-in-JS 规则
  const cache = createCache();

  const stream = await renderToReadableStream(
    <StyleProvider cache={cache}>
      <ServerRouter context={routerContext} url={request.url} />
    </StyleProvider>,
    {
      signal: request.signal,
      onError(error: unknown) {
        statusCode = 500;
        console.error("[ssr] 渲染出错：", error);
      },
    },
  );

  // 等整棵树渲染完毕，样式才收集完整（本项目不用 Suspense 流式分块，无损体验）
  await stream.allReady;

  let html = await new Response(stream).text();

  // extractStyle 不传第二参时，返回的是已经带 <style> 标签的完整字符串
  const styleTags = extractStyle(cache);
  html = html.replace("</head>", `${styleTags}</head>`);

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, {
    headers: responseHeaders,
    status: statusCode,
  });
}

/**
 * 覆盖 React Router 默认 handleError。
 *
 * 默认实现把所有捕获的错误（含内部 404）都 console.error；Cloudflare
 * Observability 把 console.error 当 error 上报。扫描器每天扫
 * /firebase-key.json、/wp-admin 这类不存在路径，就会把线上错误面板刷满。
 *
 * 4xx / 中止请求静音（页面仍走 ErrorBoundary 正常渲染 404）；
 * 5xx 与未知异常照常打 error，真故障不能被盖住。
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  const routeStatus = isRouteErrorResponse(error) ? error.status : undefined;
  if (!shouldReportServerError({ aborted: request.signal.aborted, routeStatus }))
    return;

  // 4xx 已被上面滤掉，能走到这里的是 5xx 或未知异常——原样打进日志
  console.error(error);
};
