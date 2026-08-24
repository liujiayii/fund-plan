import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from 'react-router';
import { ConfigProvider, Layout as AntLayout, Button, Menu, Space, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { Route } from './+types/root';
import { getAppContext } from '~/services/context';
import { getCurrentUser } from '~/services/guard';

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
  { key: '/', label: '首页' },
  { key: '/master', label: '主人的盘' },
  { key: '/funds', label: '基金' },
  { key: '/me', label: '我的' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
  const selectedKey =
    NAV_ITEMS.filter((i) => i.key !== '/' && location.pathname.startsWith(i.key))
      .map((i) => i.key)
      .at(0) ?? (location.pathname === '/' ? '/' : '');

  return (
    // antd 全局配置：中文语言包 + 主题色（国内习惯红涨绿跌，主色用喜庆红）
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorPrimary: '#c62828' },
      }}
    >
      <AntLayout style={{ minHeight: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/" style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>
            模拟基金
          </a>
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={NAV_ITEMS.map((i) => ({
              key: i.key,
              label: <a href={i.key}>{i.label}</a>,
            }))}
            style={{ flex: 1, minWidth: 0 }}
          />
          {/* 登录态区域：已登录显示用户名与登出，游客显示登录/注册 */}
          {user ? (
            <Space>
              <span style={{ color: 'rgba(255,255,255,.85)' }}>
                {user.username}
                {user.role === 'admin' ? '（主人）' : ''}
              </span>
              <form method="post" action="/logout" style={{ display: 'inline' }}>
                <Button size="small" htmlType="submit">
                  登出
                </Button>
              </form>
            </Space>
          ) : (
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
          style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}
        >
          <Outlet />
        </Content>
        <Footer style={{ textAlign: 'center' }}>
          模拟盘 · 数据来自公开接口 · 仅供学习，不构成投资建议
        </Footer>
      </AntLayout>
    </ConfigProvider>
  );
}

/** 全局错误边界：区分 404 等路由错误与运行时异常 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = '出错了';
  let detail = '发生了未知错误';
  if (isRouteErrorResponse(error)) {
    title = `${error.status}`;
    detail = error.statusText || detail;
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <h1>{title}</h1>
      <p>{detail}</p>
      <a href="/">返回首页</a>
    </div>
  );
}
