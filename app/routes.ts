import type { RouteConfig } from "@react-router/dev/routes";
import { index, route } from "@react-router/dev/routes";

/**
 * 显式路由表。
 *
 * 公开页（游客可见）：/ /master /funds /funds/:code /login /register
 * 需登录页：/me 系列（鉴权在各自 loader 里用 requireUser 做）
 */
export default [
  // ==== 公开 ====
  index("routes/_index.tsx"),
  route("master", "routes/master.tsx"),
  route("funds", "routes/funds._index.tsx"),
  route("funds/:code", "routes/funds.$code.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("logout", "routes/logout.tsx"),

  // ==== 需登录 ====
  route("me", "routes/me._index.tsx"),
  route("me/holdings", "routes/me.holdings.tsx"),
  route("me/holdings/:code", "routes/me.holdings.$code.tsx"),
  route("me/orders", "routes/me.orders.tsx"),
  route("me/dca", "routes/me.dca.tsx"),
  route("me/settings", "routes/me.settings.tsx"),
] satisfies RouteConfig;
