import type { AppLoadContext, EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { renderToReadableStream } from 'react-dom/server';
import { createCache, extractStyle, StyleProvider } from '@ant-design/cssinjs';

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
  _loadContext: AppLoadContext,
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
        console.error('[ssr] 渲染出错：', error);
      },
    },
  );

  // 等整棵树渲染完毕，样式才收集完整（本项目不用 Suspense 流式分块，无损体验）
  await stream.allReady;

  let html = await new Response(stream).text();

  // extractStyle 不传第二参时，返回的是已经带 <style> 标签的完整字符串
  const styleTags = extractStyle(cache);
  html = html.replace('</head>', `${styleTags}</head>`);

  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(html, {
    headers: responseHeaders,
    status: statusCode,
  });
}
