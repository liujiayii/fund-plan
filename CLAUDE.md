# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

模拟基金购买 / 定投系统。用真实东方财富数据、真实 T+1 撮合规则跑模拟盘，部署在 Cloudflare 免费全家桶上。

## 命令

**包管理器必须用 pnpm，不要用 npm。**

```bash
pnpm install
pnpm db:migrate:local     # 首次开发前必跑，否则本地 D1 没有表
pnpm dev                  # 起本地服务（真实 workerd 运行时 + 本地 D1/KV）

pnpm lint                 # ESLint 检查
pnpm lint:fix             # 自动修（大部分问题可自动修）
pnpm typecheck            # react-router typegen && tsc
pnpm verify               # lint + typecheck + test，提交前全量校验

pnpm test                 # 领域层单测（node 环境，毫秒级）
pnpm test:workers         # 应用层集成测试（真实 workerd + 真实 D1，慢）
pnpm test:all             # 两者都跑

pnpm db:generate          # 改了 schema 后重新生成迁移 SQL
pnpm db:migrate:prod      # 应用迁移到线上 D1
pnpm cf-typegen           # 重新生成 worker-configuration.d.ts
pnpm uno:build            # 生成 UnoCSS 样式（dev/build 已自动前置）
pnpm deploy               # build + wrangler deploy
```

**测试分两套配置，跑单个测试要选对：**

```bash
# 领域层（tests/domain/**、tests/smoke.test.ts）
pnpm test tests/domain/redeem.test.ts
pnpm test -t "FIFO"                       # 按测试名过滤

# 应用层（tests/db/**、tests/services/**）
pnpm test:workers tests/services/settle.test.ts
```

注意**不要加 `--`**：`pnpm test -- tests/x.test.ts` 会被 pnpm 当成字面参数，
过滤失效、静默跑全部测试。用错配置会报 `No test files found`（打出 include
范围），照提示换命令即可。

**手动触发 Cron（不用等到点）：**

```bash
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"    # 定投扫描
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=30+12+*+*+*"  # 净值同步+撮合
```

**查 Worker 日志与本地数据（比翻终端方便）：**

```bash
curl -X POST http://localhost:5173/cdn-cgi/local/explorer/api/local/observability/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT message FROM logs ORDER BY rowid DESC LIMIT 20"}'

npx wrangler d1 execute fund-plan-db --local --command "SELECT * FROM orders"
```

## 架构

三层洁净架构，**这个分层是硬约束，不要跨层**：

```
app/routes/      loader/action + 页面组件
app/services/    应用层：依赖 D1/网络，把 D1 数据喂给领域层再写回
app/domain/      领域层：纯函数，不依赖 D1/网络，可脱离运行时单测
app/db/          Drizzle schema 与 client
workers/app.ts   Worker 入口：export default { fetch, scheduled }
```

新增金融计算逻辑时**先在 domain 写纯函数 + 单测**，再在 service 层接线。
这样测试跑得快，也不需要起数据库。

### 约定式路由（flat routes）：文件名即路由

路由由 `@react-router/fs-routes` 的 `flatRoutes()` 按 `app/routes/` 目录的文件名约定
生成（见 `app/routes.ts`）。新建路由文件**即时生效**，无需登记。命名规则：

- `_index.tsx` → `/`；`funds._index.tsx` → `/funds`（`_index` 后缀是 index 路由）
- `funds.$code.tsx` → `/funds/:code`（`$` 开头是动态参数）
- `me.holdings.$code.tsx` → `/me/holdings/:code`（点号串联即层级）

鉴权不在路由表里，而在各自 loader：公开页（`/` `/master` `/leaderboard`
`/funds*` `/login` `/register`）游客可见；`/me` 系列用 `requireUser` 把门；
`/admin` 系列用 `requireAdmin` 把门（非 admin 一律 403）。

### loader/action 里取 env 的标准姿势

Cloudflare 的 `env`/`ctx` 由 `workers/app.ts` 注入 `CloudflareContext`，
路由侧一律通过 `app/services/context.ts` 的 `getAppContext(context)`
一把取出 `{ db, env, ctx }`，不要自己手写 `context.get(CloudflareContext)`。

### 精度铁律（改任何涉及金额的代码前必读）

数据库里**没有小数**，全是整数：

| 数据 | 存储                     | 例                      |
| ---- | ------------------------ | ----------------------- |
| 金额 | 整数「分」（×100）       | 1000 元 → `100000`      |
| 份额 | 整数（×10000）           | 656.8133 份 → `6568133` |
| 净值 | 整数（×10000）           | 1.2345 → `12345`        |
| 费率 | 整数「万分之」（×10000） | 1.5% → `150`            |

中间运算一律用 `decimal.js`，最后 `roundInt()`（HALF_UP）回整数。
工具函数全在 `app/domain/money.ts`。**绝不要用 JS 浮点数算钱。**

### 为什么需要 share_lot 表

`holding` 是持仓汇总，`share_lot` 是**份额批次**。赎回时按 `confirm_date` 升序
FIFO 逐批消耗，每批按各自持有天数查阶梯费率——所以一笔赎回可能同时按
1.5% 和 0.5% 两档计费。**只存持仓汇总算不出正确赎回费**，这是 `share_lot` 存在的唯一理由。

两者在同一个 `db.batch()` 内同步维护，`app/domain/portfolio.ts` 的 `reconcile()`
是撮合后的自检闸门：Σ`share_lot` 必须与 `holding` 完全一致。

### 撮合的两条铁律

`app/services/settle.ts`：

1. **幂等**——只处理 `status='pending'` 且 `confirm_date <= 今天` 的订单，确认后立刻置
   `confirmed`。Cron 会重试，同一订单撮合两次就是重复成交。
2. **拉不到净值时订单保持 pending 顺延，绝不判失败**。网络抖动不该让用户的单子消失。

买单在下单时**立即冻结现金**（`app/services/trade.ts`），业务失败时在
`failOrder()` 里退还；赎回单则把待确认份额计入占用，防止同一批份额被重复赎回。

### D1 没有交互式事务

多表写入必须用 `db.batch([...])` 一次原子提交。`settle.ts` 里有 `runBatch()` 辅助函数
处理空数组与元组类型收窄。

### D1 免费版每请求 50 条查询是硬顶

列表/聚合页严禁 N+1。旧版 `/admin` 逐人调 `getPortfolio`（每人 2~4 条查询），
用户过 ~10 人直接 500。正确姿势见 `listUsersOverview`：查询数与用户数无关，
聚合全在内存做。新增任何「遍历用户/基金再逐条查」的页面之前，先数查询数。

### 权限模型

`app/services/guard.ts`。主理人的 `/me` 就是被公开的那个盘，`/master` 只是它的
只读镜像，两者共用 `app/components/PortfolioView.tsx`。admin 由环境变量
`ADMIN_USERNAME` 认定（`wrangler.jsonc` 的 `vars`）。

admin **另有只读后台**（PR #34）：`/admin` 用户列表 + 全局统计，
`/admin/users/:id` 单用户组合与订单。**只有读，没有任何写操作**——排查问题用，
不是运营工具。`requireAdmin` 对非 admin 一律 403（刻意不重定向登录页，
不暴露后台存在）；`listUsersOverview` 必须保持批量聚合写法，不得退回 N+1。

### Cron 调度

`workers/app.ts` 的 `scheduled` 按 `controller.cron` 分派。表达式一律写 UTC：

| UTC           | 北京时间 | 任务                           |
| ------------- | -------- | ------------------------------ |
| `0 2 * * *`   | 10:00    | 定投扫描 → 生成 pending 申购单 |
| `30 12 * * *` | 20:30    | 拉当日净值 → 撮合 pending 订单 |

顺序不能颠倒（先同步净值再撮合），每个任务独立 try/catch。

## 已知陷阱

以下都是实际踩过并修复的，改动相关代码时注意。完整记录见 `docs/development.md`。

### 东财接口各自的请求头要求不同

| 接口                                       | Referer  | User-Agent            |
| ------------------------------------------ | -------- | --------------------- |
| 历史净值 `api.fund.eastmoney.com/f10/lsjz` | **必须** | 无所谓                |
| 基本信息 `fundmobapi.eastmoney.com/...`    | 可选     | **绝不能带浏览器 UA** |
| 搜索 `fundsuggest.eastmoney.com/...`       | 无所谓   | 无所谓                |

`fundmobapi` 是移动端接口，带 Chrome UA 会返回 **HTTP 200 但 `Datas` 为空**（静默失败）。
`app/services/fund-data.ts` 里 `EM_WEB_HEADERS` / `EM_MOBILE_HEADERS` 刻意分开，别合并。

### 绝不安装 @react-router/node（以及 express/serve 适配器）

react-router 的 vite 插件按 **package.json 里是否装了这些包**（`hasNodeDependency()`，
与代码是否引用无关）判定「托管在 Node 上」，装了就为 SSR 环境保留 `node` 解析条件。
本项目跑在 workerd，这个条件是错的：曾导致 `@ant-design/icons` 6.3.x 按 node 条件
解析到 CJS 桥接入口，依赖优化器产出只含 default 的 shim，**所有图标具名导入在
dev SSR 里变成 undefined、每页 500**（真 Node / 生产 build / CI 全都不炸，纯本地
静默）。删包即根治。最小复现与完整证据链：`../antd-icons-workerd-repro`。

### UnoCSS 走 CLI 预生成，不是 Vite 插件

原因：UnoCSS 的 Vite 插件与 React Router 8 的 Vite Environment API 不兼容——
多环境构建下 `failed to find vite:css-post plugin` 只报一行警告就"成功"，
产物 CSS 只剩 48 字节占位符，所有工具类静默丢失（完整考证见 `docs/development.md`）。
纯 SPA 项目（`@vitejs/plugin-react`，单环境）不受此影响。

所以 `dev`/`build` 前会跑 `pnpm uno:build` 生成 `app/uno.gen.css`（该文件**入库**，不要手改）。
注意这步是**一次性预生成**：dev 运行中新增了类，要手动再跑一次 `pnpm uno:build`
（vite 会 watch 到产物变化自动热更）。

两个配置必须保持关闭（`uno.config.ts`）：

- `preflights.reset: false` —— UnoCSS 的全局重置会冲掉 antd 自带的重置
- **不启用 `presetAttributify`** —— 会把 antd 的 `color="red"`、`align="middle"` 等 props
  误当工具类生成污染规则

提取器刻意用默认全文扫描、**不要写自定义提取器**：@unocss/core 会把默认提取器
强插队首（除非 `extractorDefault: false`），自定义提取器从未生效过；而真关掉默认
提取器，三元/模板串里的条件类会静默丢失（比死类可怕）。全文扫描的代价是死类——
源码里恰好长得像工具类的词（`"m1"` 数据 key、注释里的「fixed 条」）会生成无人
引用的规则，**无害，不要追杀**。

无 preflight 的连带代价：`border-b` 只出宽度不出 style，div 默认 `border-style: none`
边框会隐身——**写边框必须带 `border-solid`**（如 `border-b border-solid border-line`）。

`--fp-*` CSS 变量（`uno.config.ts` 的 preflight 从 theme.ts 全量输出）是手写 CSS
（`app/styles/*.css`）共享 token 的唯一通道，别在 CSS 里写字面量色值。

样式书写规约见「代码风格」节的「新增样式优先 UnoCSS 工具类」。

### 依赖 canvas/DOM 的库必须懒加载

`@ant-design/charts` 底层 G2 依赖 canvas，SSR 渲染出空内容会导致 hydration 报
`Cannot read properties of null (reading 'useContext')`（看着像 React 装了两份，其实不是）。

`app/components/NavChart.tsx` 是正确范式：`lazy()` + `useSyncExternalStore` 判断是否在客户端，
SSR 与加载期间渲染同一个骨架屏。以后引入任何依赖 canvas/window/document 的库照此处理。

### TypeScript 6 与 7 并存

`typescript-eslint` 不支持 TS 7（会直接抛错）。按微软官方方案做了双别名：

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

`@typescript/native` 提供 `tsc`（typecheck 用），`typescript` 提供 TS 6 的 API（eslint 用）。

**不要把 `typescript` 直接升到 7**，会把 lint 弄挂。TS 7 已移除 `baseUrl`，`tsconfig.json`
只用 `paths`。

### vite.config.ts 必须开 resolve.tsconfigPaths

否则 workerd 运行时找不到 `~/db/schema`——**构建阶段不报错，只在运行时炸**。

### 改了 database_id 要重跑本地迁移

miniflare 按 `database_id` 哈希本地数据库文件名，改 id 会切到全新空库，
报 `Failed query: select ... from "session"`。跑 `pnpm db:migrate:local` 建表。

### 网络环境

`.npmrc` 指向淘宝镜像。**GitHub 与 npm 官方源在本机不通**（除非开代理），所以：

- 不要用 `pnpm create cloudflare` / `create-react-router` 等要拉 GitHub 模板的脚手架
- 配置文件全部手写

`pnpm-workspace.yaml` 的 `allowBuilds` 放行了 `esbuild`/`workerd`/`simple-git-hooks`
的 postinstall（不放行则二进制不下载、git 钩子装不上）。`trustPolicyExclude`
豁免了 `semver@6.3.1`（pnpm 误判，考证见 `docs/development.md`）。

## 代码风格

`@antfu/eslint-config`，**双引号 + 分号 + 2 空格缩进**。

**代码需要加合理的中文注释。**

### 新增样式优先 UnoCSS 工具类（2026-09-08 起的规约）

新增样式一律优先工具类，**不要再新增内联 `style={{}}`、不新建 CSS 文件**：

| 场景                        | 写法                                          | 例                                                                                                                                     |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 静态样式                    | 工具类                                        | `style={{ fontSize: 12, color: COLOR.textSecondary }}` → `className="text-xs text-muted"`                                              |
| token 色                    | 主题类（uno.config 从 theme.ts 全量映射）     | `text-ink` `text-muted` `text-rise` `text-fall` `text-flat` `bg-card` `bg-page` `border-line` `bg-primary-bg` `font-num` `shadow-card` |
| 有限值域动态                | 条件类（分支互斥，别让同类属性两分支同挂）    | `style={{ color: pnlColor(v) }}` → `className={v > 0 ? "text-rise" : v < 0 ? "text-fall" : "text-flat"}`                               |
| 连续值动态                  | 仍允许内联（构建期系统数不出无限个值）        | `style={{ width: `${pct}%` }}`                                                                                                         |
| 覆盖 antd 内部类 / 媒体查询 | 仍走 `app/styles/*.css`，色值用 `var(--fp-*)` | `.ant-card-body` 覆盖、responsive.css                                                                                                  |

- 颜色不写裸值（`text-[#8a9099]` 禁用），一律主题类；页面局部装饰色（如排行榜金银铜）可用任意值
- `theme.ts` 加新 token 时**必须同步** `uno.config.ts` 的 theme 映射
- 写边框必须带 `border-solid`（原因见「已知陷阱」）
- `text-xs` 这类字号类会连 line-height 一起设（Tailwind 惯例）；要保留原行高用 `text-[12px]`
- 设计系统组件（`app/components/ui/`）存量内联不强制迁移；新写的尽量用类
- 范本：`app/routes/leaderboard.tsx`（四类场景一页全有）

git 钩子（simple-git-hooks）：`pre-commit` 对暂存文件跑 `eslint --fix` 并重新 stage；
`pre-push` 跑 `typecheck` + `test`。紧急绕过用 `--no-verify`。

### 提交粒度

**一个 Task 一个 commit——不要比这更细。**
`.superpowers/plans/` 里每个 Task 末尾自带 commit 步骤，照它执行即可，但：

- **code review 的修正合并进该 Task 自己的 commit**（`git commit --amend`），
  或攒够一批再提一条。**绝不要一条注释一个 commit。**
- **「计划写错了 → 改计划 → 再实现」不要拆成两条。**
  计划修订跟实现代码走同一个 commit。

踩过"一天几十条 commit、其中大量只动 `docs/`"的坑，勿重蹈。

已定向豁免的规则及理由见 `eslint.config.js`：Worker 里 `console` 是唯一日志手段；
路由模块必须混合导出 loader/action 与组件。

## 交易日历需每年更新

`app/domain/trading-calendar.ts` 的 `CN_HOLIDAYS` 是硬编码节假日表，每年需人工更新。
**消费方有两处**：撮合（`resolveConfirmDate` 算 T+1 确认日）与定投（`nextRunDate`
算下次执行日——2026-09-07 起定投执行日也校准到交易日，周末/节假日不再下单）。
表漏了某天会导致定投在该日多生成一单（会在下个交易日被撮合）。
兜底：撮合时把 `fund_nav` 的净值日期序列作为 `knownTradingDays` 传入——
有净值的那天必然是交易日，可反向校正遗漏（定投的 `nextRunDate` 目前未接
knownTradingDays，纯靠节假日表）。

## 上线流程

改动要上线（push / 建 PR / 合并）时，**先读 `docs/release-workflow.md` 并严格照办**：
分支纪律（绝不在 main 直接提交、内容命名的专题分支）、本地两套测试全绿才能 push、
CodeRabbit 评审处理方式、合并即自动部署的完整规约都在里面。

## 文档

**给人看的（长期有效，改动相关代码前该读）：**

- 部署指南 `docs/deployment.md`（含免费版额度分析，**KV 写入 1000 次/天是最紧的一环**）
- 国内访问优化 `docs/china-access.md`（诊断证据、SaaS 优选 IP 施工图；`/` 与
  `/master` 的游客视图走 `workers/app.ts` 的边缘缓存，排障看 `x-fp-cache` 头）
- 开发指南 `docs/development.md`（踩坑记录的完整版）

**设计文档 `.superpowers/specs/`（记录「为什么这样设计」，git diff 答不出的那部分）：**

> 2026-09-07 起 specs/plans 与后续所有规划类文档均存放于 `.superpowers/`
> （目录自带 `.gitignore` 自忽略），**纯本地工作文档，一律不入库**。

- `2026-08-24-fund-simulator-design.md` —— 金融内核与三层架构的决策依据
- `2026-08-25-alipay-style-refactor-design.md` —— 支付宝式视觉重构

**实施计划 `.superpowers/plans/`（是当时的施工图，不是现状描述）：**

进度**只看各计划文件标题下的状态戳**，不要看复选框（历史上从未勾过，全空
不代表没做，勿照此重新施工）。一期收尾必须补盖状态戳，且**必须盖在
`For agentic workers` 之前**（那行是施工指令，戳晚一行，接手的人就先读到
「照此逐 Task 施工」了）。格式与作废段落写法见任一已完成计划的开头。
