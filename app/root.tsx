import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import { ConfigProvider, Layout as AntLayout, Menu, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { Route } from './+types/root';

// antd 的 Layout 重命名为 AntLayout，避免与 React Router 约定的文档骨架导出 Layout 冲突
const { Header, Content, Footer } = AntLayout;

/**
 * 顶部导航菜单项。「我的」在未登录时也展示，点击后由路由守卫重定向到登录页。
 * 后续（Task 18）会接入当前用户，动态显示登录/登出。
 */
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
        <title>模拟基金 · 定投</title>
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
        <Header style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ color: '#fff', fontWeight: 700, marginRight: 24 }}>
            模拟基金
          </div>
          <Menu
            theme="dark"
            mode="horizontal"
            selectable={false}
            items={NAV_ITEMS.map((i) => ({
              key: i.key,
              label: <a href={i.key}>{i.label}</a>,
            }))}
            style={{ flex: 1, minWidth: 0 }}
          />
        </Header>
        <Content style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
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
