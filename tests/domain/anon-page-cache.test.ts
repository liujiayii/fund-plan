import { describe, expect, it } from "vitest";
import { ANON_CACHEABLE_PATHS, isAnonCacheablePage } from "~/domain/anon-page-cache";

/**
 * 匿名页缓存判定的边界钉子：白名单路径、四条件缺一不可。
 * 判错「该缓存没缓存」只是慢；判错「不该缓存却缓存」是登录用户看到游客页，
 * 后者不可接受，所以用例往严的方向写。
 */

/** 快捷构造：默认一个「可缓存」的游客首页请求，测试里按需覆写单项 */
function info(overrides: Partial<Parameters<typeof isAnonCacheablePage>[0]> = {}) {
  return {
    method: "GET",
    pathname: "/",
    search: "",
    hasSessionCookie: false,
    ...overrides,
  };
}

describe("isAnonCacheablePage", () => {
  it("游客 GET / 与 /master 可缓存", () => {
    expect(isAnonCacheablePage(info())).toBe(true);
    expect(isAnonCacheablePage(info({ pathname: "/master" }))).toBe(true);
  });

  it("带 session cookie 一律旁路——登录用户页面个性化，命中缓存即内容错乱", () => {
    expect(isAnonCacheablePage(info({ hasSessionCookie: true }))).toBe(false);
    expect(isAnonCacheablePage(info({ pathname: "/master", hasSessionCookie: true }))).toBe(false);
  });

  it("非 GET、带查询串、白名单外的路径都不缓存", () => {
    expect(isAnonCacheablePage(info({ method: "HEAD" }))).toBe(false);
    expect(isAnonCacheablePage(info({ search: "?redirectTo=/me" }))).toBe(false);
    // /me、/login、排行榜等个性化或动态页不在白名单
    expect(isAnonCacheablePage(info({ pathname: "/me" }))).toBe(false);
    expect(isAnonCacheablePage(info({ pathname: "/leaderboard" }))).toBe(false);
    expect(isAnonCacheablePage(info({ pathname: "/funds/000001" }))).toBe(false);
  });

  it("白名单常量与判定一致：恰好只有 / 与 /master", () => {
    expect([...ANON_CACHEABLE_PATHS].sort()).toEqual(["/", "/master"]);
  });
});
