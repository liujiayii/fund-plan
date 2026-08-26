# 模拟基金定投系统 实施计划

> ## 状态：已完成 · 2026-08-25
>
> 实现区间 `26d645b..7cd59b5` —— Phase 0–6 全 26 个 Task 均已落地。
>
> - **下方复选框全部未勾，但工作已完成。** 本计划按 commit 跟踪进度，不靠勾选框。
>   别把「未勾」读成「未做」，更不要照此重新施工。
> - ⚠️ **本文是当时的施工图，不是现状描述。** 已知计划外偏离：UnoCSS（CLI 预生成）
>   在 `019b211` 才引入，本文 Tech Stack 一节没有它。**现状一律以 `CLAUDE.md` 为准。**
> - 后续演进：[期一 · 视觉地基](2026-08-25-phase1-visual-foundation.md)、
>   [期二 · 我的资产](2026-08-26-phase2-asset-timeline.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个部署在 Cloudflare 免费全家桶上的、完整可用的模拟基金购买/定投系统：真实东财数据、真实 T+1 撮合、注册登录、每日签到领本金、管理员公开示范盘。

**Architecture:** 三层洁净架构。领域层（`app/domain/`）是不依赖 D1/网络的纯函数（撮合、赎回、定投、签到、估值、交易日历），承担绝大部分单元测试；应用层（`app/services/` + React Router loaders/actions）把 D1 数据喂给领域层再写回；数据接入层（`app/services/fund-data.ts`）封装东财接口 + KV 缓存 + 容错兜底。持久层用 D1 + Drizzle。Cron 触发定投扫描与净值同步撮合。

**Tech Stack:** React Router v8 (framework mode) + Vite + Cloudflare Workers；Ant Design v6 + @ant-design/charts v2；Cloudflare D1 (SQLite) + Drizzle ORM；Cloudflare KV；Cron Triggers；Zod + dayjs + decimal.js；PBKDF2 (Web Crypto)；Vitest + @cloudflare/vitest-pool-workers。**包管理器：pnpm。**

**Spec:** `docs/superpowers/specs/2026-08-24-fund-simulator-design.md`

## Global Constraints

- **包管理器一律用 pnpm**，不用 npm。本项目 `.npmrc` 已指向淘宝镜像 `registry.npmmirror.com`，绕开被墙的 npmjs 官方源与 GitHub（实测 npmjs 5s 超时、GitHub 3s 超时，是此前一直 timeout 的根因）。
- **pnpm 必须放行构建脚本**：`package.json` 的 `pnpm.onlyBuiltDependencies` 含 `esbuild`、`workerd`，否则二进制不下载、vite/wrangler 跑不起来。
- **不使用 `pnpm create cloudflare`/`create-react-router` 脚手架**——它们要从 GitHub 拉模板会超时。全部手写配置文件。
- **精度铁律**：金额存整数「分」(×100)；份额存整数 (×10000)；净值存整数 (×10000)；费率存整数「万分之」(×10000)。中间运算一律 `decimal.js`，最后四舍五入回整数入库。严禁浮点直接入库。
- **代码需要加合理的中文注释**（用户全局要求）。
- **密码哈希只能用 PBKDF2**（Web Crypto，SHA-256，10 万次迭代，16 字节随机盐）：bcrypt/argon2 是原生模块，Workers 不支持。
- **不发邮件**：CF 免费版无 SMTP，注册只用「用户名 + 密码」，不做邮箱验证，忘密码由管理员手动重置。
- **Cron 用 UTC 书写**，注释标注对应北京时间：定投扫描 `0 2 * * *`（北京 10:00）、净值同步+撮合 `30 12 * * *`（北京 20:30）。
- **admin 认定**：环境变量 `ADMIN_USERNAME` 指定；admin 复用 `/me`，`/master` 是其只读公开镜像，无独立后台。
- **TDD**：先写失败测试，再写最小实现，每个任务自带 commit 点。
- **撮合幂等**：Cron 撮合按 `status='pending'` 过滤，已确认订单跳过，防重试重复成交。
- **初始本金**：10 万元（`initial_cash` 默认 10,000,000 分）+ 每日签到入金。
- **签到规则**：基础 100 元/天（10000 分），每多连签一天 +50 元（5000 分），封顶 500 元/天（50000 分），断签归零。
- **赎回默认阶梯**（万分之）：`<7 天 150`、`7~<365 天 50`、`365~<730 天 25`、`≥730 天 0`。
- **多表写入必须用 `db.batch()`** 原子提交（D1 无交互式事务）。

### 与 spec 的版本偏离（已确认兼容，实施时以本节为准）

| spec 原文       | 实际采用     | 原因                                                  |
| --------------- | ------------ | ----------------------------------------------------- |
| React Router v7 | **v8.3.0**   | 当前稳定大版本，framework mode API 与 v7 一致         |
| Ant Design v5   | **v6.6.1**   | 当前稳定大版本，peer 要求 react>=18，与 React 19 兼容 |
| —               | React 19.2.8 | antd6 / charts2 / RR8 均兼容                          |

> `@antv/graphin` 会报 peer 冲突（要求 react ^18），但它是关系图组件，本项目只画净值折线，**不引用即无影响**。

---

## 文件结构

```
app/
  root.tsx                      # HTML 骨架 + antd ConfigProvider(zhCN) + 全局导航
  routes.ts                     # 路由表（显式声明）
  entry.server.tsx              # SSR 入口 + antd cssinjs 样式提取
  routes/
    _index.tsx                  # 首页：主人示范盘总览 + 注册引导
    master.tsx                  # 主人组合详情（持仓/定投/流水 三 tab，公开只读）
    funds._index.tsx            # 基金搜索
    funds.$code.tsx             # 基金详情（净值曲线）
    login.tsx  register.tsx  logout.tsx
    me._index.tsx               # 我的仪表盘（总资产、浮盈、今日签到）
    me.holdings.tsx             # 我的持仓（买入/赎回抽屉）
    me.orders.tsx               # 我的订单（含 pending）
    me.dca.tsx                  # 我的定投计划
    me.settings.tsx             # 设置（重置本金等）
  domain/                       # 纯函数领域层（重点单测，不依赖 D1/网络）
    money.ts trading-calendar.ts purchase.ts redeem.ts
    dca.ts checkin.ts portfolio.ts config.ts types.ts
  db/
    schema.ts                   # Drizzle 表定义（10 张）
    client.ts                   # getDb(d1) 工厂
  services/                     # 应用层（依赖 D1/网络）
    fund-data.ts                # 东财接口 + KV 缓存 + 兜底
    auth.ts  session.ts         # PBKDF2 + 会话 cookie
    guard.ts                    # 鉴权（guest/user/admin）
    trade.ts                    # 下单（校验、扣现金、生成 pending 单）
    settle.ts                   # 净值同步 + 撮合确认（幂等）
    dca-service.ts              # 定投扫描
    checkin-service.ts          # 签到入金
    portfolio-service.ts        # 组合读取 + 估值编排
  components/                   # 复用 UI（净值图、持仓表、抽屉表单…）
workers/app.ts                  # Worker 入口：export default { fetch, scheduled }
drizzle/                        # 迁移 SQL（drizzle-kit generate 产物）
tests/
  domain/*.test.ts              # 领域层单测（纯函数）
  services/*.test.ts            # 应用层集成测（真实 D1）
wrangler.jsonc                  # CF 配置（D1/KV/Cron/vars 绑定）
vite.config.ts  vitest.config.ts  tsconfig.json  drizzle.config.ts
```

---

## Phase 0 — 基础设施

### Task 1: 项目脚手架（RR8 + CF Workers + Vite + antd + Vitest）

**Files:**

- Create: `vite.config.ts`、`react-router.config.ts`、`tsconfig.json`、`workers/app.ts`、`app/root.tsx`、`app/routes.ts`、`app/entry.server.tsx`、`app/routes/_index.tsx`、`wrangler.jsonc`、`vitest.config.ts`
- Modify: `package.json`（scripts + onlyBuiltDependencies）
- Test: `tests/smoke.test.ts`

**Interfaces — Produces:**

- `workers/app.ts` 默认导出 `{ fetch, scheduled } satisfies ExportedHandler<Env>`
- `Env` 接口（`DB: D1Database`、`KV: KVNamespace`、`ADMIN_USERNAME: string`），全项目共用

- [ ] **Step 1**: 装 dev 依赖：`pnpm add -D @react-router/dev @cloudflare/vite-plugin vite vitest @cloudflare/vitest-pool-workers typescript @types/react @types/react-dom drizzle-kit @ant-design/cssinjs`
- [ ] **Step 2**: 写 `vite.config.ts`（`reactRouter()` + `cloudflare()` 插件）、`react-router.config.ts`（`ssr: true`）、`tsconfig.json`（bundler resolution、jsx react-jsx、types 含 `./worker-configuration.d.ts`）
- [ ] **Step 3**: 写 `wrangler.jsonc`：`main: "./workers/app.ts"`、`compatibility_date`、`compatibility_flags: ["nodejs_compat"]`、D1 绑定 `DB`、KV 绑定 `KV`、`vars.ADMIN_USERNAME`、`triggers.crons`
- [ ] **Step 4**: 写 `workers/app.ts`：用 `createRequestHandler` 处理 `fetch`，`scheduled` 先留空壳（Task 17 接线）
- [ ] **Step 5**: 写 `app/root.tsx`（antd `ConfigProvider` + `zhCN` + 顶部导航骨架）、`app/routes.ts`、`app/routes/_index.tsx` 占位首页
- [ ] **Step 6**: 写 `tests/smoke.test.ts` 与 `vitest.config.ts`；`pnpm test` 通过
- [ ] **Step 7**: `pnpm dev` 能起服务、`pnpm build` 能产出。commit：`chore: 项目脚手架（RR8 + CF Workers + antd + Vitest）`

### Task 2: D1 + Drizzle schema + 迁移（10 张表）

**Files:** Create `app/db/schema.ts`、`app/db/client.ts`、`drizzle.config.ts`、`drizzle/*.sql`；Test `tests/db/schema.test.ts`

**Interfaces — Produces:**

```ts
// app/db/schema.ts —— 表对象（物理名 orders/transactions 规避 SQL 保留字）
export const fund, fundNav, user, session, account, shareLot, holding, orders, dcaPlan, transactions, checkin;
// app/db/client.ts
export function getDb(d1: D1Database): DrizzleD1Database<typeof schema>;
export type Db = ReturnType<typeof getDb>;
```

> ⚠️ **命名偏离**：spec 写 `order` / `transaction`，但两者都是 SQLite 保留字。物理表名改用 **`orders`** / **`transactions`**，语义不变。

- [ ] **Step 1**: 写 `schema.ts`：10 张表照 spec 第 4 节逐列定义；金额/份额/净值/费率全 `integer()`；`redeem_tiers` 用 `text({ mode: 'json' })`；`checkin` 加 `unique(user_id, checkin_date)`；每列加中文注释标注单位
- [ ] **Step 2**: 写 `drizzle.config.ts`（dialect `sqlite`、schema 路径、out `drizzle`）；跑 `pnpm drizzle-kit generate` 生成建表 SQL
- [ ] **Step 3**: 写 `client.ts` 的 `getDb`
- [ ] **Step 4**: 写 `tests/db/schema.test.ts`（workers pool + 真实 D1）：apply 迁移 → 插 `fund` + `fund_nav` → 查回断言字段一致 → 断言 `checkin` 唯一约束冲突会抛错
- [ ] **Step 5**: `vitest.config.ts` 接 `readD1Migrations` + `applyD1Migrations` setup；`pnpm test` 通过
- [ ] **Step 6**: commit：`feat: D1 schema 与迁移（10 张表）`

---

## Phase 1 — 领域层纯函数（TDD 重点）

> 本阶段全部是不依赖 D1/网络的纯函数，是金融正确性的护城河。每个任务都「先写失败测试 → 跑 → 最小实现 → 跑通 → commit」。

### Task 3: money.ts（精度与换算）

**Files:** Create `app/domain/money.ts`；Test `tests/domain/money.test.ts`

**Interfaces — Produces:**

```ts
export const YUAN = 100; export const SHARE_SCALE = 10000; export const NAV_SCALE = 10000; export const RATE_SCALE = 10000;
export function yuanToCents(yuan: number | string): number; // 元→分，四舍五入
export function centsToYuan(cents: number): string; // 分→元，展示 2 位
export function sharesToDisplay(shares: number): string; // 份额→展示 2 位
export function navToDisplay(nav: number): string; // 净值→展示 4 位
export function rateToPercent(rate: number): string; // 万分之→百分比字符串
export function multiplyCents(cents: number, ratio: Decimal.Value): number;
export function roundInt(v: Decimal.Value): number; // 统一四舍五入取整
```

- [ ] **Step 1**: 写测试：`yuanToCents('100.00') === 10000`；`yuanToCents(0.1 + 0.2) === 30`（浮点陷阱）；`centsToYuan(10000) === '100.00'`；`navToDisplay(12345) === '1.2345'`；`rateToPercent(150) === '1.50%'`；`multiplyCents(10000, '0.015') === 150`
- [ ] **Step 2**: 跑测试确认失败（模块不存在）
- [ ] **Step 3**: 用 `Decimal` 实现，统一 `ROUND_HALF_UP` 后 `.toNumber()`；加中文注释说明每个 scale 的含义
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): money 精度换算`

### Task 4: trading-calendar.ts（交易日历 / T+1 确认日）

**Files:** Create `app/domain/trading-calendar.ts`；Test `tests/domain/trading-calendar.test.ts`

**Interfaces — Produces:**

```ts
export const CN_HOLIDAYS: Set<string>; // 硬编码节假日 YYYY-MM-DD（每年需更新，注释标注）
export const CUTOFF_HOUR = 15; // 北京时间 15:00 分界
export function isTradingDay(date: string, knownTradingDays?: Set<string>): boolean;
export function nextTradingDay(date: string): string; // 严格之后的下一个交易日
export function resolveConfirmDate(placedAtUtc: Date, knownTradingDays?: Set<string>): string;
export function countDays(from: string, to: string): number; // 自然日差，用于持有天数
export function toBeijing(utc: Date): dayjs.Dayjs; // UTC → 北京时间
```

- [ ] **Step 1**: 写测试：`isTradingDay('2026-08-22') === false`（周六）；`isTradingDay('2026-01-01') === false`（元旦）；`nextTradingDay('2026-08-21') === '2026-08-24'`（周五→周一）；周五 14:00 北京下单 → 确认日=当日；周五 15:30 北京下单 → 确认日=下周一；`countDays('2026-01-01','2026-01-08') === 7`；传入 `knownTradingDays` 时以其为准
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：dayjs + UTC+8 偏移；15:00 cutoff 判断；周末 + `CN_HOLIDAYS` 过滤；`knownTradingDays`（来自沪深300 净值日序列）优先级最高。中文注释标注「节假日表每年更新」
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): 交易日历与 T+1 确认日`

### Task 5: purchase.ts（申购内扣法）

**Files:** Create `app/domain/purchase.ts`；Test `tests/domain/purchase.test.ts`

**Interfaces — Produces:**

```ts
export interface PurchaseInput { amountCents: number; navScaled: number; purchaseRate: number }
export interface PurchaseResult { netAmountCents: number; feeCents: number; sharesScaled: number }
export function calcPurchase(input: PurchaseInput): PurchaseResult;
```

公式（spec 第 5 节）：`净申购 = 申购金额 ÷ (1 + 费率)`；`费用 = 申购金额 − 净申购`；`份额 = 净申购 ÷ 确认日净值`

- [ ] **Step 1**: 写测试：申购 1000 元(100000 分)、费率 1.5%(150)、净值 1.5(15000) → `netAmountCents === 98522`、`feeCents === 1478`、`sharesScaled === 6568133`；断言 `netAmountCents + feeCents === amountCents`（一分不丢）；费率 0 时费用为 0 且份额=金额/净值
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: Decimal 实现，份额按 4 位小数（×10000）四舍五入。中文注释解释「内扣法」为何是除而非乘
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): 申购内扣法`

### Task 6: redeem.ts（FIFO 阶梯赎回费）

**Files:** Create `app/domain/redeem.ts`；Test `tests/domain/redeem.test.ts`

**Interfaces — Produces:**

```ts
export interface ShareLotInput { id: number; sharesScaled: number; costCents: number; confirmDate: string }
export interface RedeemTier { minDays: number; maxDays: number | null; rate: number } // rate 万分之
export interface RedeemInput { lots: ShareLotInput[]; redeemSharesScaled: number; navScaled: number; confirmDate: string; tiers: RedeemTier[] }
export interface RedeemLotResult { lotId: number; consumedSharesScaled: number; holdDays: number; rate: number; grossCents: number; feeCents: number; netCents: number; costCents: number }
export interface RedeemResult { lotResults: RedeemLotResult[]; totalGrossCents: number; totalFeeCents: number; totalNetCents: number; totalCostCents: number; realizedPnlCents: number }
export const DEFAULT_REDEEM_TIERS: RedeemTier[]; // <7:150, 7~<365:50, 365~<730:25, >=730:0
export function findRedeemRate(tiers: RedeemTier[], holdDays: number): number;
export function calcRedeem(input: RedeemInput): RedeemResult;
```

- [ ] **Step 1**: 写测试：
  - `findRedeemRate` 边界：0 天→150、6 天→150、**7 天→50**、364 天→50、365 天→25、730 天→0
  - 单批持有 3 天赎回 → 费率 1.5%
  - **跨两批 FIFO**：lot1(1000 份/成本 1500 元/2026-01-05) + lot2(500 份/成本 800 元/2026-08-01)，赎回 1200 份、净值 1.6、确认日 2026-08-20 → lot1 全耗(227 天/0.5%)、lot2 耗 200 份(19 天/0.5%)，`totalGrossCents === 192000`、`totalFeeCents === 960`、`totalNetCents === 191040`、`totalCostCents === 182000`、`realizedPnlCents === 9040`
  - 赎回份额小于首批 → 只部分消耗，`lotResults.length === 1`
  - 赎回份额超过总持仓 → 抛错
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：按 `confirmDate` 升序 FIFO 逐批消耗；每批 `holdDays = countDays(lot.confirmDate, confirmDate)` → `findRedeemRate` → `gross = 消耗份额 × 净值`、`fee = gross × rate`、`net = gross − fee`；消耗成本按份额比例摊。中文注释
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): FIFO 阶梯赎回费`

### Task 7: dca.ts（定投到期计算）

**Files:** Create `app/domain/dca.ts`；Test `tests/domain/dca.test.ts`

**Interfaces — Produces:**

```ts
export type Frequency = 'daily' | 'weekly' | 'monthly';
export interface NextRunInput { frequency: Frequency; dayOfWeek?: number | null; dayOfMonth?: number | null; from: string }
export function nextRunDate(input: NextRunInput): string; // 返回严格晚于 from 的下次执行日
```

- [ ] **Step 1**: 写测试：`daily` 从 2026-08-24 → `2026-08-25`；`weekly` dayOfWeek=1 从周一 2026-08-24 → `2026-08-31`（严格之后）；`weekly` dayOfWeek=3 从周一 → `2026-08-26`；`monthly` dayOfMonth=15 从 2026-08-24 → `2026-09-15`；`monthly` dayOfMonth=15 从 2026-08-10 → `2026-08-15`；跨年 12 月 → 次年 1 月
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: dayjs 实现，`dayOfMonth` 限制 1–28 规避 2 月问题（表单层同步限制）。中文注释
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): 定投到期计算`

### Task 8: checkin.ts（连签奖励）

**Files:** Create `app/domain/checkin.ts`；Test `tests/domain/checkin.test.ts`

**Interfaces — Produces:**

```ts
export const CHECKIN_BASE_CENTS = 10000; // 基础 100 元
export const CHECKIN_STEP_CENTS = 5000; // 每多连签一天 +50 元
export const CHECKIN_MAX_CENTS = 50000; // 封顶 500 元
export function calcCheckinReward(streak: number): number; // streak 为本次是第几天连签（1 起）
export function calcStreak(lastCheckinDate: string | null, lastStreak: number, today: string): number;
```

- [ ] **Step 1**: 写测试：`calcCheckinReward(1) === 10000`、`(2) === 15000`、`(9) === 50000`、`(20) === 50000`（封顶）；`calcStreak(null, 0, '2026-08-24') === 1`（首签）；`calcStreak('2026-08-23', 5, '2026-08-24') === 6`（昨天签过→续）；`calcStreak('2026-08-22', 5, '2026-08-24') === 1`（断签归零重来）
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现 `min(BASE + (streak-1)*STEP, MAX)`；`calcStreak` 用 `countDays` 判断是否恰好隔一天。中文注释说明「同日重复签到由 DB 唯一约束兜底」
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): 签到连签奖励`

### Task 9: portfolio.ts（组合估值 + 对账）

**Files:** Create `app/domain/portfolio.ts`；Test `tests/domain/portfolio.test.ts`

**Interfaces — Produces:**

```ts
export interface HoldingValuation { fundCode: string; sharesScaled: number; costCents: number; navScaled: number; marketValueCents: number; pnlCents: number; pnlRate: number }
export function valuateHolding(i: { fundCode: string; totalSharesScaled: number; totalCostCents: number; navScaled: number }): HoldingValuation;
export function valuatePortfolio(holdings: HoldingValuation[], cashCents: number):
{ totalAssetCents: number; marketValueCents: number; cashCents: number; totalPnlCents: number; totalPnlRate: number };
export function reconcile(lots: { sharesScaled: number; costCents: number }[], holding: { totalSharesScaled: number; totalCostCents: number }): boolean;
```

- [ ] **Step 1**: 写测试：1000 份(10000000)、成本 150000 分、净值 1.6(16000) → `marketValueCents === 160000`、`pnlCents === 10000`、`pnlRate` ≈ 0.0667；空持仓 `pnlRate === 0` 不除零；`valuatePortfolio` 总资产 = Σ市值 + 现金；`reconcile` 在 Σlot 与 holding 一致时 true、篡改一分即 false
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: Decimal 实现，`reconcile` 供撮合后自检。中文注释
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(domain): 组合估值与持仓对账`

---

## Phase 2 — 数据接入层

### Task 10: fund-data.ts（东财接口 + KV 缓存 + 容错兜底）

**Files:** Create `app/services/fund-data.ts`；Test `tests/services/fund-data.test.ts`

**Interfaces — Produces:**

```ts
export interface FundSearchItem { code: string; name: string; type: string }
export interface FundBasic { code: string; name: string; type: string; purchaseRate: number; minPurchaseCents: number; riskLevel: number; status: string }
export interface NavRow { navDate: string; unitNav: number; accNav: number; growthRate: number }
export function searchFunds(env: Env, keyword: string): Promise<FundSearchItem[]>;
export function fetchFundBasic(env: Env, code: string): Promise<FundBasic | null>;
export function fetchNavHistory(env: Env, code: string, pageSize?: number): Promise<NavRow[]>;
export function percentToRate(pct: string): number; // "1.50%"/"0.15" → 万分之整数
```

已验证可用的东财接口（spec 第 9 节）：

| 用途          | 接口                                                                                                                    | 缓存             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 基金搜索      | `fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=`                                                  | KV 1 天          |
| 历史净值      | `api.fund.eastmoney.com/f10/lsjz?fundCode=&pageIndex=1&pageSize=` (需 Referer `https://fundf10.eastmoney.com/`)         | 入 `fund_nav`    |
| 费率/基本信息 | `fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation?FCODE=&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8` | 入 `fund`        |
| 全量列表兜底  | `fund.eastmoney.com/js/fundcode_search.js`（3.1MB）                                                                     | KV，搜索挂时兜底 |

- [ ] **Step 1**: 写测试（用 `vi.stubGlobal('fetch', ...)` 注入固定响应，不打真网）：搜索返回解析出 code/name/type；`percentToRate('1.50%') === 150`、`percentToRate('0.15') === 15`；`fetchNavHistory` 把 `DWJZ:"1.2345"` 解析成 `unitNav: 12345`、`JZZZL:"0.53"` → `growthRate: 53`；接口抛错时 `searchFunds` 回退 KV 缓存而非崩溃
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：每个函数先查 KV → 未命中打接口 → 写 KV；`fetchNavHistory` 带 Referer 头；解析失败/网络异常统一 catch 并回退缓存，返回空数组而非 throw。中文注释标注每个接口的字段含义（FSRQ 净值日期、DWJZ 单位净值、LJJZ 累计净值、JZZZL 日涨跌率）
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): 东财数据接入 + KV 缓存与兜底`

---

## Phase 3 — 认证授权

### Task 11: PBKDF2 密码 + 注册/登录/会话

**Files:** Create `app/services/auth.ts`、`app/services/session.ts`；Test `tests/services/auth.test.ts`

**Interfaces — Produces:**

```ts
// auth.ts
export function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }>;
export function verifyPassword(password: string, hash: string, salt: string): Promise<boolean>;
export function registerUser(db: Db, env: Env, username: string, password: string): Promise<{ id: number; role: 'admin' | 'user' }>;
export function loginUser(db: Db, username: string, password: string): Promise<{ id: number; role: string } | null>;
// session.ts
export function createSession(db: Db, userId: number): Promise<string>; // 返回 token
export function readSession(db: Db, token: string): Promise<{ userId: number; role: string } | null>;
export function destroySession(db: Db, token: string): Promise<void>;
export function sessionCookie(token: string, maxAgeSec?: number): string; // httpOnly; Secure; SameSite=Lax
export function clearSessionCookie(): string;
```

- [ ] **Step 1**: 写测试（真实 D1）：同一密码 + 不同盐 → hash 不同；`verifyPassword` 正确密码 true、错误密码 false；`registerUser` 用户名重复抛错；用户名等于 `env.ADMIN_USERNAME` 时 `role === 'admin'`，否则 `'user'`；注册后自动建 `account` 且 `cash === 10000000`、写入一条 `type:'init'` 的 `transactions`；`createSession` → `readSession` 能取回；过期 token 返回 null
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：Web Crypto `PBKDF2`（SHA-256，100000 迭代，16 字节随机盐，导出 32 字节，hex 编码）；`crypto.randomUUID()` 作 session token；注册用 `db.batch()` 原子建 user + account + init 流水。中文注释说明「为何不用 bcrypt」
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): PBKDF2 认证与会话`

### Task 12: 鉴权中间件（guest / user / admin）

**Files:** Create `app/services/guard.ts`；Test `tests/services/guard.test.ts`

**Interfaces — Produces:**

```ts
export interface CurrentUser { id: number; username: string; role: 'admin' | 'user' }
export function getCurrentUser(request: Request, db: Db): Promise<CurrentUser | null>; // 无会话返回 null（游客）
export function requireUser(request: Request, db: Db): Promise<CurrentUser>; // 未登录 throw redirect('/login')
export function getAdminUser(db: Db, env: Env): Promise<CurrentUser | null>; // 按 ADMIN_USERNAME 查主人
```

- [ ] **Step 1**: 写测试：无 Cookie → `getCurrentUser` 返回 null；有效 Cookie → 返回用户；`requireUser` 无会话时抛出 302 到 `/login`；`getAdminUser` 按 `ADMIN_USERNAME` 找到主人、找不到返回 null
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现 Cookie 解析 + 会话查询；`requireUser` 抛 `redirect`。中文注释说明权限矩阵（游客只读主人盘 / 用户读写自己 + 只读主人 / admin 的 `/me` 即公开盘）
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): 鉴权与权限矩阵`

---

## Phase 4 — 应用层（交易与调度）

### Task 13: trade.ts（下单）

**Files:** Create `app/services/trade.ts`；Test `tests/services/trade.test.ts`

**Interfaces — Produces:**

```ts
export function placeBuyOrder(db: Db, env: Env, p: { userId: number; fundCode: string; amountCents: number; source?: 'manual' | 'dca'; now?: Date }): Promise<{ orderId: number }>;
export function placeSellOrder(db: Db, env: Env, p: { userId: number; fundCode: string; sharesScaled: number; now?: Date }): Promise<{ orderId: number }>;
```

- [ ] **Step 1**: 写测试（真实 D1）：买入金额 > 现金 → 抛「现金不足」；金额 < 起购 → 抛错；成功时 `orders` 落一条 `status='pending'`、`confirm_date` 由 `resolveConfirmDate` 决定、现金**立即扣减**并写 `transactions`；赎回份额 > 持仓 → 抛错；赎回不扣现金只落 pending 单
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：Zod 校验入参 → 查 `account`/`holding`/`fund` → 校验 → `db.batch()` 原子写 `orders` + 更新 `account.cash` + 写 `transactions`。中文注释说明「买入即冻结现金，避免超卖」
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): 下单（申购/赎回）`

### Task 14: settle.ts（净值同步 + 撮合确认，幂等）

**Files:** Create `app/services/settle.ts`；Test `tests/services/settle.test.ts`

**Interfaces — Produces:**

```ts
export function syncNav(db: Db, env: Env, fundCodes?: string[]): Promise<{ synced: number }>;
export function settlePendingOrders(db: Db, env: Env, now?: Date): Promise<{ confirmed: number; skipped: number; failed: number }>;
```

- [ ] **Step 1**: 写测试（真实 D1）：
  - 买单 pending + 已有确认日净值 → 转 `confirmed`，回填 `deal_nav/deal_shares/deal_amount/fee`，新增一条 `share_lot`，`holding` 累加，写 `transactions`
  - **幂等**：连续跑两次 `settlePendingOrders`，第二次 `confirmed === 0`、`share_lot` 不重复、`holding` 不翻倍
  - 确认日净值缺失 → 订单**保持 pending**（顺延），不报错
  - 卖单确认 → FIFO 消耗 `share_lot`、`holding` 递减、现金增加净额、`fee` 落账
  - 撮合后 `reconcile(lots, holding) === true`
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：`syncNav` 调 `fetchNavHistory` upsert 进 `fund_nav`；`settlePendingOrders` 只查 `status='pending'` 且 `confirm_date <= 今天` 的单，逐单查净值 → 买单走 `calcPurchase`、卖单走 `calcRedeem` → `db.batch()` 原子写回。中文注释强调幂等实现方式
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): 净值同步与 T+1 撮合（幂等）`

### Task 15: dca-service.ts（定投扫描）

**Files:** Create `app/services/dca-service.ts`；Test `tests/services/dca-service.test.ts`

**Interfaces — Produces:**

```ts
export function scanDcaPlans(db: Db, env: Env, now?: Date): Promise<{ triggered: number; skipped: number; failed: number }>;
export function createDcaPlan(db: Db, p: { userId: number; fundCode: string; amountCents: number; frequency: Frequency; dayOfWeek?: number | null; dayOfMonth?: number | null }): Promise<{ id: number }>;
export function toggleDcaPlan(db: Db, userId: number, planId: number, status: 'active' | 'paused'): Promise<void>;
export function deleteDcaPlan(db: Db, userId: number, planId: number): Promise<void>;
```

- [ ] **Step 1**: 写测试：`next_run <= 今天` 且 `status='active'` 的计划 → 调 `placeBuyOrder` 生成 pending 单、`run_count+1`、`total_invested` 累加、`next_run` 推进到下一期；`paused` 计划不触发；现金不足时该计划 `failed` 计数 +1 但**不阻塞其他计划**；`next_run` 在未来 → skipped；`toggleDcaPlan`/`deleteDcaPlan` 只能操作自己的计划（跨用户抛错）
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：逐计划 try/catch 隔离失败；用 `nextRunDate` 推进。中文注释
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): 定投计划与扫描`

### Task 16: checkin-service.ts（签到入金）

**Files:** Create `app/services/checkin-service.ts`；Test `tests/services/checkin-service.test.ts`

**Interfaces — Produces:**

```ts
export function doCheckin(db: Db, userId: number, today?: string): Promise<{ reward: number; streak: number; balance: number }>;
export function getCheckinStatus(db: Db, userId: number, today?: string): Promise<{ checkedToday: boolean; streak: number; nextReward: number }>;
```

- [ ] **Step 1**: 写测试：首签 → `reward === 10000`、`streak === 1`、`account.cash` +10000、`total_checkin` +10000、落一条 `type:'checkin'` 流水；**同日重复签到 → 抛错且余额不变**；连续第 2 天 → `reward === 15000`、`streak === 2`；断签后 → `streak` 回 1；`getCheckinStatus` 正确反映今日是否已签
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 实现：查最近一条 `checkin` → `calcStreak` → `calcCheckinReward` → `db.batch()` 原子写 `checkin` + `account` + `transactions`；靠唯一约束防重复。中文注释
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat(services): 每日签到入金`

### Task 17: Cron 入口接线

**Files:** Modify `workers/app.ts`；Test `tests/services/scheduled.test.ts`

**Interfaces — Produces:** `scheduled(controller, env, ctx)` 按 `controller.cron` 分派到 `scanDcaPlans` / `syncNav + settlePendingOrders`

- [ ] **Step 1**: 写测试：用 `cloudflare:test` 的 `env` 直接调 `worker.scheduled`，断言 `0 2 * * *` 触发定投扫描、`30 12 * * *` 触发净值同步+撮合；任一任务抛错被 catch 并记日志，不让整个 Cron 崩
- [ ] **Step 2**: 跑测试确认失败
- [ ] **Step 3**: 在 `workers/app.ts` 实现 `scheduled` 分派；`wrangler.jsonc` 填 `triggers.crons: ["0 2 * * *", "30 12 * * *"]`。中文注释标注 UTC↔北京时间对应关系
- [ ] **Step 4**: 跑测试通过
- [ ] **Step 5**: commit `feat: Cron 定投扫描与撮合接线`

---

## Phase 5 — UI（React Router 路由页）

> 每个 UI 任务的验收标准：`pnpm build` 通过 + `pnpm dev` 下页面可交互 + 关键 loader/action 有测试。

### Task 18: 布局 + 登录/注册/登出

**Files:** Create `app/routes/login.tsx`、`app/routes/register.tsx`、`app/routes/logout.tsx`、`app/entry.server.tsx`；Modify `app/root.tsx`、`app/routes.ts`

- [ ] **Step 1**: `entry.server.tsx` 做 antd cssinjs SSR 样式提取：`createCache()` + `<StyleProvider>` 包裹 → `renderToReadableStream` → `await stream.allReady` → 读成字符串 → `extractStyle(cache, true)` 注入 `</head>` 前。**避免样式闪烁**
- [ ] **Step 2**: `root.tsx`：antd `ConfigProvider`（`zhCN` + 主题色）+ `Layout` 顶栏导航（首页/主人的盘/基金/我的），根 loader 返回当前用户供导航态判断
- [ ] **Step 3**: `login.tsx` / `register.tsx`：antd `Form` + action 调 `loginUser`/`registerUser`，成功 `Set-Cookie` 并 redirect；失败用 `useActionData` 显示错误。`logout.tsx` action 销毁会话 + 清 Cookie
- [ ] **Step 4**: 写测试：注册 → 自动登录 → Cookie 生效；重复用户名报友好错误；错误密码报错
- [ ] **Step 5**: `pnpm build` 通过。commit `feat(ui): 布局与注册登录`

### Task 19: 基金搜索 + 基金详情（净值曲线）

**Files:** Create `app/routes/funds._index.tsx`、`app/routes/funds.$code.tsx`、`app/components/NavChart.tsx`

- [ ] **Step 1**: `funds._index.tsx`：搜索框 + antd `Table` 结果列表（代码/名称/类型/操作「查看」），loader 读 `?q=` 调 `searchFunds`
- [ ] **Step 2**: `funds.$code.tsx`：loader 调 `fetchFundBasic` + `fetchNavHistory`，首次访问顺便 upsert 进 `fund`/`fund_nav`；展示基本信息卡（费率/起购/风险等级/申赎状态）+ `NavChart`
- [ ] **Step 3**: `NavChart.tsx`：`@ant-design/charts` 的 `Line`，支持 1 月/3 月/1 年/全部 切换（`Radio.Group`）
- [ ] **Step 4**: 未登录也能看（公开页）；已登录显示「买入」按钮唤起抽屉（抽屉在 Task 21 复用）
- [ ] **Step 5**: commit `feat(ui): 基金搜索与详情净值曲线`

### Task 20: 我的仪表盘（总资产 + 签到）

**Files:** Create `app/routes/me._index.tsx`、`app/components/CheckinCard.tsx`、`app/components/AssetSummary.tsx`

- [ ] **Step 1**: loader：`requireUser` → 读 `account` + `holding` + 最新净值 → `valuatePortfolio`；读 `getCheckinStatus`
- [ ] **Step 2**: `AssetSummary`：antd `Statistic` 展示总资产/持仓市值/可用现金/累计盈亏（涨绿跌红按国内习惯用红涨绿跌）
- [ ] **Step 3**: `CheckinCard`：显示连签天数 + 今日可领金额 + 「签到」按钮（action 调 `doCheckin`，已签则禁用并提示明日奖励）
- [ ] **Step 4**: 写测试：签到 action 成功后余额增加；重复签到返回友好错误
- [ ] **Step 5**: commit `feat(ui): 我的仪表盘与每日签到`

### Task 21: 我的持仓 + 买入/赎回抽屉

**Files:** Create `app/routes/me.holdings.tsx`、`app/components/BuyDrawer.tsx`、`app/components/SellDrawer.tsx`、`app/components/HoldingTable.tsx`

- [ ] **Step 1**: loader：读持仓 + 最新净值 → `valuateHolding` 列表
- [ ] **Step 2**: `HoldingTable`：基金/份额/成本/市值/盈亏/盈亏率 + 操作列（加仓/赎回）
- [ ] **Step 3**: `BuyDrawer`：金额输入（元，提交时 `yuanToCents`）+ **实时预估**（内扣法算费用与份额，用当前净值试算并标注「以确认日净值为准」）+ 起购与余额校验
- [ ] **Step 4**: `SellDrawer`：份额输入 + 全部赎回快捷 + **预估赎回费**（按 FIFO 试算，展示各批持有天数与费率）
- [ ] **Step 5**: action 调 `placeBuyOrder`/`placeSellOrder`，成功 `message.success` 并提示「T+1 确认」
- [ ] **Step 6**: 写测试：买入 action 现金不足报错；赎回超持仓报错
- [ ] **Step 7**: commit `feat(ui): 持仓页与买入赎回抽屉`

### Task 22: 我的订单

**Files:** Create `app/routes/me.orders.tsx`

- [ ] **Step 1**: loader：分页读 `orders`（倒序），join `fund.name`
- [ ] **Step 2**: `Table` 列：下单日/基金/方向/状态(Tag：pending 橙、confirmed 绿、failed 红)/申购金额或赎回份额/成交净值/成交份额/手续费/确认日/来源(手动/定投)
- [ ] **Step 3**: pending 单显著提示「待 T+1 确认，将以确认日净值成交」；failed 单显示 `fail_reason`
- [ ] **Step 4**: commit `feat(ui): 订单列表`

### Task 23: 我的定投计划

**Files:** Create `app/routes/me.dca.tsx`、`app/components/DcaFormModal.tsx`

- [ ] **Step 1**: loader：读该用户 `dca_plan` 列表
- [ ] **Step 2**: `Table`：基金/每期金额/频率(日/周几/每月几号)/下次执行/已投期数/累计投入/状态/操作
- [ ] **Step 3**: `DcaFormModal`：新建/编辑；频率选 `daily|weekly|monthly` 联动显示 `dayOfWeek`/`dayOfMonth`（后者限 1–28）；创建时 `next_run` 由 `nextRunDate` 计算
- [ ] **Step 4**: 操作：暂停/启用（`toggleDcaPlan`）、删除（`deleteDcaPlan`，二次确认）
- [ ] **Step 5**: 写测试：创建计划 `next_run` 正确；暂停后扫描不触发
- [ ] **Step 6**: commit `feat(ui): 定投计划管理`

### Task 24: 首页 + 主人公开盘

**Files:** Create/Modify `app/routes/_index.tsx`、Create `app/routes/master.tsx`、`app/components/PortfolioView.tsx`

- [ ] **Step 1**: 抽 `PortfolioView` 组件（总资产卡 + 持仓表 + 收益曲线 + 最近操作），**同时被 `/me` 与 `/master` 复用**，通过 `readonly` prop 控制是否显示操作按钮
- [ ] **Step 2**: `_index.tsx`：loader 用 `getAdminUser` 取主人 → 读其组合 → 展示总收益概览 + 持仓 Top + 最近交易；未登录时显著「注册开始模拟」CTA，已登录显示「去我的盘」
- [ ] **Step 3**: `master.tsx`：三 tab（持仓 / 定投 / 交易流水），全部公开只读；游客直接可看
- [ ] **Step 4**: 写测试：游客（无 Cookie）访问 `/` 与 `/master` 返回 200 且含主人持仓数据；`/me` 无 Cookie 302 到 `/login`
- [ ] **Step 5**: commit `feat(ui): 首页与主人公开示范盘`

### Task 25: 设置页

**Files:** Create `app/routes/me.settings.tsx`

- [ ] **Step 1**: 展示账户信息（用户名、角色、注册时间、初始本金、累计签到入金）
- [ ] **Step 2**: 「重置模拟盘」危险操作：二次确认后清空该用户 `share_lot`/`holding`/`orders`/`dca_plan`/`transactions`，现金恢复 `initial_cash`，用 `db.batch()` 原子执行
- [ ] **Step 3**: 修改密码（旧密码校验 + 新密码 PBKDF2 重算）
- [ ] **Step 4**: 写测试：重置后现金等于 `initial_cash`、持仓为空；改密后旧密码失效新密码可登录
- [ ] **Step 5**: commit `feat(ui): 设置页与重置模拟盘`

---

## Phase 6 — 收尾

### Task 26: 部署配置与文档

**Files:** Create `README.md`、`docs/deployment.md`、`docs/development.md`、`.dev.vars.example`；Modify `wrangler.jsonc`、`package.json`

- [ ] **Step 1**: `package.json` scripts 齐活：`dev`、`build`、`deploy`、`test`、`typecheck`、`db:generate`、`db:migrate:local`、`db:migrate:prod`、`cf-typegen`
- [ ] **Step 2**: `docs/deployment.md`：创建 D1（`wrangler d1 create`）与 KV（`wrangler kv namespace create`）、把返回的 id 填进 `wrangler.jsonc`、`ADMIN_USERNAME` 设为主人用户名、跑生产迁移、`wrangler deploy`、验证 Cron 已注册
- [ ] **Step 3**: `docs/development.md`：pnpm + 淘宝镜像的由来（GitHub/npmjs 超时根因）、本地起 D1、跑测试、领域层精度约定、节假日表每年更新提醒
- [ ] **Step 4**: `README.md`：功能截图位、技术栈、快速开始、权限矩阵、免费版额度说明
- [ ] **Step 5**: 全量 `pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] **Step 6**: commit `docs: 部署与开发文档`

---

## 验收清单（完整可用的定义）

- [ ] 游客不登录能看首页与 `/master` 主人公开盘（持仓/定投/流水/曲线）
- [ ] 能注册 → 自动获得 10 万初始本金 → 登录
- [ ] 能搜真实基金、看真实净值曲线与真实费率
- [ ] 能买入（内扣法算费）、生成 pending 单、T+1 按确认日净值成交
- [ ] 能赎回（FIFO 阶梯费按持有天数分批计费）
- [ ] 能建定投计划（日/周/月），Cron 到期自动下单
- [ ] 每日签到领本金，连签递增、封顶、断签归零
- [ ] 订单/流水可追溯，`holding` 与 `share_lot` 对账一致
- [ ] Cron 重复执行不产生重复成交（幂等）
- [ ] `pnpm typecheck && pnpm test && pnpm build` 全绿
- [ ] 部署文档能让人从零跑通上线
