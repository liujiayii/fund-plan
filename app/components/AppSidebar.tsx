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
import { Logo } from "~/components/ui/Logo";
import { UserMenu } from "~/components/ui/UserMenu";

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

export interface AppSidebarProps {
  /** 含运行时追加的 /admin 项（root.tsx 拼），顺序即 NAV_ITEMS 顺序 */
  navItems: readonly NavItem[];
  /** resolveSelectedKey 的结果；空串不高亮 */
  selectedKey: string;
  user: { username: string; role: string } | null;
}

/**
 * 桌面 / 平板玻璃侧栏轨（spec §4.1 / §4.2，宪法层级 3 的铬）。
 *
 * 三档由 responsive.css 管：<768 整体隐藏（.fp-desktop）、768–1079 收成 72px
 * 图标轨（.fp-sidebar-label 隐藏 + title 提示）、≥1080 220px 全宽。
 * sticky + 视口高：轨随页面滚动钉在左侧，内容从它底下穿过去才算「看得见玻璃」。
 *
 * `/` 与 `/master` 两项继续原生 <a>：游客边缘缓存靠整页跳转命中（x-fp-cache）；
 * 其余 <Link>。这是导航壳里唯一不许改的纪律。
 *
 * 选中态是玻璃内井 + 主色字（bg-well text-primary），不整行实色填充；
 * 手写 <a> 没有默认焦点环可依赖，focus-visible 环必须自己给（宪法 §2.4）。
 */
export function AppSidebar({ navItems, selectedKey, user }: AppSidebarProps) {
  return (
    <aside
      className="fp-sidebar fp-desktop fp-glass fp-glass-specular sticky top-3 m-3 hidden h-[calc(100vh-24px)] w-[220px] shrink-0 flex-col rounded-[24px] p-3 md:flex"
      aria-label="主导航"
    >
      {/* 品牌：Logo + 站名（图标轨下站名隐藏） */}
      <a href="/" className="mb-4 flex items-center gap-2 px-2 py-1 font-bold text-ink no-underline">
        <Logo size={28} />
        <span className="fp-sidebar-label whitespace-nowrap">模拟基金</span>
      </a>

      <nav className="flex flex-1 flex-col gap-1">
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
                <Link key={item.key} to={item.key} className={cls} title={item.label} aria-current={active ? "page" : undefined}>
                  {body}
                </Link>
              );
        })}
      </nav>

      {/* 底：登录态（游客 = 登录/注册） */}
      <div className="mt-2 border-t border-line pt-3 [border-top-style:solid]">
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
