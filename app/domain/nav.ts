/**
 * 导航高亮 —— 桌面侧栏与移动端底部胶囊 Tab 共用的纯函数（spec §6.4）。
 *
 * 为什么放 domain：两处消费同一份逻辑，逐字复制会重演
 * PortfolioView/me._index 那次「两份独立漂移」（期十三收掉的坑）。
 * 抽成纯函数才能 node 单测 + 把顺序陷阱钉进测试。
 *
 * ⚠️ NAV_ITEMS 的顺序是接口的一部分：/me/watchlist 必须排在 /me 之前 ——
 * startsWith 按数组顺序取首个命中，调换会让自选页高亮成「我的」。
 * tests/domain/nav.test.ts 钉着这条，谁调谁红。
 */

export interface NavItem {
  /** 路由前缀，如 /me */
  key: string;
  /** 展示文案 */
  label: string;
}

/** 一级导航项。⚠️ 顺序敏感，见文件头注释 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "/", label: "首页" },
  { key: "/master", label: "主理人的盘" },
  { key: "/leaderboard", label: "排行榜" },
  { key: "/funds", label: "基金" },
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];

/**
 * 移动端底部胶囊 Tab 的四项（按显示顺序）。
 * ⚠️ 只放 4 项：首页/基金/自选/我的。「主理人的盘」与「排行榜」不进底栏——
 * 首页已有两者的引流入口，390px÷5=78px/格会挤到贴边。
 * 只存 key：图标是 UI 事，放 MobileTabBar；文案从 NAV_ITEMS 查，不重复一份。
 */
export const MOBILE_TAB_KEYS: readonly string[] = ["/", "/funds", "/me/watchlist", "/me"];

/**
 * 移动端「更多」菜单项：从 navItems（含 root.tsx 运行时追加的 /admin）里
 * 筛掉底栏四项，剩下的就是「只在更多菜单出现」的导航。
 *
 * 2026-09-11 起移动端顶部品牌胶囊右端只放一个「更多」圆钮，页面导航
 * （主理人的盘/排行榜/管理）全走这里——与底栏同源于 NAV_ITEMS，
 * 以后加新导航项两边自动同步，不会出现第二份漂移的导航源。
 * 顺序：保持传入数组的原顺序（与桌面侧栏一致），不重排。
 */
export function moreMenuItems(
  navItems: readonly NavItem[],
): NavItem[] {
  const tabKeys = new Set(MOBILE_TAB_KEYS);
  return navItems.filter(i => !tabKeys.has(i.key));
}

/**
 * 由 pathname 解析当前高亮的导航 key。
 * 规则：非根项按 startsWith 取数组顺序首个命中；全是前缀不命中时，
 * 根路径("/") 命中「首页」，否则返回空串（不高亮）。
 */
export function resolveSelectedKey(
  pathname: string,
  items: readonly NavItem[],
): string {
  return (
    items
      .filter(i => i.key !== "/" && pathname.startsWith(i.key))
      .map(i => i.key)
      .at(0) ?? (pathname === "/" ? "/" : "")
  );
}
