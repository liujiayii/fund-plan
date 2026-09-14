import type { ReactNode } from "react";
import type { NavItem } from "~/domain/nav";
import {
  CrownOutlined,
  DashboardOutlined,
  FundOutlined,
  HomeOutlined,
  StarOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Link } from "react-router";

/** 导航项图标：按 key 查，未登记的（将来新增项）退回用户图标 */
const NAV_ICON: Record<string, ReactNode> = {
  "/": <HomeOutlined />,
  "/master": <CrownOutlined />,
  "/leaderboard": <TrophyOutlined />,
  "/funds": <FundOutlined />,
  "/me/watchlist": <StarOutlined />,
  "/me": <UserOutlined />,
  "/admin": <DashboardOutlined />,
};

export interface NavLinksProps {
  /** 含运行时追加的 /admin 项（root.tsx 拼），顺序即 NAV_ITEMS 顺序 */
  navItems: readonly NavItem[];
  /** resolveSelectedKey 的结果；空串不高亮 */
  selectedKey: string;
  /**
   * 客户端导航（<Link>）点击后的回调——移动端抽屉靠它合上自己。
   * 原生 <a>（整页跳转）不调：页面重载抽屉自然消失。
   * 桌面侧栏不传。
   */
  onNavigate?: () => void;
}

/**
 * 全量导航列表（桌面侧栏与移动端导航抽屉共用）。
 *
 * 为什么抽出来：抽屉要复刻侧栏的导航区，逐字复制会重演 nav.ts 头注释里
 * 那次「两份独立漂移」——图标表、选中态、<a> 纪律任何一处各自演化都是坑。
 *
 * `/` 与 `/master` 两项必须原生 <a>：游客边缘缓存靠整页跳转命中（x-fp-cache），
 * 这是导航壳里唯一不许改的纪律（同 AppSidebar / MobileTabBar）。
 *
 * 文案挂 fp-sidebar-label：768–1079 图标轨下隐藏（responsive.css §10）。
 * 抽屉只在 <768 出现，该规则永不命中——挂上是为了两个宿主共用同一份
 * DOM 结构，不为抽屉单独分叉。
 *
 * 选中态是玻璃内井 + 主色字（bg-well text-primary），不整行实色填充；
 * 手写 <a> 没有默认焦点环可依赖，focus-visible 环必须自己给（宪法 §2.4）。
 */
export function NavLinks({ navItems, selectedKey, onNavigate }: NavLinksProps) {
  return (
    <>
      {navItems.map((item) => {
        const active = selectedKey === item.key;
        // 条件类互斥：选中带全自己的 bg/text，未选中带 hover
        const tone = active ? "bg-well text-primary" : "text-muted hover:bg-well hover:text-ink";
        const cls = `flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm no-underline transition-colors duration-[150ms] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${tone}`;
        const body = (
          <>
            <span className="text-lg leading-none">{NAV_ICON[item.key] ?? <UserOutlined />}</span>
            <span className="fp-sidebar-label">{item.label}</span>
          </>
        );
        return item.key === "/" || item.key === "/master"
          ? (
              <a key={item.key} href={item.key} className={cls} title={item.label} aria-current={active ? "page" : undefined}>
                {body}
              </a>
            )
          : (
              <Link key={item.key} to={item.key} className={cls} title={item.label} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {body}
              </Link>
            );
      })}
    </>
  );
}
