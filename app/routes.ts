import { type RouteConfig, index, route } from '@react-router/dev/routes';

/**
 * 显式路由表。公开页（游客可见）与需登录页混排，鉴权在各自 loader 内做。
 * 现阶段（Task 1 脚手架）只声明首页，其余页面在后续任务逐个加入。
 */
export default [
  index('routes/_index.tsx'),
] satisfies RouteConfig;
