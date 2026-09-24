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
 *   公开页（游客可见）：/ /master /plan /leaderboard /funds /funds/:code
 *     /tools/* /login /register
 *   需登录页：/me 系列（loader 里 requireUser 把门）
 *   公开组合：/users/:id（requireUser，且对方打开了「公开我的组合」才 200；
 *     看的人自己开不开无所谓。不是游客页，不要进边缘缓存）
 *   管理页：/admin 系列（loader 里 requireAdmin 把门，非 admin 一律 403）
 *   爬虫资源：robots[.]txt.ts → /robots.txt；sitemap[.]xml.ts → /sitemap.xml
 *     （方括号让点号进路径而不是嵌套，flat routes 的转义约定）
 */
export default flatRoutes();
