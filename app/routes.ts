import { flatRoutes } from "@react-router/fs-routes";

/**
 * 约定式路由（flat routes）：文件名即路由，无需手工登记。
 *
 * 命名规则（点号串联的扁平风格）：
 *   `_index.tsx`            → /
 *   `funds._index.tsx`      → /funds（index 路由）
 *   `funds.$code.tsx`       → /funds/:code（$ 开头是动态参数）
 *   `me.holdings.$code.tsx` → /me/holdings/:code
 *
 * 鉴权不在路由表里，而在各自 loader：
 *   公开页（游客可见）：/ /master /leaderboard /funds /funds/:code /login /register
 *   需登录页：/me 系列（loader 里 requireUser 把门）
 *   管理页：/admin 系列（loader 里 requireAdmin 把门，非 admin 一律 403）
 */
export default flatRoutes();
