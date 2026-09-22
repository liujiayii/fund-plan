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
  // 低估定投计划紧跟主理人的盘：两者讲的是同一个人同一批单子（那页是全景、
  // 这页是每周一期的实盘复盘），读者看完一个自然想看另一个
  { key: "/plan", label: "低估定投计划" },
  { key: "/leaderboard", label: "排行榜" },
  { key: "/funds", label: "基金" },
  // 工具页也进侧栏：侧栏在每个页面都渲染，给它一个导航项等于给这一页全站内链
  // （SEO 上比只挂 sitemap 实在），顺带让用户找得到。底栏（MOBILE_TAB_KEYS）
  // 不放它——底栏只留四个高频入口
  { key: "/tools/fee-calculator", label: "费用计算器" },
  { key: "/tools/dca-backtest", label: "定投回测" },
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];

/**
 * 移动端底部胶囊 Tab 的四项（按显示顺序）。
 * ⚠️ 只放 4 项高频入口：首页/基金/自选/我的。全量导航在汉堡抽屉
 * （MobileNavDrawer，与桌面侧栏同构）；底栏是快捷层，不追求全量——
 * 「主理人的盘」「排行榜」这类低频项放抽屉，390px÷5=78px/格会挤到贴边。
 * 只存 key：图标是 UI 事，放 MobileTabBar；文案从 NAV_ITEMS 查，不重复一份。
 */
export const MOBILE_TAB_KEYS: readonly string[] = ["/", "/funds", "/me/watchlist", "/me"];

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
