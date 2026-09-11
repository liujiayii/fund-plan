import { describe, expect, it } from "vitest";
import { shouldReportServerError } from "~/domain/server-error-report";

/**
 * 服务端错误该不该打进 Worker 日志。
 *
 * 线上 Cloudflare Observability 把 console.error 当 error 上报。
 * React Router 默认 handleError 会把「路径不存在」这种内部 404
 * （扫描器每天扫 /firebase-key.json、/wp-admin 等）也打成 error，
 * 把真故障淹没。本函数是 handleError 的判定内核。
 */

describe("shouldReportServerError", () => {
  it("请求已中止不报——React Router 中断的导航不是故障", () => {
    expect(shouldReportServerError({ aborted: true })).toBe(false);
    expect(shouldReportServerError({ aborted: true, routeStatus: 500 })).toBe(false);
  });

  it("未匹配路由的 404（扫描器探测）不报", () => {
    expect(shouldReportServerError({ aborted: false, routeStatus: 404 })).toBe(false);
  });

  it("其它 4xx 路由错误也不报——403/400 是预期响应，不是故障", () => {
    expect(shouldReportServerError({ aborted: false, routeStatus: 400 })).toBe(false);
    expect(shouldReportServerError({ aborted: false, routeStatus: 403 })).toBe(false);
    expect(shouldReportServerError({ aborted: false, routeStatus: 405 })).toBe(false);
  });

  it("5xx 路由错误要报", () => {
    expect(shouldReportServerError({ aborted: false, routeStatus: 500 })).toBe(true);
    expect(shouldReportServerError({ aborted: false, routeStatus: 502 })).toBe(true);
  });

  it("非路由错误（未知异常）要报", () => {
    expect(shouldReportServerError({ aborted: false })).toBe(true);
  });
});
