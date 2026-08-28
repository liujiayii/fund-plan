import { describe, expect, it } from "vitest";
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";

/**
 * 导航高亮 —— 顶栏 Menu 与移动端底部 TabBar 共用（spec §6.4）。
 *
 * 顺序陷阱是这里唯一要钉死的东西：NAV_ITEMS 里 /me/watchlist 必须排在
 * /me 之前，startsWith 会先命中前者。这个测试存在的意义就是
 * 「以后谁调顺序谁红」，而不是指望读代码的人记得那条注释。
 */
describe("resolveSelectedKey", () => {
  it("根路径命中「首页」", () => {
    expect(resolveSelectedKey("/", NAV_ITEMS)).toBe("/");
  });

  it("非根路径的精确前缀命中", () => {
    expect(resolveSelectedKey("/funds", NAV_ITEMS)).toBe("/funds");
    expect(resolveSelectedKey("/funds/000001", NAV_ITEMS)).toBe("/funds");
    expect(resolveSelectedKey("/master", NAV_ITEMS)).toBe("/master");
  });

  it("深层路径命中最近的导航前缀", () => {
    expect(resolveSelectedKey("/me/orders", NAV_ITEMS)).toBe("/me");
    expect(resolveSelectedKey("/me/holdings/000001", NAV_ITEMS)).toBe("/me");
  });

  it("自选页高亮「自选」而非「我的」—— 顺序陷阱", () => {
    // /me/watchlist 同时是 /me/watchlist 与 /me 的前缀，
    // startsWith 按数组顺序取首个命中，所以 watchlist 必须排在 me 前
    expect(resolveSelectedKey("/me/watchlist", NAV_ITEMS)).toBe("/me/watchlist");
  });

  it("NAV_ITEMS 里 /me/watchlist 排在 /me 之前 —— 调换顺序这个断言就红", () => {
    const watchlistIdx = NAV_ITEMS.findIndex(i => i.key === "/me/watchlist");
    const meIdx = NAV_ITEMS.findIndex(i => i.key === "/me");
    expect(watchlistIdx).toBeGreaterThan(-1);
    expect(meIdx).toBeGreaterThan(-1);
    expect(watchlistIdx).toBeLessThan(meIdx);
  });

  it("/leaderboard 命中「排行榜」导航项", () => {
    expect(resolveSelectedKey("/leaderboard", NAV_ITEMS)).toBe("/leaderboard");
  });

  it("不命中任何导航项时返回空串（不高亮）", () => {
    expect(resolveSelectedKey("/login", NAV_ITEMS)).toBe("");
    expect(resolveSelectedKey("/register", NAV_ITEMS)).toBe("");
    expect(resolveSelectedKey("/logout", NAV_ITEMS)).toBe("");
  });
});
