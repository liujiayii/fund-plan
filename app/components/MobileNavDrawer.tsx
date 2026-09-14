import type { NavItem } from "~/domain/nav";
import { CloseOutlined } from "@ant-design/icons";
import { Drawer } from "antd";
import { NavLinks } from "~/components/NavLinks";
import { Logo } from "~/components/ui/Logo";
import { UserMenu } from "~/components/ui/UserMenu";

export interface MobileNavDrawerProps {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / ESC / 右上关闭钮 / 点导航项后） */
  onClose: () => void;
  /** 含运行时追加的 /admin 项（root.tsx 拼），顺序即 NAV_ITEMS 顺序 */
  navItems: readonly NavItem[];
  /** resolveSelectedKey 的结果；空串不高亮 */
  selectedKey: string;
  user: { username: string; role: string } | null;
}

/**
 * 移动端导航抽屉（2026-09-14）：顶栏汉堡钮拉开的全量导航，
 * 与桌面侧栏像素级同构——品牌头 / NavLinks 全量列表 / 底部登录态，
 * 三段结构与 AppSidebar 一一对应。
 *
 * 为什么抽屉而不是「更多」下拉：底栏四项 + 顶栏「···」两处导航的
 * 心智是割裂的（主导航不完整，残缺部分藏在屏幕另一端）；抽屉把
 * 「全部导航在一个入口」这条桌面心智原样搬到移动端，底栏退化为
 * 快捷层。组件复用 NavLinks / UserMenu，不产生第二份漂移的导航源。
 *
 * 材料不用自己挂：liquid-glass.css §5 已给所有 .ant-drawer-section
 * （antd v6 面板节点名）铺玻璃——portal 浮层拿不到根节点，材料只能在 CSS 层给。
 * 宽度 min(300px, 82%) 交给 responsive.css §4.6（v6 弃用了 width prop，
 * 百分比宽只能 CSS 管）。destroyOnHidden：关掉即卸载 DOM，
 * 屏读器不迷失在隐藏面板里。
 */
export function MobileNavDrawer({ open, onClose, navItems, selectedKey, user }: MobileNavDrawerProps) {
  return (
    <Drawer
      placement="left"
      open={open}
      onClose={onClose}
      closable={false}
      rootClassName="fp-nav-drawer"
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex h-full flex-col p-3">
        {/* 品牌行：同桌面侧栏（Logo + 站名），右端补关闭钮——
            遮罩只剩 18% 窄条不够显眼，给个明确的出口（宪法 §2.4 焦点环同款） */}
        <div className="mb-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 px-2 py-1 font-bold text-ink no-underline">
            <Logo size={28} />
            <span className="whitespace-nowrap">模拟基金</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="关闭导航菜单"
          >
            <CloseOutlined className="text-lg leading-none" />
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label="主导航">
          <NavLinks navItems={navItems} selectedKey={selectedKey} onNavigate={onClose} />
        </nav>

        {/* 底：登录态——同桌面侧栏用完整形态 UserMenu（头像 + 用户名 + 菜单），
            与顶栏账户位（compact loginOnly）并存是「同构」的必要代价，
            支付宝同款双入口，主人 2026-09-14 首肯 */}
        <div className="mt-2 border-t border-line pt-3 [border-top-style:solid]">
          <UserMenu user={user} />
        </div>
      </div>
    </Drawer>
  );
}
