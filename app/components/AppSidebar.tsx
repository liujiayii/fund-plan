import type { NavItem } from "~/domain/nav";
import { NavLinks } from "~/components/NavLinks";
import { Logo } from "~/components/ui/Logo";
import { UserMenu } from "~/components/ui/UserMenu";

export interface AppSidebarProps {
  /** 含运行时追加的 /admin 项（root.tsx 拼），顺序即 NAV_ITEMS 顺序 */
  navItems: readonly NavItem[];
  /** resolveSelectedKey 的结果；空串不高亮 */
  selectedKey: string;
  user: { username: string; role: string } | null;
}

/**
 * 桌面 / 平板玻璃侧栏轨（spec §4.1 / §4.2，宪法层级 3 的铬）。
 * 不挂 fp-glass-specular：竖长的轨上扫光像扫码枪（主人 2026-09-10 反馈），
 * 铬的质感靠描边 + 高光脊即可（宪法 §2.3 第二版）。
 *
 * 三档由 responsive.css 管：<768 整体隐藏（.fp-desktop）、768–1079 收成 72px
 * 图标轨（.fp-sidebar-label 隐藏 + title 提示）、≥1080 220px 全宽。
 * sticky + 视口高：轨随页面滚动钉在左侧，内容从它底下穿过去才算「看得见玻璃」。
 *
 * 导航列表渲染已抽成 NavLinks（与移动端导航抽屉共用，防两份漂移）；
 * `/` 与 `/master` 走原生 <a> 的缓存纪律、选中态、图标表都在那边。
 *
 * 选中态是玻璃内井 + 主色字（bg-well text-primary），不整行实色填充。
 */
export function AppSidebar({ navItems, selectedKey, user }: AppSidebarProps) {
  return (
    <aside
      className="fp-sidebar fp-desktop fp-glass sticky top-3 m-3 hidden h-[calc(100vh-24px)] w-[220px] shrink-0 flex-col rounded-[24px] p-3 md:flex"
      aria-label="主导航"
    >
      {/* 品牌：Logo + 站名（图标轨下站名隐藏） */}
      <a href="/" className="mb-4 flex items-center gap-2 px-2 py-1 font-bold text-ink no-underline">
        <Logo size={28} />
        <span className="fp-sidebar-label whitespace-nowrap">模拟基金</span>
      </a>

      <nav className="flex flex-1 flex-col gap-1">
        <NavLinks navItems={navItems} selectedKey={selectedKey} />
      </nav>

      {/* 底：登录态（游客 = 登录/注册） */}
      <div className="mt-2 border-t border-line pt-3 [border-top-style:solid]">
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
