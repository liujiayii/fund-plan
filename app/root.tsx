import type { Route } from "./+types/root";
import { GithubOutlined, LogoutOutlined } from "@ant-design/icons";
import { DefaultFooter } from "@ant-design/pro-components";
import { Layout as AntLayout, Avatar, Button, ConfigProvider, Dropdown, Menu, Space, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useRef } from "react";
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
import { MobileTabBar } from "~/components/MobileTabBar";
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { ANTD_TOKEN, COLOR } from "~/theme";
// antd v6 起全局重置样式需手动引入。link 顺序上必须早于 UnoCSS，
// 才能让 UnoCSS 工具类在同级覆盖 reset；antd 组件样式走 cssinjs 运行时注入，
// 顺序不受此处影响，故 reset 放在所有值导入之后即可。
import "antd/dist/reset.css";
// UnoCSS 预生成的工具类样式（由 `pnpm uno:build` 产出）。
import "./uno.gen.css";
// 期五移动端适配：唯一的媒体查询出处，必须排在 uno.gen.css 之后
// 才能覆盖工具类与 antd 组件类（顺序理由见该文件头注释）
import "./styles/responsive.css";

// antd 的 Layout 重命名为 AntLayout，避免与 React Router 约定的文档骨架导出 Layout 冲突
const { Header, Content } = AntLayout;

/**
 * 根 loader：把当前登录用户带给全站，用于导航栏显示登录态。
 * 游客返回 null，页面照常渲染（公开内容都能看）。
 *
 * ⚠️ 不要在这里重新接 CF Web Analytics beacon（PR #26 加过、PR #29 撤了）：
 * 线上域名 liujiayii.dpdns.org 在 CF zone 内走橙云代理，Web Analytics 的
 * 自动注入默认开启——页面手动再嵌一份会双上报，dashboard 的 pageview 翻倍。
 * 自动注入从 zone 接入起就在收集，历史数据与 CWV 都在，手动嵌入零收益。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await getCurrentUser(request, db);
  return { user };
}

// 一级导航项定义已迁至 ~/domain/nav（顶栏与移动端底部 TabBar 共用，顺序敏感）

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

  // 登出表单引用：Dropdown 的菜单项点击后触发 submit，走 POST /logout。
  // 仍用 form post 而非 client fetch，是为了沿用服务端清 session + 重定向的标准链路。
  const logoutFormRef = useRef<HTMLFormElement>(null);

  // 高亮当前所在的一级导航（顶栏与底部 TabBar 共用同一份纯函数）
  const selectedKey = resolveSelectedKey(location.pathname, NAV_ITEMS);

  // 用户名首字作为头像文字（中文取第一字，英文取首字母大写），
  // 因 DB 未存头像 URL，用品牌蓝底白字字母头像是最接近消费级 App 的做法。
  const avatarText = user
    ? (/^[A-Z]/i.test(user.username) ? user.username[0].toUpperCase() : user.username[0])
    : "";

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
          // fp-header：窄屏 space-between 让登录态回到右侧（responsive.css）
          className="fp-header"
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
              fontSize: "clamp(16px, 4vw, 18px)",
              whiteSpace: "nowrap",
            }}
          >
            模拟基金
          </a>
          {/* 桌面顶栏导航。窄屏整体隐藏（display:none），职责移交底部 TabBar ——
              用 CSS 隐藏而非条件渲染：条件渲染需要 JS 断点，SSR 下必闪一帧（spec §6.2）。
              隐藏的 DOM 还在，代价是几个 <li>，可接受 */}
          <div className="fp-desktop" style={{ flex: 1, minWidth: 0 }}>
            <Menu
              mode="horizontal"
              selectedKeys={selectedKey ? [selectedKey] : []}
              items={NAV_ITEMS.map(i => ({
                key: i.key,
                label: <a href={i.key}>{i.label}</a>,
              }))}
              style={{ minWidth: 0, borderBottom: "none" }}
            />
          </div>
          {/* 登录态区域：已登录显示头像+用户名 Dropdown（登出入口收进菜单），
              游客显示登录/注册。用 Dropdown 取代原先「昵称 + 登出按钮」并排，
              避免操作按钮贴着昵称的别扭观感，也更贴近消费级 App 习惯。 */}
          {user
            ? (
                <Dropdown
                  placement="bottomRight"
                  menu={{
                    items: [
                      {
                        key: "logout",
                        icon: <LogoutOutlined />,
                        label: "登出",
                        // 菜单项点击 → 触发隐藏的登出表单 submit
                        onClick: () => logoutFormRef.current?.requestSubmit(),
                      },
                    ],
                  }}
                >
                  <Space style={{ cursor: "pointer" }} size={8}>
                    <Avatar
                      size={28}
                      style={{ background: COLOR.primary, verticalAlign: "middle" }}
                    >
                      {avatarText}
                    </Avatar>
                    <span style={{ color: COLOR.textPrimary }}>
                      {user.username}
                      {user.role === "admin" ? "（主理人）" : ""}
                    </span>
                  </Space>
                </Dropdown>
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
          {/* 登出表单：视觉上隐藏，仅供 Dropdown 菜单项触发 submit 用 */}
          <form
            ref={logoutFormRef}
            method="post"
            action="/logout"
            style={{ display: "none" }}
          />
        </Header>
        <Content
          className="fp-content"
          style={{
            padding: "24px 24px 48px",
            maxWidth: 1120,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <Outlet />
        </Content>
        {/* 移动端底部导航（768px 以下显示）。放 Content 外保证固定定位不受内容影响 */}
        <MobileTabBar />
        {/* Pro 系标准 Footer：上行 links（GitHub），下行 © + 声明。
            用 DefaultFooter 取代手写 Footer，省去自维护链接样式，视觉与 antd Pro 一致。 */}
        <DefaultFooter
          className="fp-footer"
          copyright="模拟盘 · 数据来自公开接口 · 仅供学习，不构成投资建议"
          links={[
            {
              key: "github",
              // GitHub 文字前置图标，免得链接孤零零一行不好看
              title: (
                <Space size={4}>
                  <GithubOutlined />
                  GitHub
                </Space>
              ),
              href: "https://github.com/liujiayii/fund-plan",
              // 新窗口打开（等价 target="_blank" rel="noreferrer"）
              blankTarget: true,
            },
          ]}
        />
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
