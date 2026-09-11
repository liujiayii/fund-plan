import type { NavItem } from "~/domain/nav";
import {
  CrownOutlined,
  DashboardOutlined,
  LoginOutlined,
  LogoutOutlined,
  MoreOutlined,
  SettingOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { Dropdown } from "antd";
import { useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { NavButton } from "~/components/ui/NavButton";
import { moreMenuItems, resolveSelectedKey } from "~/domain/nav";

export interface MobileBrandBarProps {
  /** 含运行时追加的 /admin 项（root.tsx 拼），顺序即 NAV_ITEMS 顺序 */
  navItems: readonly NavItem[];
  user: { username: string; role: string } | null;
}

/** 更多菜单里页面项的图标（与桌面侧栏 NAV_ICON 同款，key 查表） */
const MORE_ICON: Record<string, React.ReactNode> = {
  "/master": <CrownOutlined />,
  "/leaderboard": <TrophyOutlined />,
  "/admin": <DashboardOutlined />,
};

/**
 * 移动端顶部品牌胶囊（spec §4.3）：Logo + 站名 + 右端唯一入口「更多」。
 * 高 48，玻璃；768px+ 由 .fp-mobile 隐藏（侧栏接管品牌与登录态）。
 * sticky 钉顶：内容从胶囊底下穿过去，玻璃才「看得见」。
 *
 * 2026-09-11 起右端只有一个「更多」圆钮（替代原先的 UserMenu compact）：
 * 页面导航（主理人的盘/排行榜/管理）+ 设置/登出全收进这一个菜单——
 * 顶栏不再并排两个圆形入口，视觉密度问题随之消失。
 * 游客的登录入口在菜单里，注册按钮因是转化关键路径仍常显在胶囊上。
 * 桌面侧栏底部的 UserMenu 完整形态不受影响。
 */
export function MobileBrandBar({ navItems, user }: MobileBrandBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const logoutFormRef = useRef<HTMLFormElement>(null);
  const selectedKey = resolveSelectedKey(location.pathname, navItems);

  // 底栏四项之外的导航（nav.ts 派生，与桌面侧栏同源不漂移）
  const moreItems = moreMenuItems(navItems);

  // antd 菜单：登录态首行（非交互）→ 页面项（当前页高亮走 selectedKeys）
  // → 分隔线 → 设置/登出（或登录）
  const menuItems = [
    // 已登录：首行头像 + 用户名 + 身份后缀（disabled 占位行，只做信息展示）
    ...(user
      ? [{
          key: "whoami",
          disabled: true,
          label: (
            <span className="font-medium">
              {user.username}
              {user.role === "admin" ? "（主理人）" : ""}
            </span>
          ),
        }]
      : []),
    ...moreItems.map(i => ({
      key: i.key,
      icon: MORE_ICON[i.key],
      label: <Link to={i.key}>{i.label}</Link>,
    })),
    { type: "divider" as const },
    ...(user
      ? [
          {
            key: "settings",
            icon: <SettingOutlined />,
            label: "设置",
            onClick: () => navigate("/me/settings"),
          },
          {
            key: "logout",
            icon: <LogoutOutlined />,
            label: "登出",
            onClick: () => logoutFormRef.current?.requestSubmit(),
          },
        ]
      : [
          {
            key: "login",
            icon: <LoginOutlined />,
            label: "登录",
            onClick: () => navigate("/login"),
          },
        ]),
  ];

  return (
    <header className="fp-brandbar fp-mobile fp-glass sticky top-2 z-20 mx-3 mb-3 flex h-12 items-center justify-between rounded-full px-4">
      <a href="/" className="flex items-center gap-2 font-bold text-ink no-underline">
        <Logo size={24} />
        模拟基金
      </a>

      <div className="flex items-center gap-2">
        {/* 游客常显注册（转化关键路径）；登录用户头像信息在菜单里足够 */}
        {!user && <NavButton size="small" type="primary" to="/register">注册</NavButton>}
        {/* trigger 显式 click：触屏设备 hover 语义不存在（同 UserMenu 的定案）。
            selectedKeys 让当前页对应的导航项高亮（antd 自带选中态，
            比自定义类稳）——缓解排行榜等页面「不知道自己在哪」的迷路感 */}
        <Dropdown
          placement="bottomRight"
          trigger={["click"]}
          menu={{ items: menuItems, selectedKeys: selectedKey ? [selectedKey] : [] }}
        >
          <button
            type="button"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="更多菜单"
          >
            <MoreOutlined className="text-lg leading-none" />
          </button>
        </Dropdown>
      </div>

      {/* 登出表单：视觉隐藏，仅供菜单项触发 submit（服务端清 session + 重定向） */}
      <form ref={logoutFormRef} method="post" action="/logout" className="hidden" />
    </header>
  );
}
