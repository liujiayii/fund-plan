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

注意**不要加 `--`**：`pnpm test -- tests/x.test.ts` 会被 pnpm 当成字面参数传成
`vitest run "--" "tests/x.test.ts"`，过滤失效、静默跑全部测试。

`vitest.config.ts` 只 include `tests/domain/**` 与 `tests/smoke.test.ts`，
`vitest.workers.config.ts` 只 include `tests/db/**` 与 `tests/services/**`。
用错配置会报 `No test files found`（并打出 include 范围），照提示换命令即可。

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

### 权限模型

`app/services/guard.ts`。admin **没有独立后台**——主理人的 `/me` 就是被公开的那个盘，
`/master` 只是它的只读镜像，两者共用 `app/components/PortfolioView.tsx`。
admin 由环境变量 `ADMIN_USERNAME` 认定（`wrangler.jsonc` 的 `vars`）。

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

### UnoCSS 走 CLI 预生成，不是 Vite 插件

**不是 UnoCSS 不支持 Vite 8** —— 裸 Vite 8 + `unocss/vite` 完全正常（已实测）。
真正的原因是 **UnoCSS 的 Vite 插件与 React Router 8 的 Vite Environment API 不兼容**。

React Router 8 framework mode 构建时会输出 `Using Vite Environment API`，把流水线拆成
`client` / `ssr` 多个环境。UnoCSS 的 `unocss:global:build:generate` 要去当前环境的插件容器里
找 `vite:css-post` 注入生成的 CSS，多环境下找不到，于是：

```
[plugin unocss:global:build:generate] [unocss] failed to find vite:css-post plugin
```

**构建只报这一行警告就"成功"了**，但产物 CSS 只剩 48 字节占位符
（`#--unocss--{layer:__ALL__}`），所有工具类静默丢失。PostCSS 模式则会让构建挂死。

> 纯 SPA 项目（`@vitejs/plugin-react`，单环境构建）不受此影响，可正常用 `unocss/vite` 插件。

所以 `dev`/`build` 前会跑 `pnpm uno:build` 生成 `app/uno.gen.css`（该文件**入库**，不要手改）。
改了 class 后样式没生效，先确认这步跑过。

两个配置必须保持关闭（`uno.config.ts`）：

- `preflights.reset: false` —— UnoCSS 的全局重置会冲掉 antd 自带的重置
- **不启用 `presetAttributify`** —— 会把 antd 的 `color="red"`、`align="middle"` 等 props
  误当工具类生成污染规则

约定：UnoCSS 只写布局与间距，颜色/圆角/阴影走 antd 主题 token。

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
的 postinstall（不放行则二进制不下载、git 钩子装不上）。
`trustPolicyExclude` 豁免了 `semver@6.3.1`（已核实为 pnpm 误判：该版本发布于 2022-01，
早于 npm provenance 机制推出的 2023-04，不可能有当时不存在的签名）。

## 代码风格

`@antfu/eslint-config`，**双引号 + 分号 + 2 空格缩进**。

**代码需要加合理的中文注释。**

git 钩子（simple-git-hooks）：`pre-commit` 对暂存文件跑 `eslint --fix` 并重新 stage；
`pre-push` 跑 `typecheck` + `test`。紧急绕过用 `--no-verify`。

### 提交粒度

**一个 Task 一个 commit——不要比这更细。**
`docs/superpowers/plans/` 里每个 Task 末尾自带 commit 步骤，照它执行即可，但：

- **code review 的修正合并进该 Task 自己的 commit**（`git commit --amend`），
  或攒够一批再提一条。**绝不要一条注释一个 commit。**
- **「计划写错了 → 改计划 → 再实现」不要拆成两条。**
  计划修订跟实现代码走同一个 commit。

反面教材（2026-08-25，一天 58 个 commit，其中 22 个只动 `docs/`）：
`c10b8b2` `b7b5f7b` `9eb5676` `d037b5e` 四连击，每条只改了一句注释。

已定向豁免的规则及理由见 `eslint.config.js`：Worker 里 `console` 是唯一日志手段；
路由模块必须混合导出 loader/action 与组件。

## 交易日历需每年更新

`app/domain/trading-calendar.ts` 的 `CN_HOLIDAYS` 是硬编码节假日表，每年需人工更新。
兜底：撮合时把 `fund_nav` 的净值日期序列作为 `knownTradingDays` 传入——
有净值的那天必然是交易日，可反向校正遗漏。

## 文档

**给人看的（长期有效，改动相关代码前该读）：**

- 部署指南 `docs/deployment.md`（含免费版额度分析，**KV 写入 1000 次/天是最紧的一环**）
- 开发指南 `docs/development.md`（踩坑记录的完整版）

**设计文档 `docs/superpowers/specs/`（记录「为什么这样设计」，git diff 答不出的那部分）：**

- `2026-08-24-fund-simulator-design.md` —— 金融内核与三层架构的决策依据
- `2026-08-25-alipay-style-refactor-design.md` —— 支付宝式视觉重构

**实施计划 `docs/superpowers/plans/`（是当时的施工图，不是现状描述）：**

| 计划                                        | 状态                                    |
| ------------------------------------------- | --------------------------------------- |
| `2026-08-24-fund-simulator.md`              | 已完成 `26d645b..7cd59b5`               |
| `2026-08-25-phase1-visual-foundation.md`    | 已完成 `669ec88..64fa866`               |
| `2026-08-26-phase2-asset-timeline.md`       | Task 1–5 已落地，Self-Review 待走       |
| `2026-08-26-phase3-trading-experience.md`   | 已完成 `89075ce..25e3f4b`               |
| `2026-08-26-phase4-discovery-and-detail.md` | 已完成 `5f74dcf..2d59b74`               |
| `2026-08-28-phase5-mobile-adaptation.md`    | 已完成 `80850fb..d033b2e`，人工验收已过 |

### 计划文档完工后必须盖状态戳

计划里的复选框**从来没被勾过**（252 个全空），所以**别拿勾选框判断进度**。
一个阶段收尾时，在计划文件**标题的下一行、`For agentic workers` 那行之前**补一段：

```text
> ## 状态：已完成 · YYYY-MM-DD
>
> 实现区间 `<起>..<止>`
>
> - **下方复选框全部未勾，但工作已完成。** 别把「未勾」读成「未做」，勿照此重新施工。
> - ⚠️ 作废段落：<哪个 Task 的什么规格已被 revert，以及正确结论是什么>
```

**必须盖在 `For agentic workers` 之前**——那行写着「照此逐 Task 施工」，
戳晚一行，接手的人就先读到施工指令了。

计划里含已 revert 的内容时尤其要写清：**过期的施工图比没有图更危险。**
