/**
 * 导航高亮 —— 顶栏 Menu 与移动端底部 TabBar 共用的纯函数（spec §6.4）。
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
  { key: "/funds", label: "基金" },
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];

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
