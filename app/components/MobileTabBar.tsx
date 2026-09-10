import type { ReactNode } from "react";
import {
  FundOutlined,
  HomeOutlined,
  StarOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Link, useLocation } from "react-router";
import { MOBILE_TAB_KEYS, NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";

/** 四项图标；文案从 NAV_ITEMS 查（tests/domain/nav.test.ts 钉四项都是成员） */
const TAB_ICON: Record<string, ReactNode> = {
  "/": <HomeOutlined />,
  "/funds": <FundOutlined />,
  "/me/watchlist": <StarOutlined />,
  "/me": <UserOutlined />,
};

/**
 * 移动端底部悬浮胶囊 Tab（spec §4.3，宪法层级 3 的铬）。
 *
 * 从「贴底实色条」改成「左右 16px、底 12px + safe-area 的玻璃胶囊」：
 * 定位 / 尺寸在 responsive.css §4（.fp-tabbar），材料是 .fp-glass + 门面高光。
 * 内容从胶囊底下透出来，.fp-content 的底 padding 按胶囊高度让位。
 *
 * 首页项保持原生 <a>：游客边缘缓存靠整页跳转命中（同 AppSidebar）。
 * 手写 <nav> 而非 antd 组件：antd 没有 TabBar；零新增依赖。
 */
export function MobileTabBar() {
  const location = useLocation();
  const selectedKey = resolveSelectedKey(location.pathname, NAV_ITEMS);
  const labelOf = (key: string) => NAV_ITEMS.find(i => i.key === key)?.label ?? key;

  return (
    <nav className="fp-tabbar fp-mobile fp-glass fp-glass-specular" aria-label="主导航">
      {MOBILE_TAB_KEYS.map((key) => {
        const active = selectedKey === key;
        // 选中：小玻璃药丸底 + 主色（宪法 §4.4 的 on 态）；未选中次要色
        const cls = `fp-tabbar-item${active ? " active" : ""}`;
        const body = (
          <>
            {TAB_ICON[key]}
            <span>{labelOf(key)}</span>
          </>
        );
        return key === "/"
          ? (
              <a key={key} href={key} className={cls} aria-current={active ? "page" : undefined}>
                {body}
              </a>
            )
          : (
              <Link key={key} to={key} className={cls} aria-current={active ? "page" : undefined}>
                {body}
              </Link>
            );
      })}
    </nav>
  );
}
