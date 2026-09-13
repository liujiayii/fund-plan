import type { NavItem } from "~/domain/nav";
import {
  CrownOutlined,
  DashboardOutlined,
  MoreOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { Dropdown } from "antd";
import { Link, useLocation } from "react-router";
import { Logo } from "~/components/ui/Logo";
import { UserMenu } from "~/components/ui/UserMenu";
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
 * 移动端顶部品牌胶囊（spec §4.3）：Logo + 站名 + 右端两个固定锚点。
 * 高 48，玻璃；768px+ 由 .fp-mobile 隐藏（侧栏接管品牌与登录态）。
 * sticky 钉顶：内容从胶囊底下穿过去，玻璃才「看得见」。
 *
 * 右端语义（2026-09-11 定稿，主人裁决方案 B）：
 *   账户位——游客常显「登录」小胶囊，登录后变身头像（点头像弹设置/登出）；
 *   更多位——恒定「···」圆钮，纯页面导航（主理人的盘/排行榜/管理）。
 * 两态视觉同构（各占一个元素位），账户语义集中在账户位，注册走登录页
 * 的既有链路（登录页自带「去注册」），转化不依赖顶栏常驻。
 * 桌面侧栏底部的 UserMenu 完整形态不受影响。
 */
export function MobileBrandBar({ navItems, user }: MobileBrandBarProps) {
  const location = useLocation();
  const selectedKey = resolveSelectedKey(location.pathname, navItems);

  // 底栏四项之外的导航（nav.ts 派生，与桌面侧栏同源不漂移）
  const moreItems = moreMenuItems(navItems);

  // 更多菜单只放纯页面导航（账户相关全在账户位的 UserMenu 里）
  const menuItems = moreItems.map(i => ({
    key: i.key,
    icon: MORE_ICON[i.key],
    label: <Link to={i.key}>{i.label}</Link>,
  }));

  return (
    <header className="fp-brandbar fp-mobile fp-glass sticky top-2 z-20 mx-3 mb-3 flex h-12 items-center justify-between rounded-full px-4">
      <a href="/" className="flex items-center gap-2 font-bold text-ink no-underline">
        <Logo size={24} />
        模拟基金
      </a>

      <div className="flex items-center gap-2">
        {/* 账户位：游客=单个登录胶囊 / 登录=头像（loginOnly 保证两态各占
            一个元素位；UserMenu 自带设置/登出菜单与登出表单） */}
        <UserMenu user={user} compact loginOnly />
        {/* 更多位：纯页面导航。trigger 显式 click：触屏 hover 语义不存在
            （同 UserMenu 的定案）。selectedKeys 让当前页对应的导航项高亮
            （antd 自带选中态）——缓解排行榜等页面「不知道自己在哪」的迷路感 */}
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
    </header>
  );
}
