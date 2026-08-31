import { describe, expect, it } from "vitest";
import { isPageVisit, parseVisitorId, visitorCookie } from "~/domain/visit";

/** 浏览器页面导航请求的基线形态，各用例只改关心的字段 */
const NAV: Parameters<typeof isPageVisit>[0] = {
  method: "GET",
  secFetchDest: "document",
  accept: "text/html,application/xhtml+xml,...",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128",
};

describe("isPageVisit 访问人次判定", () => {
  it("浏览器页面导航请求计数", () => {
    expect(isPageVisit(NAV)).toBe(true);
  });

  it("loader / XHR 请求（sec-fetch-dest=empty）不计数", () => {
    expect(isPageVisit({ ...NAV, secFetchDest: "empty" })).toBe(false);
  });

  it("静态资源请求（script/style/image）不计数", () => {
    for (const dest of ["script", "style", "image", "font", "favicon"]) {
      expect(isPageVisit({ ...NAV, secFetchDest: dest })).toBe(false);
    }
  });

  it("非 GET 请求（下单/签到等 action）不计数", () => {
    expect(isPageVisit({ ...NAV, method: "POST" })).toBe(false);
  });

  it("老浏览器缺失 Sec-Fetch-Dest 时，Accept 含 text/html 仍判定为访问", () => {
    expect(isPageVisit({ ...NAV, secFetchDest: null })).toBe(true);
  });

  it("缺失 Sec-Fetch-Dest 且 Accept 是 JSON 的 API 请求不计数", () => {
    expect(
      isPageVisit({ ...NAV, secFetchDest: null, accept: "application/json" }),
    ).toBe(false);
  });

  it("爬虫与命令行工具的 UA 不计数", () => {
    const uas = [
      "Mozilla/5.0 (compatible; Baiduspider/2.0)",
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "curl/8.4.0",
      "Wget/1.21",
      "HeadlessChrome/128.0.0.0",
      "python-requests/2.31.0",
    ];
    for (const ua of uas) {
      expect(isPageVisit({ ...NAV, userAgent: ua })).toBe(false);
    }
  });

  it("UA 缺失（null）按普通访客计数，不因缺头而漏统计", () => {
    expect(isPageVisit({ ...NAV, userAgent: null })).toBe(true);
  });
});

describe("parseVisitorId 访客 Cookie 解析", () => {
  it("混在多个 cookie 里也能解出 fp_vid", () => {
    expect(
      parseVisitorId("session=abc; fp_vid=550e8400-e29b; theme=dark"),
    ).toBe("550e8400-e29b");
  });

  it("没有 fp_vid 时返回 null", () => {
    expect(parseVisitorId("session=abc; theme=dark")).toBeNull();
  });

  it("Cookie 头为 null / 空串返回 null", () => {
    expect(parseVisitorId(null)).toBeNull();
    expect(parseVisitorId("")).toBeNull();
  });

  it("空值 cookie（fp_vid=）视同没有，不算半个访客", () => {
    expect(parseVisitorId("fp_vid=")).toBeNull();
  });

  it("值里含等号也能完整解出（split('=') 只切第一刀）", () => {
    expect(parseVisitorId("fp_vid=a=b=c")).toBe("a=b=c");
  });
});

describe("visitorCookie 序列化", () => {
  it("属性齐全：HttpOnly / SameSite=Lax / Secure / Path / 1 年 Max-Age", () => {
    const c = visitorCookie("vid-123");
    expect(c).toContain("fp_vid=vid-123");
    expect(c).toContain("Path=/");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c).toContain("Max-Age=31536000");
  });
});
