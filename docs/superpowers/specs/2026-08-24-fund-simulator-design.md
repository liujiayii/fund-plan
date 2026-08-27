# 模拟基金购买 / 定投系统 —— 设计文档

- **日期**: 2026-08-24
- **状态**: 已批准，待转实施计划
- **作者**: 主理人 & Claude

---

## 1. 产品定位

一个部署在 Cloudflare 全家桶（免费版）上的**模拟基金交易系统**。核心卖点：

- **玩真的**：用真实基金数据（东方财富/天天基金公开接口）、真实 T+1 撮合规则、真实赎回费率阶梯。
- **模拟盘 + 围观大佬**：管理员（主理人）的组合完全公开，游客不登录即可围观其持仓、定投、交易流水与收益曲线；普通用户注册后拥有自己独立的钱包、持仓与定投，同时也能围观主理人的盘。
- **每日签到领本金**：靠签到激励用户每天回访，与定投节奏契合。

### 用户身份与权限矩阵

| 身份                  | 看主理人组合            | 看自己组合 | 下单 / 定投 / 签到 |
| --------------------- | --------------------- | ---------- | ------------------ |
| 游客（未登录）        | ✅ 只读（全部公开）   | —          | ❌                 |
| 普通用户（user）      | ✅ 只读               | ✅ 读写    | ✅（仅自己的）     |
| 管理员（admin，主理人） | ✅ 读写（即自己的盘） | 同上       | ✅                 |

> admin 不需要独立后台：主理人的 `/me` 就是被公开的那个盘，`/master` 只是它的只读公开镜像。一份代码，两种身份。

---

## 2. 技术选型

均在 Cloudflare 免费版覆盖范围内。

| 层        | 选型                                                      | 理由                                                            |
| --------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| 框架      | **React Router v7**（framework mode，Remix 继任者）+ Vite | 用户指定生态；Cloudflare 一等公民，官方模板齐全                 |
| 运行时    | **Cloudflare Workers**                                    | 免费版 10 万请求/天                                             |
| UI        | **Ant Design v5** + **@ant-design/charts**                | 净值/收益曲线用官方图表，风格统一                               |
| 数据库    | **Cloudflare D1**（SQLite）                               | 交易/持仓/流水天生关系型；免费 5GB、500 万行读/天、10 万行写/天 |
| ORM       | **Drizzle ORM**                                           | D1 支持最好、类型安全、迁移方便                                 |
| 缓存      | **Cloudflare KV**                                         | 缓存基金列表/净值，降低对东财接口的压力                         |
| 定时      | **Cron Triggers**                                         | 免费版支持，跑定投扫描 + 每晚净值同步撮合                       |
| 校验/工具 | **Zod + dayjs + decimal.js**                              | 金额用 decimal 防浮点，日期算交易日                             |
| 密码哈希  | **PBKDF2（Web Crypto）**                                  | Workers 跑不了 bcrypt/argon2 原生模块；高迭代次数 + 随机盐      |
| 测试      | **Vitest + @cloudflare/vitest-pool-workers**              | 在真实 Workers 运行时里跑，用真的 D1                            |

### 关键技术约束（免费版踩坑记录）

- 🔐 **密码哈希只能用 PBKDF2**：bcrypt/argon2 是原生模块，Workers 不支持。
- 📧 **免费版无法发邮件**：CF 自身不提供 SMTP，MailChannels 免费通道已关闭。故注册**只用用户名 + 密码**，不碰邮箱验证。忘密码由管理员手动重置。
- ⏰ **Cron 用 UTC**：所有定时表达式按 UTC 书写，注释标注对应北京时间。
- 🌐 **实时盘中估值接口（fundgz）从服务器直连被挡**（返回 404），但不影响撮合——T+1 用当日**收盘净值**。盘中估值为可选锦上添花项，用移动端接口替代或暂缓。

---

## 3. 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  展示层  React Router routes + antd                        │
│  首页 / 主理人组合 / 基金搜索 / 基金详情 / 我的仪表盘 /          │
│  持仓 / 订单 / 定投 / 设置 / 登录注册                         │
├─────────────────────────────────────────────────────────┤
│  应用层  loaders & actions（读写编排、鉴权、会话）            │
├─────────────────────────────────────────────────────────┤
│  领域层（纯函数，重点单元测试覆盖）                            │
│   • 撮合引擎 matching-engine：申购内扣 / FIFO 赎回 / 费率      │
│   • 交易日历 trading-calendar：T+1 / 节假日 / 确认日          │
│   • 定投调度 dca-scheduler：到期计算 / 下单                   │
│   • 组合估值 portfolio：持仓市值 / 收益率 / 年化              │
│   • 签到 checkin：连签 / 奖励计算                            │
├─────────────────────────────────────────────────────────┤
│  数据接入层  fund-data：封装东财接口 + KV 缓存 + 容错兜底      │
├─────────────────────────────────────────────────────────┤
│  持久层  D1 + Drizzle                                      │
├─────────────────────────────────────────────────────────┤
│  调度层  Cron：① 每日定投扫描  ② 每晚净值同步 & 撮合确认       │
└─────────────────────────────────────────────────────────┘
```

**设计原则**：领域层是不依赖 D1/网络的纯函数，输入输出都是普通对象，可脱离运行时单测。应用层负责把 D1 数据喂给领域层、把结果写回。

---

## 4. 数据模型（D1 + Drizzle，共 10 张表）

### 精度铁律（金融系统核心）

| 数据 | 存储方式                     | 说明                |
| ---- | ---------------------------- | ------------------- |
| 金额 | **整数「分」**（×100）       | 全程整数入库        |
| 份额 | **整数**（×10000）           | 4 位小数余量        |
| 净值 | **整数**（×10000）           | 真实净值即 4 位小数 |
| 费率 | **整数「万分之」**（×10000） | 如 1.5% 存 150      |

中间运算一律用 `decimal.js`，最后四舍五入回整数入库。彻底杜绝浮点误差。

### 全局共享表（不属于任何用户，全站复用一份）

**`fund` — 基金档案**

```
code           TEXT PRIMARY KEY   -- 基金代码，如 000001
name           TEXT               -- 名称
type           TEXT               -- 类型（混合型/指数型…）
purchase_rate  INTEGER            -- 申购费率（万分之，优惠后）
redeem_tiers   TEXT(JSON)         -- 赎回费率阶梯 [{minDays,maxDays,rate}]
min_purchase   INTEGER            -- 起购金额（分）
risk_level     INTEGER            -- 风险等级 1-5
status         TEXT               -- 申购/赎回开放状态
updated_at     INTEGER            -- 元数据更新时间戳
```

**`fund_nav` — 历史净值**（撮合与画图的数据底座）

```
fund_code   TEXT
nav_date    TEXT                  -- YYYY-MM-DD
unit_nav    INTEGER               -- 单位净值 ×10000
acc_nav     INTEGER               -- 累计净值 ×10000
growth_rate INTEGER               -- 日涨跌率 ×10000（万分之）
PRIMARY KEY (fund_code, nav_date)
```

> 💡 划算之处：所有用户共用一份净值，东财接口对每只基金只拉一次。

### 用户维度表（每人一套）

**`user` — 用户**

```
id            INTEGER PRIMARY KEY AUTOINCREMENT
username      TEXT UNIQUE
password_hash TEXT                -- PBKDF2 派生
salt          TEXT                -- 随机盐
role          TEXT                -- 'admin' | 'user'
created_at    INTEGER
```

**`session` — 会话**

```
token      TEXT PRIMARY KEY       -- 随机令牌，存 httpOnly cookie
user_id    INTEGER
expires_at INTEGER
```

**`account` — 账户（每用户单例）**

```
user_id       INTEGER PRIMARY KEY
cash          INTEGER             -- 现金余额（分）
initial_cash  INTEGER             -- 初始本金（默认 10,000,000 = 10 万元）
total_checkin INTEGER             -- 累计签到入金（分）
created_at    INTEGER
```

**`share_lot` — 份额批次** ⭐（真实 T+1 阶梯赎回费的关键）

```
id          INTEGER PRIMARY KEY AUTOINCREMENT
user_id     INTEGER
fund_code   TEXT
shares      INTEGER               -- 该批剩余份额 ×10000
cost        INTEGER               -- 该批成本（分，含申购费）
confirm_date TEXT                 -- 确认日 YYYY-MM-DD（算持有天数）
order_id    INTEGER               -- 来源订单
```

> 每笔确认的申购生成一个批次；赎回时按 confirm_date 升序 **FIFO 逐批消耗**，按持有天数查阶梯费率。

**`holding` — 持仓汇总**（`share_lot` 的物化汇总，读得快）

```
user_id     INTEGER
fund_code   TEXT
total_shares INTEGER              -- 总份额 ×10000
total_cost   INTEGER              -- 总成本（分）
PRIMARY KEY (user_id, fund_code)
```

> 由撮合引擎在同一个 D1 batch 内与 `share_lot` 同步维护；配对账函数校验 Σshare_lot == holding（可单测）。

**`order` — 订单**（T+1 状态机）

```
id           INTEGER PRIMARY KEY AUTOINCREMENT
user_id      INTEGER
fund_code    TEXT
side         TEXT                 -- 'buy'(申购) | 'sell'(赎回)
status       TEXT                 -- 'pending' → 'confirmed' | 'failed'
source       TEXT                 -- 'manual' | 'dca'
amount       INTEGER              -- 申购金额（分）；赎回时为 null
shares       INTEGER              -- 赎回份额 ×10000；申购时为 null
place_date   TEXT                 -- 下单日
confirm_date TEXT                 -- 确认日（T+1 目标交易日）
deal_nav     INTEGER              -- 成交净值 ×10000（确认后回填）
deal_shares  INTEGER              -- 成交份额 ×10000（确认后回填）
deal_amount  INTEGER              -- 成交金额（分，确认后回填）
fee          INTEGER              -- 手续费（分，确认后回填）
fail_reason  TEXT                 -- 失败原因
created_at   INTEGER
```

**`dca_plan` — 定投计划**

```
id           INTEGER PRIMARY KEY AUTOINCREMENT
user_id      INTEGER
fund_code    TEXT
amount       INTEGER              -- 每期金额（分）
frequency    TEXT                 -- 'daily' | 'weekly' | 'monthly'
day_of_week  INTEGER              -- 周几（weekly，1-7）
day_of_month INTEGER              -- 每月几号（monthly，1-28）
status       TEXT                 -- 'active' | 'paused'
next_run     TEXT                 -- 下次执行日 YYYY-MM-DD
run_count    INTEGER              -- 已投期数
total_invested INTEGER            -- 累计投入（分）
created_at   INTEGER
```

**`transaction` — 资金账本**（只增不改，可对账）

```
id         INTEGER PRIMARY KEY AUTOINCREMENT
user_id    INTEGER
type       TEXT                   -- 'checkin' | 'buy' | 'sell' | 'fee' | 'init'
amount     INTEGER                -- 金额（分，正=入，负=出）
balance    INTEGER                -- 变动后余额（分，快照便于对账）
order_id   INTEGER                -- 关联订单（可空）
note       TEXT
created_at INTEGER
```

**`checkin` — 签到记录**

```
id           INTEGER PRIMARY KEY AUTOINCREMENT
user_id      INTEGER
checkin_date TEXT                 -- YYYY-MM-DD
reward       INTEGER              -- 奖励金额（分）
streak       INTEGER              -- 连续签到天数
UNIQUE (user_id, checkin_date)
```

---

## 5. 撮合引擎（领域层核心，纯函数）

### 申购（真实「内扣法」）

```
净申购金额 = 申购金额 ÷ (1 + 申购费率)
申购费用   = 申购金额 − 净申购金额
确认份额   = 净申购金额 ÷ 确认日单位净值
```

### 赎回（FIFO 逐批算费）

```
按 confirm_date 升序逐批消耗 share_lot：
  持有天数 = 确认日 − 该批 confirm_date
  该批费率 = 查赎回阶梯(持有天数)
  该批赎回金额 = 该批消耗份额 × 确认日净值
  该批赎回费   = 该批赎回金额 × 该批费率
到账金额 = Σ(该批赎回金额 − 该批赎回费)
```

**真实赎回费率阶梯**（默认，随基金档案可覆盖）：

| 持有天数      | 费率  |
| ------------- | ----- |
| < 7 天        | 1.5%  |
| 7 天 ~ < 1 年 | 0.5%  |
| 1 ~ < 2 年    | 0.25% |
| ≥ 2 年        | 0%    |

### T+1 时点规则

| 下单时机                        | 确认日         |
| ------------------------------- | -------------- |
| 交易日 15:00 前                 | 当日净值       |
| 交易日 15:00 后 / 周末 / 节假日 | 下一交易日净值 |

### 交易日历（零维护设计）

基础规则（周一~周五）+ 硬编码节假日表 + **用 `fund_nav` 中沪深 300 的净值日期序列反向校正**（有净值的那天必然是交易日）。节假日表每年更新一次，文档标注。

---

## 6. 签到奖励规则

- 基础奖励：**100 元/天**
- 连签递增：每多连签一天 **+50 元**
- 封顶：**500 元/天**（连签第 9 天起恒定 500）
- 断签：连续天数归零，重新从 100 元起
- 每日仅可签到一次（`checkin` 唯一约束保证）

> 数值可在配置常量集中调整。

---

## 7. 路由结构

### 公开（游客可见）

- `/` 首页 —— 主理人示范盘总览（总收益、持仓、收益曲线、最近操作）+ 注册引导
- `/master` 主理人组合详情（持仓 / 定投 / 交易流水 三 tab，全部公开）
- `/funds` 基金搜索
- `/funds/:code` 基金详情（净值曲线：1 月 / 3 月 / 1 年 / 全部）
- `/login`、`/register`

### 需登录

- `/me` 我的仪表盘（总资产、浮动盈亏、今日签到）
- `/me/holdings` 我的持仓（买入/赎回抽屉）
- `/me/orders` 我的订单（含 pending 状态）
- `/me/dca` 我的定投计划（增删改、暂停/启用）
- `/me/settings` 设置（重置本金等）

买入/赎回用抽屉（Drawer）唤起，不单开页面。

---

## 8. Cron 调度

| 任务            | 北京时间   | UTC 表达式    | 职责                                                                         |
| --------------- | ---------- | ------------- | ---------------------------------------------------------------------------- |
| 定投扫描        | 每日 10:00 | `0 2 * * *`   | 扫所有用户到期的定投计划 → 生成 pending 申购单、冻结现金                     |
| 净值同步 + 撮合 | 每日 20:30 | `30 12 * * *` | 拉当日净值入 `fund_nav` → 撮合所有 pending 单 → 转 confirmed、更新持仓与账本 |

**幂等性**：撮合任务对同一订单重复执行需安全（按 status 过滤 pending，已确认的跳过），防 Cron 重试导致重复成交。

---

## 9. 数据接入层（fund-data）

封装东财公开接口，全部走 KV 缓存 + 容错兜底：

| 用途              | 接口                                                           | 缓存                 |
| ----------------- | -------------------------------------------------------------- | -------------------- |
| 基金搜索          | `fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx`  | KV 1 天              |
| 历史净值          | `api.fund.eastmoney.com/f10/lsjz`                              | 入 `fund_nav` 表     |
| 基金费率/基本信息 | `fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation` | 入 `fund` 表         |
| 全量列表兜底      | `fund.eastmoney.com/js/fundcode_search.js`（3.1MB）            | KV，搜索接口挂时兜底 |

接口失败时：优先用缓存/DB 已有数据，撮合任务若当日净值拉取失败则订单保持 pending 顺延至下个交易日，并记录日志。

---

## 10. 测试策略

- **框架**：Vitest + `@cloudflare/vitest-pool-workers`（真实 Workers 运行时 + 真 D1）。
- **TDD**：按用户规范先写测试。
- **领域层重点覆盖**（纯函数，易测）：
  - 申购内扣法计算
  - FIFO 赎回逐批阶梯费
  - 交易日历 / T+1 确认日
  - 定投到期计算（日/周/月）
  - 收益率 / 年化
  - 签到连签奖励
  - `holding` / `share_lot` 对账一致性
- **应用层集成**：注册登录、下单→撮合全链路、Cron 幂等。

---

## 11. 明确排除项（YAGNI）

- ❌ 收益率排行榜（后期可平滑加，需快照表 + 结算任务）
- ❌ 邮箱验证 / 邮件找回密码（免费版发邮件受限）
- ❌ 盘中实时估值（可选，后期锦上添花）
- ❌ 独立管理后台（admin 复用 `/me`）

---

## 12. 关键决策速查

| 决策       | 结论                                  |
| ---------- | ------------------------------------- |
| 数据源     | 真实数据（东财公开接口）              |
| 用户体系   | 注册登录；游客/用户可看 admin 公开盘  |
| admin 认定 | 环境变量 `ADMIN_USERNAME` 指定        |
| 定投执行   | Cron 定时真实执行                     |
| 撮合规则   | 真实 T+1、内扣申购费、FIFO 阶梯赎回费 |
| 本金       | 初始 10 万 + 每日签到                 |
| 卖出       | 支持                                  |
| 图表       | @ant-design/charts                    |
| 精度       | 金额存整数分、份额/净值存整数 ×10000  |
| 排行榜     | 暂不做                                |
