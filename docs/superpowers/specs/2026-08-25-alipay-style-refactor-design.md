# 支付宝式基金交易体验重构 —— 设计文档

> 2026-08-25 · 状态：待评审
> 前置文档：[`2026-08-24-fund-simulator-design.md`](./2026-08-24-fund-simulator-design.md)
>
> 本文只描述**前端体验与其所需的领域/服务能力**。撮合引擎、精度铁律、
> T+1 规则、权限模型一概不动 —— 那些在前置文档里已经定稿且有测试保护。

## 1. 背景与目标

现状问题有两个，且互为因果：

**视觉上**，主色是喜庆红 `#c62828`，而涨跌也用红绿。于是按钮、标签、进度条
全是红的，与「涨」的红撞在一起 —— 用户无法一眼区分「这是操作」和「这是赚钱」。
这是页面显得土且乱的**根本原因**，比间距和圆角重要得多。
支付宝的解法：主色让给品牌蓝，红绿**只**留给涨跌。

**功能上**，页面停留在「能跑通业务」的水平：**11 处**各写一遍 columns 的
antd `Table`（分布在 8 个文件）、一个孤零零的「浮动盈亏」数字（看不出时间线）、
硬编码 5 只基金充当「热门」、没有自选、没有单只持仓详情、订单只有一个状态 Tag。

目标：**在不动金融内核的前提下，把交易体验重做到支付宝基金那个档次。**

### 定位边界（已确认）

| 维度 | 决定 |
| ---- | ---- |
| 形态 | **桌面为主**，继续用 antd，不引入 antd-mobile、不做底部 Tab |
| 视觉 | 主色 `#1677FF`，红绿专职涨跌，白卡片 + 浅灰底 + 圆角 12 |
| 功能 | 四块全做：资产时间线、自选与发现、详情增强、交易体验 |
| 节奏 | 四期渐进，每期独立可 `pnpm verify` + commit + 部署 |

## 2. 设计原则

1. **抄交互结构，不抄像素。** 支付宝真正好的是信息层级：一个巨大的总资产、
   两个次级收益数字、一条走势线、然后才是持仓明细。照搬这个层级；
   不试图在桌面上复刻手机的尺寸与手势。
2. **先 domain 纯函数，再 service 接线，最后 UI。** 沿用既有硬约束。
   本次新增的两个计算（资产重放、阶段涨幅）都是纯函数 + node 单测。
3. **能从现有表推导的，绝不新建表。** 见第 5 节。
4. **每个外部接口都必须有降级路径。** 拉不到就不显示那张卡片，绝不白屏、
   绝不抛给上层。沿用 `fund-data.ts` 既定的三条铁律。
5. **共用组件先立后用。** 期一先把 `app/components/ui/` 这层立起来，
   后三期的页面直接消费；避免「先写页面、再回头抽组件」的返工。

## 3. 视觉体系

### 3.1 语义色 token

```ts
// app/theme.ts —— 唯一颜色出处
export const COLOR = {
  primary: "#1677FF", // 品牌 / 操作：按钮、链接、选中态、进度条
  up: "#F5222D", // 涨 / 收益为正
  down: "#00A870", // 跌 / 收益为负
  neutral: "#8C8C8C", // 平（0 或无数据）
  bg: "#F5F7FA", // 页面底色
  card: "#FFFFFF",
  border: "#EEF0F4",
  textPrimary: "#1F2329",
  textSecondary: "#8A9099",
} as const;

/** 涨红跌绿。收敛现在散落在 3 处的重复实现 */
export function pnlColor(v: number): string;
```

当前涨跌色在 7 个文件里硬编码了 **25 处**，其中 `pnlColor` 被**重复定义 3 次**
（`PortfolioView.tsx`、`me.holdings.tsx`、`me._index.tsx`，后两处还有
`undefined as unknown as string` 的类型硬拗）。
统一到 `app/theme.ts`，是期一必须完成的清理。

### 3.2 antd 主题 token

```ts
theme={{
  token: {
    colorPrimary: COLOR.primary,
    colorInfo: COLOR.primary,
    borderRadius: 8,
    colorBgLayout: COLOR.bg,
    colorTextSecondary: COLOR.textSecondary,
  },
  components: {
    Card: { borderRadiusLG: 12 },
    Layout: { headerBg: COLOR.card, bodyBg: COLOR.bg, footerBg: "transparent" },
    Menu: { itemBg: "transparent" },
  },
}}
```

**⚠️ 绝不要把 `colorSuccess` 映射成涨红、`colorError` 映射成跌绿。**
那会反向污染所有非金融语义：错误 `Alert` 变绿、成功 `Alert` 变红、
`<Tag color="success">` 变红。antd 的语义色保持原样（成功绿、错误红），
**涨跌只通过我们自己的 `COLOR.up` / `COLOR.down` / `pnlColor()` 表达**。
两套色系各管一摊，互不干涉。

数字排版用等宽字体栈，保证金额纵向对齐：
`"DIN Alternate", "SF Mono", ui-monospace, "Menlo", monospace`。

### 3.4 顺手降噪：少贴 Tag

现在订单行每条都贴「方向 + 来源 + 状态」三个 Tag，其中「手动」和「已确认」
都是**常态**，贴了等于没信息，只是噪音。重构后：

- 来源：只在 `dca` 时贴「定投」，手动不贴
- 状态：只在 `pending` / `failed` 时贴，已成交不贴
- 方向：申购用 `color="blue"`，赎回用默认色 —— 不占用红绿（红绿是涨跌的）

### 3.3 不变的约定

- UnoCSS **只写布局与间距**，颜色/圆角/阴影一律走 antd token 与 `COLOR`
- `uno.config.ts` 的 `preflights.reset: false` 与「不启用 `presetAttributify`」
  保持关闭（原因见 CLAUDE.md）
- 改了 class 记得 `pnpm uno:build`（`dev`/`build` 已自动前置）

## 4. 组件分层

```
app/components/ui/        ← 设计系统层：零业务依赖，只吃 props，可任意页面复用
  StatBig.tsx             大数字（标题 + 值 + 单位 + 可选副行）
  PnlText.tsx             涨跌数字（自动 +/− 号与配色，支持金额/百分比两态）
  SectionCard.tsx         统一卡片外壳（标题 + extra 链接 + 内容）
  DataRow.tsx             左标签右值的一行（取代 Descriptions 的滥用）
  FundListItem.tsx        基金行（左：名称/代码/类型；右：双行数值）
  PeriodTabs.tsx          时间范围切换（净值图、资产走势、阶段涨幅共用）
  EmptyState.tsx          统一空态（文案 + CTA 按钮）

app/components/           ← 业务组件：知道领域概念，可依赖 services 的类型
  HoldingList.tsx         持仓列表（收敛 4 处重复的 columns：PortfolioView / me._index / me.holdings）
  OrderList.tsx           订单列表（收敛 3 处：me.orders / me._index / master）
  DcaPlanList.tsx         定投计划列表（收敛 2 处：me.dca / master）
  TxList.tsx              资金流水列表（master）
  AssetTrendChart.tsx     资产走势曲线（lazy 范式，见 4.1）
  ProfitCalendar.tsx      收益日历（纯 div 格子，见 4.2）
  OrderTimeline.tsx       订单确认进度（下单 → 确认中 → 已成交）
  PeriodReturnTable.tsx   阶段涨幅表
  NavChart.tsx            保留，改为消费 ui/PeriodTabs
  BuyPanel.tsx            由 BuyDrawer 重构：大数字输入 + 费用预估
  SellPanel.tsx           由 SellDrawer 重构：份额滑块 + FIFO 分档费用明细
  PortfolioView.tsx       保留（公开盘与自己的盘共用），内部换成 ui/ 组件
```

**期一交付的是前 4 个列表组件 + `ui/` 全部 7 个**；后面那些属于期二至期四。

### 4.0 哪些 Table 该留

11 处 `Table` 里有 **1 处应当保留**：`SellDrawer.tsx:182` 的 FIFO 逐批费用明细。
它是真正的表格数据 —— 同维度（份额 / 天数 / 费率 / 费用）多行横向对比，
换成卡片反而更难读。只把它的字面色值换成 token，不改结构。

其余 10 处都是「实体列表」（持仓、订单、定投计划、流水、搜索结果），
横向 7~13 列靠 `scroll={{ x: 1100 }}` 撑着，是当前体验最差的地方，全部换卡片列表。

### 4.1 依赖 canvas 的图表一律照 NavChart 范式办

`AssetTrendChart` 用 `@ant-design/charts`，因此必须 `lazy()` +
`useSyncExternalStore` 判客户端 + SSR 与加载期渲染同一个骨架屏。
理由与踩坑记录见 CLAUDE.md「依赖 canvas/DOM 的库必须懒加载」。
**直接复制 `NavChart.tsx` 的结构，不要自创写法。**

### 4.2 收益日历刻意不用图表库

日历是纯布局问题（7 列网格 + 格子配色），用 `@ant-design/charts` 的 heatmap
会为此白背一个 canvas 依赖 + lazy 包装 + 骨架屏。
`ProfitCalendar` 用 `div` + CSS Grid 实现，可 SSR，零额外依赖。

格子配色：`dayPnlCents` 正 → `COLOR.up` 系，负 → `COLOR.down` 系，
深浅按当日收益率绝对值分 4 档（`≥1.5% / ≥0.8% / ≥0.3% / >0`），0 或无数据 → 灰。

## 5. 资产时间线：账本重放（本次核心）

### 5.1 决策：不建快照表

本可以加一张 `asset_snapshot` 表 + 每日收盘 cron。**但没必要** ——
所需信息现有表已经全部具备：

| 需要什么 | 从哪来 |
| -------- | ------ |
| 任意一天的现金余额 | `transactions` 只增不改，每行带变动后 `balance` 快照 |
| 任意一天的持仓份额 | `orders` 确认后回填 `dealShares` + `confirmDate`，累加即得 |
| 任意一天的净值 | `fund_nav` 的历史序列 |

于是 `总资产(D) = 现金(D) + Σ 份额(D) × 净值(D)` 可以**从账本重放出来**。

| | 快照表 + cron | 账本重放（本方案） |
| --- | --- | --- |
| 历史曲线 | 只能从上线日起，之前一片空白 | **立刻就有**，有多少净值就回溯多久 |
| 新增成本 | 1 表 + 1 迁移 + 1 cron + 每日写入 | 0 表 0 cron，一个 domain 纯函数 |
| 可测性 | 需起 D1 跑集成测试 | node 环境毫秒级单测 |
| 写入额度 | 吃 D1 写入 | 不吃 |

代价是每次渲染多查几张表。单用户几十条订单 + 几百天净值，D1 上无压力。
**资产走势曲线、收益日历、昨日收益三个功能共用同一份重放结果。**

> 何时该回头建快照表：要做**多用户收益率排行榜**时。那是跨用户预聚合，
> 逐个重放不划算。届时再加，属本次明确排除项。

### 5.2 `app/domain/asset-timeline.ts`（纯函数）

```ts
export interface ReplayInput {
  /** 参与重放的日期轴（升序），由 service 层取相关基金 nav_date 的并集 */
  dateAxis: string[];
  /** 现金账本：升序，每条为「该时刻变动后余额」 */
  cashLedger: { date: string; balance: number }[];
  /** 当日净入金（分）：仅 checkin / init 类型之和，按日聚合 */
  netDepositByDate: Map<string, number>;
  /** 已确认订单：升序，buy 加份额、sell 减份额 */
  confirmedOrders: {
    fundCode: string;
    side: "buy" | "sell";
    confirmDate: string;
    dealShares: number;
  }[];
  /** 各基金净值序列（升序） */
  navSeries: Map<string, { navDate: string; unitNav: number }[]>;
}

export interface DailyAsset {
  date: string;
  cashCents: number;
  marketValueCents: number;
  totalAssetCents: number;
  /** 当日收益（分），已扣除净入金 */
  dayPnlCents: number;
  /** 当日收益率 = dayPnlCents / 前一日总资产 */
  dayPnlRate: number;
}

export function replayDailyAssets(input: ReplayInput): DailyAsset[];
```

**算法（单趟扫描，O(天数 + 订单数)）**

沿 `dateAxis` 前进，维护三个游标：现金账本游标、订单游标、
`Map<fundCode, shares>` 持仓份额。每到一天：

1. 推进订单游标，把 `confirmDate === D` 的订单并入份额 Map（buy `+`，sell `−`）
2. 推进现金游标，取 `date ≤ D` 的最后一条 `balance` 作当日现金（**前向填充**）
3. 对份额 Map 每个非零条目，取该基金 `navDate ≤ D` 的最后一条净值
   （**前向填充**，覆盖非交易日、停牌、净值未同步）算市值
4. `totalAsset = cash + Σ marketValue`
5. `dayPnl = totalAsset(D) − totalAsset(D−1) − netDeposit(D)`

**⚠️ 第 5 步是整个功能的灵魂。** 日收益必须扣掉净入金：
签到领 500 元不是「今天赚了 500」。不扣的话，收益日历会在每个签到日
显示一个假的大红块，整个功能就废了。

而买入/赎回**不算**净入金 —— 那只是现金 ↔ 份额的形态转换，总资产不变。
其中的手续费是**真实亏损**，应当自然体现在 `dayPnl` 里（不做任何特殊处理，
因为现金减少了而份额没有等价增加，重放公式会自动算出这个亏损）。

所有中间运算走 `decimal.js`，最后 `roundInt()` 回整数（精度铁律）。

**日期轴来源**：service 层取相关基金 `fund_nav.nav_date` 的并集升序去重。
这天然就是交易日轴 —— 复用 CLAUDE.md 里「有净值的那天必然是交易日」
那个反向校正思路，不必依赖硬编码节假日表。

**边界情形**

| 情形 | 行为 |
| ---- | ---- |
| 纯现金无持仓的日子 | `marketValue = 0`，`totalAsset = cash`，扣净入金后 `dayPnl = 0` |
| D 早于该基金首条净值 | 此时份额必为 0（确认日必然有净值），跳过 |
| `dateAxis` 首日 | 无前一日，`dayPnl = 0`、`dayPnlRate = 0` |
| 前一日总资产为 0 | `dayPnlRate = 0`（避免除零） |
| 全部清仓后 | 曲线变成纯现金水平线，正确 |

### 5.3 `app/services/asset-service.ts`

职责：查数据 → 喂 `replayDailyAssets()` → 派生三个视图。

```ts
export async function getAssetTimeline(db: Db, userId: number): Promise<{
  daily: DailyAsset[];
  /** 最新净值日的日收益。⚠️ 页面必须标注日期，不能硬写「昨日」 */
  latest: DailyAsset | null;
}>;
```

**「昨日收益」的措辞**：净值同步有延迟（北京 20:30 的 cron 才拉当日净值），
所以 UI 标题写「**收益（截至 X 月 X 日）**」而非「昨日收益」。
支付宝也是标日期的。这不是抠字眼 —— 硬写「昨日」在净值没同步时就是错的。

## 6. 阶段涨幅：`app/domain/performance.ts`（纯函数）

```ts
export interface PeriodReturns {
  /** 均为万分之整数（沿用费率表示法），数据不足则 null */
  w1: number | null; // 近 1 周
  m1: number | null; // 近 1 月
  m3: number | null; // 近 3 月
  m6: number | null; // 近 6 月
  y1: number | null; // 近 1 年
  ytd: number | null; // 今年来
  all: number | null; // 成立来（区间内全部数据）
}

export function calcPeriodReturns(
  series: { navDate: string; unitNav: number }[], // 升序
): PeriodReturns;
```

以最后一条为 `end`；对每个周期按**自然日**回推目标日，取 `navDate ≤ 目标日`
的最后一条为 `start`（前向填充）；`收益 = (end − start) / start`。
YTD 取当年 1 月 1 日之前的最后一条。`start` 找不到或等于 `end` → `null`，
页面渲染 `—`。运算走 `decimal.js`。

**数据量前提**：近 1 年需要约 250 个交易日。当前
`funds.$code.tsx` 首访只拉 120 天（`fetchNavHistory(env, code, 120)`），
不够。改为 **400**（约 1.6 年交易日），一次性拉够，之后靠 cron 增量。

选择本地计算而非调东财的阶段涨幅接口，是为了**不新增接口依赖**：
数据已经在库里，纯函数可单测，且顺带让净值曲线的「近 1 年」范围真正有数据
（现在选「近 1 年」也只有 120 天）。

## 7. 自选：唯一的新表

```ts
export const watchlist = sqliteTable(
  "watchlist",
  {
    userId: integer("user_id").notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  // 复合主键天然防重复关注，不需要额外唯一约束
  t => [primaryKey({ columns: [t.userId, t.fundCode] })],
);
```

`app/services/watchlist-service.ts`：`add / remove / list / isWatched`。

加自选时若 `fund` 表还没有这只基金，需顺手落一次档案。
详情页 loader 里已有这段「查库 → 过期则拉东财 → upsert」的逻辑，
把它抽成 `app/services/fund-data.ts` 的 `ensureFund(db, env, code)` 供两处复用
（这是本次唯一的既有代码重构，因为不抽就得复制粘贴 40 行）。

`list()` 返回自选基金 + 最新净值 + 日涨跌，直接喂 `FundListItem`。

## 8. 数据接入层扩展与风险分级

沿用 `fund-data.ts` 三条铁律：**全部走 KV 缓存 / 异常不抛给上层 / 数值在这层转整数**。

| 新增函数 | 接口 | 风险 | 降级路径 |
| -------- | ---- | ---- | -------- |
| `fetchFundRank(env, type, period)` | `fund.eastmoney.com/data/rankhandler.aspx` | **中**：返回非标准 JS 需剥壳，需 Referer | 拉不到 → 用本地 `fund_nav` 算已入库基金的排行（榜单短但不空） |
| `fetchFundManager(env, code)` | `fundmobapi.../FundMNManagerDetail` | 低：同域名，已有 header 经验 | 不渲染「基金经理」卡片 |
| `fetchFundPosition(env, code)` | `fundmobapi.../FundMNInverstPosition` | 低：同上 | 不渲染「重仓股」卡片 |
| `fetchIndexNav(env, secid)` | `push2his.eastmoney.com/api/qt/stock/kline/get` | **高**：新域名、新 header 规则、未实测 | **默认不做**（见下） |

**`fundmobapi` 的 header 陷阱**：新增该域名下的函数必须复用
`EM_MOBILE_HEADERS`，**绝不能带浏览器 UA** —— 会返回 HTTP 200 但 `Datas` 为空，
静默失败极难排查。别把 `EM_WEB_HEADERS` 和 `EM_MOBILE_HEADERS` 合并。

**沪深 300 基准对比降级为可砍项**：它是唯一需要接入新域名的功能，
风险最高而价值最低（装饰性）。安排在期四最后，拉不到就不画基准线，
不阻塞该期其余内容验收。

**KV 写入额度**（免费版 1000 次/天是全系统最紧的一环）：
排行榜按 `(类型 × 周期)` 组合缓存 1 天。即使做 4 类型 × 3 周期 = 12 key/天，
叠加现有搜索/档案缓存，距天花板仍很宽裕。经理/重仓股缓存 1 天，
按需触发（只有被访问的基金才写）。

## 9. 页面清单

`/funds` 从「纯搜索页」升级为**发现页**（搜索在顶部 + 排行榜在下方），
对应支付宝的「基金」Tab。榜单用 **Tab 切基金类型**（股票型 / 混合型 / 指数型 / 债券型）
× **周期切换**（近 1 月 / 3 月 / 1 年），正好对应 `fetchFundRank(env, type, period)`
的两个参数 —— 不做额外的「主题概念」分类（东财 rank 接口不提供，自己编维护不起）。
这样既顺手干掉了现在硬编码 5 只基金充当「热门」的尴尬，也不必新增 `/discover` 路由。

| 路由 | 变更 | 内容 |
| ---- | ---- | ---- |
| `/` | 改 | 主人的盘概览 + 涨幅榜摘要 + 注册引导 |
| `/funds` | **改（升级为发现页）** | 搜索框 + 排行榜（类型 Tab × 周期切换） |
| `/funds/:code` | 改 | 阶段涨幅表、净值图接 `PeriodTabs`、经理/规模/成立日、重仓股、加自选、买入 + 定投双入口 |
| `/master` | 改 | 复用 `PortfolioView`；另有定投计划 / 订单 / 资金流水**三张表**需卡片化 |
| `/me` | 改 | 总资产大数字 + 收益（截至 X 日）+ 持仓收益 + 资产走势 + 收益日历 + 持仓卡片速览 + 签到 |
| `/me/holdings` | 改 | 持仓卡片列表，点进单只 |
| `/me/holdings/:code` | **新增** | 单只持仓详情：持有金额/持有收益/成本价/份额/份额批次 + 该基金交易流水 + 加仓·卖出·定投三入口 |
| `/me/watchlist` | **新增** | 自选列表（名称 + 净值 + 日涨跌 + 取消关注 + 买入入口） |
| `/me/orders` | 改 | `OrderTimeline` 确认进度（含 T+1 目标日），pending 单突出 |
| `/me/dca` | 改 | 新视觉，突出「下次扣款日」与已投期数/累计投入 |
| `/me/settings` | 改 | 新视觉 |

`app/routes.ts` 新增 3 行（`me/holdings/:code`、`me/watchlist`）。
`root.tsx` 导航新增「自选」入口。

## 10. 分期交付计划

每期结束都必须 `pnpm verify` 全绿、可 commit、可部署。

### 期一 · 视觉地基（不加功能，纯改观感）✅ 已完成

- `app/theme.ts`：`COLOR` + `pnlColor` + `ANTD_TOKEN`，收敛 3 处重复定义与 25 处硬编码色值
- `uno.config.ts`：`shortcuts` 与 `theme.colors` 里也埋着 3 处旧色值，一并换
  —— 最终不是「换成新字面量」，而是**直接 `import { COLOR } from "./app/theme"`**。
  原注释声称配置里不能 import（走不通 `~/` 别名），实测那个「不能」不成立：
  本文件在仓库根，`"./app/theme"` 是普通相对路径，且 `app/theme.ts` 刻意零 import。
  改完漂移在结构上不可能发生 —— 单一出处优于漂移检测器。
- `app/components/ui/*` 全部 7 个组件
- `app/components/` 4 个列表组件：`HoldingList` / `OrderList` / `DcaPlanList` / `TxList`
- `root.tsx`：主色换蓝、Header 由深色改白底、浅灰底、内容容器、导航重排
- **10 处** `Table` → 卡片列表（`SellDrawer` 的 FIFO 明细表保留，见 4.0）
- 顺手降噪：订单行不再给「手动」「已确认」贴 Tag（见 3.4）
- `pnpm uno:build` 重新生成样式

**验收**：所有既有页面功能不变、观感全面更新、`pnpm verify` 全绿、
**全仓**（含 `uno.config.ts`）搜索不到任何 `#c62828` / `#2e7d32` 字面量。

**验收结果**（12 个任务，全部过独立 review）：

| 项 | 结果 |
| --- | --- |
| `pnpm verify` | ✅ lint 0 error / 0 warning、typecheck 干净、**133 个领域测试通过**，输出无噪音 |
| `pnpm test:workers`（真 workerd + 真 D1） | ✅ **84 个应用层测试通过** —— 这是「功能一行不改」的硬证据 |
| 旧色值 `#c62828` / `#2e7d32` | ✅ 全仓（含 `uno.config.ts`）清零 |
| 全仓十六进制色值 | ✅ 只剩 `app/theme.ts` 的定义本身（另有一处在注释里引用被对比的色值） |
| `<Table>` | ✅ 只剩 `SellDrawer` 的 FIFO 逐批费用明细（按 4.0 刻意保留） |
| `antd Descriptions` / `Statistic` / `Radio.Group` | ✅ 全部退场，只剩替代组件 docstring 里的提及 |
| `pnlColor` / `frequencyText` / `TX_TYPE_MAP` | ✅ 各收敛为唯一定义 |
| 分层 | ✅ `domain` / `services` / `db` 无任何上行引用 |
| 死代码 | ✅ `HoldingTableReadonly` 已清零 |

**期一自己制造并已修掉的三个回归**（记下来，因为它们都不是「原有缺陷」而是重构副作用）：

1. **千分位全丢**：antd `Statistic` 自带 `groupSeparator`，换成自建 `StatBig` 后
   全站金额都变成 `128450.66`。新增 `fmtYuan`（展示层，带 TDD 单测）修回。
   ⚠️ **`centsToYuan` 必须保持机器可读** —— `BuyDrawer` 的「全部」按钮把它的产物
   塞进 `<Input>`，带逗号 `Number()` 得 `NaN` → 提交按钮置灰，买不了。
2. **持仓「持有份额」丢失**：公开盘与仪表盘各丢一处，只有持仓管理页还在。
   提取共享的 `sharesAndNavNote` 修回。
3. **`DataRow` 可访问性回归**：被取代的 `Descriptions bordered` 渲染真
   `<table>` + `<th>`，屏幕阅读器靠它把 label 与 value 配对；换成 `div`+`span`
   后这层关联没了。改用 `dl`/`dt`/`dd` 修回（9 处调用点一起好）。

**尚未完成的一项**：浏览器逐页验收。子代理没有浏览器，清单见
`.superpowers/sdd/2026-08-25-phase1-visual-foundation/browser-checklist.md`（40 条），
须人工执行。其中三条最关键：antd 语义色未被污染（成功仍绿/错误仍红）、
连签封顶时进度条不能变绿、`BuyDrawer`「全部」按钮填入的数字不能带逗号。

### 期二 · 我的资产（重放）

- `tests/domain/asset-timeline.test.ts` 先写（TDD）
- `app/domain/asset-timeline.ts`
- `app/services/asset-service.ts`
- `app/components/AssetTrendChart.tsx`、`ProfitCalendar.tsx`
- `/me` 改版

**验收**：签到日在收益日历上**不显示为收益**（这是核心断言）；
资产走势曲线能回溯到首笔交易日；`pnpm test` 全绿。

### 期三 · 交易体验

- `/me/holdings/:code` 新路由（含份额批次展示 —— 顺便让 FIFO 阶梯费率
  这个系统最独特的设计对用户可见）
- `OrderTimeline` + `/me/orders` 改版
- `BuyDrawer` / `SellDrawer` → `BuyPanel` / `SellPanel`

**验收**：单只持仓页数据与 `/me/holdings` 汇总一致；
赎回面板能展示按批次分档的费用明细。

### 期四 · 发现与详情

- `watchlist` 表 + 迁移（`pnpm db:generate` → `pnpm db:migrate:local`）
- `ensureFund()` 抽取 + `watchlist-service` + `/me/watchlist`
- `fetchFundRank` + `/funds` 发现页
- `tests/domain/performance.test.ts` 先写，然后 `app/domain/performance.ts`
- 详情页阶段涨幅表 + 经理 + 重仓股；首访净值拉取 120 → 400
- （彩蛋，可砍）沪深 300 基准叠加

**验收**：排行榜接口挂掉时页面仍可用（走本地降级）；
详情页缺经理/重仓股数据时只是少一张卡片，不报错。

## 11. 测试策略

新增的两个 domain 纯函数走 **TDD**，放 `tests/domain/`（node 环境，毫秒级）：

`tests/domain/asset-timeline.test.ts` 必须覆盖：

- 净入金（签到/初始本金）**不计入**日收益 ← 最重要
- 净值前向填充（非交易日、停牌、净值未同步）
- 赎回手续费自然体现为当日亏损
- 清仓后曲线变纯现金水平线
- 空账户、单日、前一日总资产为 0 的除零保护

`tests/domain/performance.test.ts` 必须覆盖：数据不足返回 `null`、
YTD 跨年、目标日落在非交易日时的前向填充。

`tests/services/watchlist.test.ts` 走 workers 配置（真实 D1）：
重复关注幂等、级联删除。

UI 组件不写测试（沿用项目现状），靠 `pnpm verify` 的 lint + typecheck 兜底。

> 跑测试注意选对配置，且**不要加 `--`**：
> `pnpm test tests/domain/asset-timeline.test.ts`（领域层）
> `pnpm test:workers tests/services/watchlist.test.ts`（应用层）

## 12. 明确排除项（YAGNI）

- 移动端 App 观感 / `antd-mobile` / 底部 Tab 栏 —— 已定桌面为主
- 暗色模式
- 多只基金对比叠加、组合诊断、AI 荐基
- 消息中心 / 交易推送 / 邮件通知
- **多用户收益率排行榜** —— 这个才真正需要快照表，届时再引入
- 分享海报 / 收益截图
- 沪深 300 基准叠加：降级为期四彩蛋，允许砍掉

## 13. 关键决策速查

| 决策 | 选择 | 理由 |
| ---- | ---- | ---- |
| 组件库 | 继续 antd | 定位桌面为主；换 antd-mobile 等于重写所有页面 |
| 主色 | `#1677FF`，红绿只给涨跌 | 按钮红与涨红撞色是「丑」的根因 |
| 资产走势数据源 | **账本重放纯函数** | 0 新表 0 新 cron，历史立刻可见，可 node 单测 |
| 日收益算法 | **扣掉净入金** | 否则签到日显示假收益，功能作废 |
| 收益日历实现 | 纯 div + CSS Grid | 布局问题不该引入 canvas 依赖 |
| 资产走势图 | 照抄 `NavChart` 的 lazy 范式 | canvas 库 SSR 会炸 hydration |
| 阶段涨幅数据源 | 本地 `fund_nav` 计算 | 不新增接口依赖；顺带把首访拉取提到 400 天 |
| 排行榜数据源 | 东财 rank 接口 + KV 缓存 1 天 | 本地只有用户访问过的基金，榜单会太空 |
| 基准对比 | 降级 / 可砍 | 唯一需接入新域名者，风险最高价值最低 |
| 新增表 | **只有 `watchlist`** | 其余需求都能从现有表推导 |
| 新增 cron | **无** | 重放方案不需要每日写入 |
| 既有代码重构 | 仅 `ensureFund()` 抽取 + `pnlColor` 收敛 | 不做与本目标无关的重构 |
