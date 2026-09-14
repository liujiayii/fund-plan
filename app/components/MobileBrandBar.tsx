import type { NavItem } from "~/domain/nav";
import { MenuOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { MobileNavDrawer } from "~/components/MobileNavDrawer";
import { Logo } from "~/components/ui/Logo";
import { UserMenu } from "~/components/ui/UserMenu";
import { resolveSelectedKey } from "~/domain/nav";

export interface MobileBrandBarProps {
  /** 含运行时追加的 /admin 项（root.tsx 拼），顺序即 NAV_ITEMS 顺序 */
  navItems: readonly NavItem[];
  user: { username: string; role: string } | null;
}

/**
 * 移动端顶部品牌胶囊（spec §4.3）：Logo + 站名 + 两端各一个固定锚点。
 * 高 48，玻璃；768px+ 由 .fp-mobile 隐藏（侧栏接管品牌与登录态）。
 * sticky 钉顶：内容从胶囊底下穿过去，玻璃才「看得见」。
 *
 * 两端语义（2026-09-14 修订，替代 2026-09-11 方案 B 的「···」更多位）：
 *   左端导航位——汉堡圆钮，拉开 MobileNavDrawer（全量导航抽屉，
 *   与桌面侧栏同构）。原「···」下拉只装得下残缺的导航子集，且与
 *   底部胶囊分居屏幕两端，心智割裂；抽屉让「全部导航在一个入口」
 *   这条桌面心智原样落到移动端；
 *   右端账户位——沿用方案 B：游客常显「登录」小胶囊，登录后变身头像
 *   （点头像弹设置/登出），注册走登录页的既有链路。
 * 抽屉开合状态收在本组件：触发钮与抽屉是同一条交互链，宿主（root.tsx）零感知。
 */
export function MobileBrandBar({ navItems, user }: MobileBrandBarProps) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const selectedKey = resolveSelectedKey(location.pathname, navItems);

  // 任意 SPA 跳转后收抽屉（CodeRabbit PR #90 指正）：NavLinks 的 <Link> 自带
  // onNavigate，但底部 UserMenu 的「设置」走自己的 navigate() 不经过它——
  // 跳转后抽屉仍遮着页面。监听 location.key 一并兜住（含浏览器前进/后退）。
  // 「登出」是 form POST 整页跳转、NavLinks 的首页/主理人的盘是原生 <a>
  // 整页跳转，页面重载抽屉自然消失，不依赖这条。
  // setNavOpen 是稳定引用（useState setter），挂载首跑一次 setNavOpen(false)
  // 幂等无渲染开销。
  useEffect(() => {
    setNavOpen(false);
  }, [location.key]);

  return (
    <>
      <header className="fp-brandbar fp-mobile fp-glass sticky top-2 z-20 mx-3 mb-3 flex h-12 items-center justify-between rounded-full px-4">
        <div className="flex items-center gap-2">
          {/* 导航位：汉堡钮（与右端账户位对称，各占一端） */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="打开导航菜单"
          >
            <MenuOutlined className="text-lg leading-none" />
          </button>
          <a href="/" className="flex items-center gap-2 font-bold text-ink no-underline">
            <Logo size={24} />
            模拟基金
          </a>
        </div>

        {/* 账户位：游客=单个登录胶囊 / 登录=头像（loginOnly 保证两态各占
            一个元素位；UserMenu 自带设置/登出菜单与登出表单） */}
        <UserMenu user={user} compact loginOnly />
      </header>

      <MobileNavDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        navItems={navItems}
        selectedKey={selectedKey}
        user={user}
      />
    </>
  );
}
