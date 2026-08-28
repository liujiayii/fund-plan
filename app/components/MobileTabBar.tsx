import type { ReactNode } from "react";
import {
  FundOutlined,
  HomeOutlined,
  StarOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useLocation } from "react-router";
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";

/**
 * 移动端底部导航栏（spec §6）。
 *
 * ⚠️ 只放 4 项：首页/基金/自选/我的。「主理人的盘」不进底栏 ——
 * 首页已有它的引流卡片入口，320px÷5=64px/格会挤到贴边（spec §6.1）。
 * NAV_ITEMS 里的 master 项由 TABS 显式挑选，顶栏仍消费完整 NAV_ITEMS。
 *
 * 手写 <nav> 而非 antd 组件：TabBar 只需要 4 个链接 + active 态，
 * antd 没有对应组件（TabBar/BottomNavigation 都不在 antd 里），
 * 这正是「零新增依赖」约束下的自然解（spec §12）。
 */
const TABS: { key: string; label: string; icon: ReactNode }[] = [
  { key: "/", label: "首页", icon: <HomeOutlined /> },
  { key: "/funds", label: "基金", icon: <FundOutlined /> },
  { key: "/me/watchlist", label: "自选", icon: <StarOutlined /> },
  { key: "/me", label: "我的", icon: <UserOutlined /> },
];

export function MobileTabBar() {
  const location = useLocation();
  const selectedKey = resolveSelectedKey(location.pathname, NAV_ITEMS);

  return (
    <nav className="fp-tabbar fp-mobile" aria-label="主导航">
      {TABS.map(t => (
        <a
          key={t.key}
          href={t.key}
          className={`fp-tabbar-item${selectedKey === t.key ? " active" : ""}`}
          aria-current={selectedKey === t.key ? "page" : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
