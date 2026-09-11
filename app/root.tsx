import type { Route } from "./+types/root";
import { GithubOutlined } from "@ant-design/icons";
import { DefaultFooter } from "@ant-design/pro-components";
import { ConfigProvider, Space, theme } from "antd";
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
  useMatches,
} from "react-router";
import { AppSidebar } from "~/components/AppSidebar";
import { FogStage } from "~/components/FogStage";
import { MobileBrandBar } from "~/components/MobileBrandBar";
import { MobileTabBar } from "~/components/MobileTabBar";
import { NavProgressBar } from "~/components/NavProgressBar";
import { Logo } from "~/components/ui/Logo";
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";
import { buildJsonLd } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { ANTD_TOKEN } from "~/theme";
// 数字品牌字体：Space Grotesk 三字重（自托管 woff2 随构建产物走）。
// 只覆盖拉丁字符，中文继续系统栈——体积 ~50KB，国内加载零风险（spec §3.3）
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
// antd v6 起全局重置样式需手动引入。link 顺序上必须早于 UnoCSS，
// 才能让 UnoCSS 工具类在同级覆盖 reset；antd 组件样式走 cssinjs 运行时注入，
// 顺序不受此处影响，故 reset 放在所有值导入之后即可。
import "antd/dist/reset.css";
import "virtual:uno.css";
// 液态玻璃材料层（色雾 / .fp-glass / 高光 / 降级）：全站唯一的模糊材料出处（守卫测试钉死），
// 排在 virtual:uno.css 之后（材料压过工具类）、responsive.css 之前（壳的媒体查询最后说话）
import "./styles/liquid-glass.css";
// 期五移动端适配：唯一的媒体查询出处，必须排在 UnoCSS 之后
// 才能覆盖工具类与 antd 组件类（顺序理由见该文件头注释）
import "./styles/responsive.css";

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

// 一级导航项定义已迁至 ~/domain/nav（侧栏与移动端底部胶囊共用，顺序敏感）

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* 暗底站点必须声明 color-scheme：原生滚动条 / 表单控件 / 日期选择器才走深色，
            否则玻璃页面里蹦出一根白滚动条（2026-09-10 走查补） */}
        <meta name="color-scheme" content="dark" />
        {/* 移动端浏览器地址栏跟页面底同色，色值与 theme.ts 的 COLOR.bg 一致（静态资源吃不到变量，改色同步） */}
        <meta name="theme-color" content="#071018" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
        {/* 站点级 JSON-LD：WebApplication 卡，内容与具体哪一页无关，挂在 Layout
            比首页组件里更稳（Layout 是文档骨架，爬虫第一眼就能看到）。
            dangerouslySetInnerHTML 是 schema.org 脚本的标准姿势，序列化由
            domain 纯函数完成、不含用户输入 */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- JSON-LD 必须是原始 JSON 文本节点
          dangerouslySetInnerHTML={{ __html: buildJsonLd() }}
        />
      </head>
      <body>
        {/* 色雾舞台放 body 首位：fixed 层，DOM 顺序与视觉层级（雾在最底）一致 */}
        <FogStage />
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

  // admin 专属导航项：运行时按角色拼接，不加进 domain 的 NAV_ITEMS ——
  // NAV_ITEMS 是「无角色分叉的公共导航」的单一事实源（侧栏与胶囊共用、
  // 顺序被单测钉死），混入角色逻辑就毁了这个约定。追加在末尾无前缀冲突。
  const navItems = user?.role === "admin"
    ? [...NAV_ITEMS, { key: "/admin", label: "管理" }]
    : NAV_ITEMS;
  // 高亮当前所在的一级导航（侧栏与底部胶囊共用同一份纯函数）
  const selectedKey = resolveSelectedKey(location.pathname, navItems);

  // 页底固定操作条（BottomActionBar）只在持仓详情/基金详情两页出现；
  // Footer 在主列底，bar 护不到它，这两页要额外让位（ux-polish 终审 I-1）
  const hasBottomBar = useMatches().some(
    m => /^\/me\/holdings\/.+/.test(m.pathname) || /^\/funds\/.+/.test(m.pathname),
  );

  return (
    // antd 全局配置：中文语言包 + 暗色算法 + 视觉 token（见 app/theme.ts；为什么切暗色算法见 ANTD_TOKEN 注释）
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: theme.darkAlgorithm, ...ANTD_TOKEN }}
    >
      {/* 全局导航进度条：SPA 导航 pending 时视口顶部反馈（大陆慢链路下防重复点击） */}
      <NavProgressBar />
      {/* 壳：relative z-1 压在色雾（fixed z-0）之上，玻璃才透得到雾。
          antd Layout / 顶栏 Menu 退役：横向 Menu 是要杀掉的「后台管理系统」脸（spec §4.1）。
          登录态 / 登出表单收进 UserMenu（侧栏底 + 移动端品牌胶囊右侧两处共用） */}
      <div className="fp-shell relative z-1 flex min-h-screen">
        {/* 跳转主内容：键盘用户不必逐项 Tab 过整条侧栏。平时视觉隐藏，
            聚焦时以玻璃药丸浮出（focus 样式在 responsive.css §0——
            不能用 not-sr-only：它把 position 打回 static，链接挤进
            fp-shell 的 flex 流引发布局位移，CodeRabbit PR #80 指正） */}
        <a
          href="#fp-main-content"
          className="fp-skip-link fp-glass sr-only rounded-full text-sm text-ink no-underline"
        >
          跳到主内容
        </a>
        <AppSidebar navItems={navItems} selectedKey={selectedKey} user={user} />
        <div className="fp-main flex min-w-0 flex-1 flex-col">
          <MobileBrandBar user={user} />
          <main id="fp-main-content" className="fp-content mx-auto w-full max-w-[1120px] px-6 pt-6 pb-12">
            <Outlet />
          </main>
          {/* Pro 系标准 Footer：收在主列底，不再通栏。
              用 DefaultFooter 取代手写 Footer，省去自维护链接样式，视觉与 antd Pro 一致 */}
          <DefaultFooter
            className={`fp-footer${hasBottomBar ? " fp-footer-bar-clear" : ""}`}
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
        </div>
      </div>
      {/* 移动端底部胶囊（768px 以下显示）。放壳外保证 fixed 不受内容影响 */}
      <MobileTabBar />
    </ConfigProvider>
  );
}

/**
 * 全局错误边界：区分 404 等路由错误与运行时异常。
 *
 * 渲染在 Layout（文档骨架）里、App 之外——所以没有 ConfigProvider / 侧栏，
 * 只能用原生元素 + 工具类 + .fp-glass（色雾由 Layout 的 FogStage 提供，
 * 暗底玻璃语言不断片）。404 给「回首页 / 去发现基金」两条路，其余错误给重试。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "出错了";
  let detail = "发生了未知错误";
  let isNotFound = false;
  if (isRouteErrorResponse(error)) {
    isNotFound = error.status === 404;
    title = isNotFound ? "404 · 这页不存在" : `${error.status}`;
    detail = isNotFound ? "链接可能拼错了，或者这一页已经搬走。" : (error.statusText || detail);
  }
  else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <div className="relative z-1 flex min-h-screen items-center justify-center p-6">
      <div className="fp-glass relative w-full max-w-[480px] rounded-[22px] px-8 py-10 text-center">
        <div className="mb-3 flex justify-center">
          <Logo size={40} />
        </div>
        <h1 className="m-0 text-2xl font-bold text-ink">{title}</h1>
        <p className="mt-2 mb-6 text-sm leading-6 text-muted">{detail}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {/* 原生 <a>：错误边界外没有 router 上下文，也顺手走边缘缓存。
              亮冰蓝药丸配深海墨字（COLOR.onPrimary，白字对比不足） */}
          <a href="/" className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary no-underline">
            返回首页
          </a>
          {isNotFound
            ? (
                <a href="/funds" className="rounded-full border border-line bg-well px-5 py-2 text-sm text-ink no-underline [border-style:solid]">
                  去发现基金
                </a>
              )
            : (
                <a href="" className="rounded-full border border-line bg-well px-5 py-2 text-sm text-ink no-underline [border-style:solid]">
                  重试
                </a>
              )}
        </div>
      </div>
    </div>
  );
}
