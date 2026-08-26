import type { Route } from "./+types/root";
import { Layout as AntLayout, Button, ConfigProvider, Menu, Space, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from "react-router";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { ANTD_TOKEN, COLOR } from "~/theme";
// UnoCSS 预生成的工具类样式（由 `pnpm uno:build` 产出）。
// 放在 antd 之后引入，保证同优先级下工具类能覆盖 antd 的默认样式。
import "./uno.gen.css";

// antd 的 Layout 重命名为 AntLayout，避免与 React Router 约定的文档骨架导出 Layout 冲突
const { Header, Content, Footer } = AntLayout;

/**
 * 根 loader：把当前登录用户带给全站，用于导航栏显示登录态。
 * 游客返回 null，页面照常渲染（公开内容都能看）。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await getCurrentUser(request, db);
  return { user };
}

/** 顶部导航菜单项 */
const NAV_ITEMS = [
  { key: "/", label: "首页" },
  { key: "/master", label: "主人的盘" },
  { key: "/funds", label: "基金" },
  // ⚠️ 必须排在 /me 之前：selectedKey 用 startsWith 取首个命中，
  // /me/watchlist 若在 /me 之后会被 /me 先吃掉，导致自选页高亮「我的」
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const user = data?.user ?? null;

  // 高亮当前所在的一级导航
  const selectedKey
    = NAV_ITEMS.filter(i => i.key !== "/" && location.pathname.startsWith(i.key))
      .map(i => i.key)
      .at(0) ?? (location.pathname === "/" ? "/" : "");

  return (
    // antd 全局配置：中文语言包 + 视觉 token（见 app/theme.ts）
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: theme.defaultAlgorithm, ...ANTD_TOKEN }}
    >
      <AntLayout style={{ minHeight: "100vh" }}>
        {/* Header 由 antd 默认的深色改为白底 + 底部细线，
            这是「后台管理系统」与「消费级理财 App」观感的分水岭 */}
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            paddingInline: 24,
            background: COLOR.card,
            borderBottom: `1px solid ${COLOR.border}`,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <a
            href="/"
            style={{
              color: COLOR.primary,
              fontWeight: 700,
              fontSize: 18,
              whiteSpace: "nowrap",
            }}
          >
            模拟基金
          </a>
          <Menu
            mode="horizontal"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={NAV_ITEMS.map(i => ({
              key: i.key,
              label: <a href={i.key}>{i.label}</a>,
            }))}
            style={{ flex: 1, minWidth: 0, borderBottom: "none" }}
          />
          {/* 登录态区域：已登录显示用户名与登出，游客显示登录/注册 */}
          {user
            ? (
                <Space>
                  <span style={{ color: COLOR.textSecondary }}>
                    {user.username}
                    {user.role === "admin" ? "（主人）" : ""}
                  </span>
                  <form method="post" action="/logout" style={{ display: "inline" }}>
                    <Button size="small" htmlType="submit">
                      登出
                    </Button>
                  </form>
                </Space>
              )
            : (
                <Space>
                  <Button size="small" href="/login">
                    登录
                  </Button>
                  <Button size="small" type="primary" href="/register">
                    注册
                  </Button>
                </Space>
              )}
        </Header>
        <Content
          style={{
            padding: "24px 24px 48px",
            maxWidth: 1120,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <Outlet />
        </Content>
        <Footer style={{ textAlign: "center", color: COLOR.textSecondary }}>
          模拟盘 · 数据来自公开接口 · 仅供学习，不构成投资建议
        </Footer>
      </AntLayout>
    </ConfigProvider>
  );
}

/** 全局错误边界：区分 404 等路由错误与运行时异常 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "出错了";
  let detail = "发生了未知错误";
  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    detail = error.statusText || detail;
  }
  else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <div style={{ padding: 48, textAlign: "center" }}>
      <h1>{title}</h1>
      <p>{detail}</p>
      <a href="/">返回首页</a>
    </div>
  );
}
