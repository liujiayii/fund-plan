# 期三·交易体验 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把交易体验重构成支付宝式：新增单只持仓详情页（让份额批次与 FIFO 阶梯费率对用户可见），订单页改成确认进度时间线，买入/赎回抽屉重构成内嵌面板。

**Architecture:** 不动领域层（`calcRedeem`/`calcPurchase` 已存在并有单测，期三零新 domain 金融逻辑），只在 service 层抽 `getHoldingDetail`/`getOrdersByFund` 喂新路由，UI 层把 `BuyDrawer`/`SellDrawer` 的 Drawer 壳去掉变成内嵌 `BuyPanel`/`SellPanel`，`/me/orders` 换成 `OrderTimeline`。`me.holdings` 由此瘦身成「列表点进单只」，加仓/卖出动作全部下沉到新详情页 `/me/holdings/:code`。

**Tech Stack:** React Router 8 framework mode（flat routes）+ antd 6（Timeline/Slider/Table 均 SSR 安全，无 canvas）+ Drizzle/D1 + decimal.js + dayjs。

**Spec:** `docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md` §4（组件分层，OrderTimeline/BuyPanel/SellPanel 定义）、§4.0（FIFO 表是唯一保留的 Table）、§9（页面清单：/me/holdings 改、/me/holdings/:code 新增、/me/orders 改）、§10（期三交付计划与验收）。撮合/下单铁律见 CLAUDE.md 与 `app/services/settle.ts`/`trade.ts`。

## Global Constraints

- 包管理器**必须用 pnpm**，不要 npm。
- **精度铁律**：DB 全整数——金额×100（分）、份额×10000、净值×10000、费率×10000（万分之）。中间运算一律 decimal.js，最后 `roundInt()`（HALF_UP）回整数。**绝不用 JS 浮点数算钱**。工具函数全在 `app/domain/money.ts`。
- **三层洁净架构硬约束**：`app/domain/` 纯函数不依赖 D1/网络；`app/services/` 依赖 D1 喂 domain；`app/routes/` 只装配。不跨层。本期**无新 domain 金融逻辑**（`calcRedeem`/`calcPurchase` 已存在并有测试），只做 service/UI 接线。
- **颜色单一出处** `app/theme.ts`（`COLOR`/`pnlColor`）；不写十六进制色值字面量；antd 语义色不映射涨跌（`colorSuccess`≠`COLOR.up`）；涨红跌绿。
- canvas 库必须 lazy+`useSyncExternalStore`+SSR/加载期同一骨架屏。本期**不引入新 canvas 库**（antd `Timeline`/`Slider`/`Table` 均 SSR 安全，可直接用）。
- 测试两套：领域 `pnpm test tests/domain/x.test.ts`，应用层 `pnpm test:workers tests/services/x.test.ts`，**不加 `--`**。
- 交易日历 `CN_HOLIDAYS` 每年更新；有净值的那天必然是交易日。
- **提交粒度：一个 Task 一个 commit，不要更细。** code review 的修正 `git commit --amend` 进该 Task 自己的 commit；「计划写错→改计划→再实现」走同一个 commit，不拆两条。
- commit message 结尾：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- `centsToYuan`（**非** `fmtYuan`）对任何回流进 `<Input>` 的值是 load-bearing：`Number("100,000.00")` 得 NaN → `amountCents` 归 0 → 提交按钮置灰。新快捷按钮/placeholder 必须保持 `centsToYuan`。
- `HoldingList.renderNote` **必填**（刻意）：只读页也得给份额/净值，防回归。
- `OrderList`「已确认不贴 Tag」降噪规则：只有 pending/failed 贴 Tag，confirmed 是常态。`OrderTimeline` 沿用。
- **SSR 安全**：组件内不直接 `new Date()`/无参 `dayjs()`；需要「今天」由 loader 在 server 端用 `toBeijing(new Date()).format("YYYY-MM-DD")` 算好传入。

---

## File Structure

| 文件 | 动作 | 职责 |
| ---- | ---- | ---- |
| `app/services/portfolio-service.ts` | 改 | 新增 `HoldingDetailView` 接口、`getHoldingDetail(db,userId,code)`、`getOrdersByFund(db,userId,code,limit)`。复用内部 `latestNavMap`，保证与 `getPortfolio` 同源估值 |
| `tests/services/holding-detail.test.ts` | 建应用层测试 | `getHoldingDetail`/`getOrdersByFund` 契约：批次顺序、待赎回占用、可用份额、费率档、订单按基金过滤 |
| `app/components/BuyPanel.tsx` | 建 | 由 `BuyDrawer` 重构：去掉 `Drawer` 壳的内嵌面板，props 去掉 `open`/`onClose`，保留 `action` |
| `app/components/SellPanel.tsx` | 建 | 由 `SellDrawer` 重构：内嵌面板 + 份额 `Slider`（取代 25/50/75/全部 按钮）+ 保留 FIFO 逐批费用明细 `Table`（§4.0 唯一保留表），保留 `action` |
| `app/components/OrderTimeline.tsx` | 建 | 订单确认进度时间线（antd `Timeline`），pending 用蓝点+「T+1 确认中」突出，confirmed 灰点，failed 红点 |
| `app/routes/me.holdings.$code.tsx` | 建 | 单只持仓详情：概览（市值/收益/成本/份额）+ 份额批次表 + 加仓/卖出/定投三入口 + 该基金交易流水。loader 用 `getHoldingDetail`+`getOrdersByFund`，action 承接 buy/sell（从 `me.holdings` 迁来） |
| `app/routes.ts` | 改 | 加 `route("me/holdings/:code", "routes/me.holdings.$code.tsx")` |
| `app/routes/me.orders.tsx` | 改 | `OrderList` → `OrderTimeline`，保留分页/pending 提示/内扣法说明 |
| `app/routes/funds.$code.tsx` | 改 | `BuyDrawer`（按钮+抽屉）→ 内嵌 `BuyPanel`（SectionCard「买入」） |
| `app/components/HoldingList.tsx` | 改 | 加可选 `getHref?: (h)=>string`，转发给 `FundListItem.href`（期一已留口子） |
| `app/routes/me.holdings.tsx` | 改 | 瘦身：删 `details` 批次查询/`action`/抽屉/state，持仓行链到 `/me/holdings/:code` |
| `app/components/BuyDrawer.tsx` | 删 | 被 `BuyPanel` 取代，所有调用方迁移后删除 |
| `app/components/SellDrawer.tsx` | 删 | 被 `SellPanel` 取代，所有调用方迁移后删除 |

任务依赖：T1（service）→ T2（BuyPanel）→ T3（SellPanel）→ T4（详情路由，依赖 T1/T2/T3）→ T5（OrderTimeline+me.orders，独立）→ T6（funds.$code，依赖 T2）→ T7（me.holdings 瘦身+删抽屉，依赖 T4 的 href 目标 + T6 让 BuyDrawer 无调用方）。

---

### Task 1: portfolio-service 抽 `getHoldingDetail` + `getOrdersByFund`

**Files:**
- Modify: `app/services/portfolio-service.ts`（末尾追加；顶部 import 补 `shareLot`、`RedeemTier`/`ShareLotInput`）
- Test: `tests/services/holding-detail.test.ts`（新建，workers 环境，`pnpm test:workers tests/services/holding-detail.test.ts`）

**Interfaces:**
- Consumes: `latestNavMap`（同文件私有函数）、`valuateHolding`（`~/domain/portfolio`）、`ShareLotInput`/`RedeemTier`/`DEFAULT_REDEEM_TIERS`（`~/domain/redeem`）、`shareLot`/`orders`/`fund`/`holding`/`account`（`~/db/schema`）
- Produces（后续任务消费，签名必须逐字一致）:
  ```ts
  export interface HoldingDetailView extends HoldingView {
    lots: ShareLotInput[];          // FIFO 升序：confirmDate 升、id 升
    pendingShares: number;          // 待确认赎回单占用份额 ×10000
    availableShares: number;        // = sharesScaled − pendingShares
    tiers: RedeemTier[];            // fund.redeemTiers ?? DEFAULT_REDEEM_TIERS
    purchaseRate: number;           // 万分之
    minPurchase: number;            // 分
  }
  export async function getHoldingDetail(
    db: Db, userId: number, fundCode: string,
  ): Promise<HoldingDetailView | null>;
  export async function getOrdersByFund(
    db: Db, userId: number, fundCode: string, limit = 100,
  ): Promise<OrderView[]>;
  ```

- [ ] **Step 1: 写失败测试**（workers 环境，照 `tests/services/settle.test.ts` 的 resetAll/seedFund/seedNav/seedUser 范式）

```ts
// tests/services/holding-detail.test.ts
import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import {
  account, checkin, dcaPlan, fund, fundNav, holding, orders,
  session, shareLot, transactions, user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { getHoldingDetail, getOrdersByFund } from "~/services/portfolio-service";

async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [transactions, shareLot, holding, orders, dcaPlan, checkin, session, account, user, fundNav, fund])
    await db.delete(t);
}
async function seedFund(code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code, name: "测试成长混合", type: "混合型",
    purchaseRate: 150, redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000, riskLevel: 4, status: "开放申购", updatedAt: Date.now(),
  });
}
async function seedNav(navDate: string, unitNav: number, code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fundNav).values({ fundCode: code, navDate, unitNav, accNav: unitNav, growthRate: 0 });
}
async function seedUser(name = "alice") { return (await registerUser(getDb(env.DB), env, name, "hunter2")).id; }

beforeEach(resetAll);

describe("getHoldingDetail", () => {
  it("返回同源估值 + 批次升序 + 待赎回占用 + 费率档", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 12345); // 1.2345
    const userId = await seedUser();
    // 持仓汇总：2000 份（×10000=20000000），成本 2000 元（=200000 分）
    await db.insert(holding).values({ userId, fundCode: "000001", totalShares: 20000000, totalCost: 200000 });
    // 两批：老批 2026-01-05 1200 份、新批 2026-08-01 800 份
    await db.insert(shareLot).values([
      { userId, fundCode: "000001", shares: 12000000, cost: 120000, confirmDate: "2026-01-05", orderId: 1 },
      { userId, fundCode: "000001", shares: 8000000,  cost: 80000,  confirmDate: "2026-08-01", orderId: 2 },
    ]);
    // 一笔待确认赎回 500 份（×10000=5000000）
    await db.insert(orders).values({
      userId, fundCode: "000001", side: "sell", status: "pending", source: "manual",
      amount: null, shares: 5000000, placeDate: "2026-08-26", confirmDate: "2026-08-27", createdAt: 1,
    });

    const d = await getHoldingDetail(db, userId, "000001");
    expect(d).not.toBeNull();
    expect(d!.fundName).toBe("测试成长混合");
    expect(d!.fundType).toBe("混合型");
    expect(d!.navDate).toBe("2026-08-25");
    expect(d!.sharesScaled).toBe(20000000);
    // 市值 = 2000 份 × 1.2345 × 100 = 246900 分
    expect(d!.marketValueCents).toBe(246900);
    // 批次 FIFO 升序：老批在前
    expect(d!.lots.map(l => l.confirmDate)).toEqual(["2026-01-05", "2026-08-01"]);
    expect(d!.pendingShares).toBe(5000000);
    expect(d!.availableShares).toBe(15000000);
    expect(d!.tiers).toEqual(DEFAULT_REDEEM_TIERS);
    expect(d!.purchaseRate).toBe(150);
    expect(d!.minPurchase).toBe(1000);
  });

  it("无持仓返回 null", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    expect(await getHoldingDetail(db, userId, "000001")).toBeNull();
  });
});

describe("getOrdersByFund", () => {
  it("只返回该基金的订单（倒序），带基金名", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedFund("000002");
    const userId = await seedUser();
    await db.insert(orders).values([
      { userId, fundCode: "000001", side: "buy",  status: "confirmed", source: "manual", amount: 100000, shares: null,    placeDate: "2026-08-20", confirmDate: "2026-08-21", createdAt: 1 },
      { userId, fundCode: "000002", side: "buy",  status: "confirmed", source: "manual", amount: 200000, shares: null,    placeDate: "2026-08-21", confirmDate: "2026-08-22", createdAt: 2 },
      { userId, fundCode: "000001", side: "sell", status: "pending",   source: "manual", amount: null,   shares: 5000000, placeDate: "2026-08-26", confirmDate: "2026-08-27", createdAt: 3 },
    ]);
    const list = await getOrdersByFund(db, userId, "000001");
    expect(list.map(o => [o.fundCode, o.side, o.status, o.createdAt])).toEqual([
      ["000001", "sell", "pending", 3],
      ["000001", "buy",  "confirmed", 1],
    ]);
    expect(list.every(o => o.fundName === "测试成长混合")).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:workers tests/services/holding-detail.test.ts`
Expected: FAIL（`getHoldingDetail is not exported`）

- [ ] **Step 3: 实现**

在 `app/services/portfolio-service.ts`：
1. 顶部 import 补 `shareLot`（schema）、`import type { RedeemTier, ShareLotInput } from "~/domain/redeem"`、`import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem"`。
2. `getHoldingDetail`：查 `holding` 行（userId+fundCode），无则 return null；`latestNavMap(db,[fundCode])` 取净值；查 `fund` 行取 name/type/tiers/purchaseRate/minPurchase；`valuateHolding({fundCode,totalSharesScaled:row.totalShares,totalCostCents:row.totalCost,navScaled:Math.round(navInfo?navInfo.unitNav:(row.totalShares>0?row.totalCost/row.totalShares*10000*100:10000))})`（兜底逻辑**照抄** `getPortfolio` 的 :103-107，保证同源）；查 `shareLot`（userId+fundCode，`orderBy(shareLot.confirmDate, shareLot.id)`）map 成 `{id,sharesScaled:l.shares,costCents:l.cost,confirmDate:l.confirmDate}`；查 pending sell 之和（`sql<number>\`coalesce(sum(${orders.shares}),0)\``，照 `me.holdings` 原 loader :57-68）；`availableShares = row.totalShares - pendingShares`；return `{...view, fundName, fundType, navDate: navInfo?.navDate ?? null, lots, pendingShares, availableShares, tiers: (f?.redeemTiers as RedeemTier[]) ?? DEFAULT_REDEEM_TIERS, purchaseRate: f?.purchaseRate ?? 0, minPurchase: f?.minPurchase ?? 1000}`。
3. `getOrdersByFund`：照 `getOrders`（:151-174）改 `where(and(eq(orders.userId,userId), eq(orders.fundCode,fundCode)))`，fund 名 join 只需 `[fundCode]` 一只，返回 `OrderView[]`。
4. 注释说明：`getHoldingDetail` 与 `getPortfolio` 共用 `latestNavMap`+`valuateHolding`，是「单只持仓页数据与 /me/holdings 汇总一致」这个验收项的契约保证。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:workers tests/services/holding-detail.test.ts`
Expected: PASS（3 条）

- [ ] **Step 5: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净

- [ ] **Step 6: Commit**

```bash
git add app/services/portfolio-service.ts tests/services/holding-detail.test.ts
git commit -m "feat(service): getHoldingDetail + getOrdersByFund 喂单只持仓详情页

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `BuyPanel`（由 `BuyDrawer` 重构为内嵌面板）

**Files:**
- Create: `app/components/BuyPanel.tsx`

**Interfaces:**
- Consumes: `calcPurchase`（`~/domain/purchase`）、`yuanToCents`/`centsToYuan`/`navToDisplay`/`rateToPercent`/`sharesToDisplay`（`~/domain/money`）、`fmtYuan`（`~/components/ui/format`）、`DataRow`（`~/components/ui/DataRow`）
- Produces:
  ```ts
  export interface BuyPanelProps {
    fundCode: string;
    fundName: string;
    purchaseRate: number;        // 万分之
    minPurchaseCents: number;    // 分
    navScaled: number;           // ×10000
    navDate: string | null;
    cashCents: number | null;    // 未登录传 null
    action: string;              // 提交到哪个 action
  }
  export function BuyPanel(props: BuyPanelProps): JSX.Element;
  ```

- [ ] **Step 1: 实现**

新建 `app/components/BuyPanel.tsx`：**逐字照抄** `app/components/BuyDrawer.tsx` 的 :35-235（函数体：`amountYuan` state、`fetcher`、`estimate` useMemo、`amountCents`/`belowMin`/`notEnoughCash`/`canSubmit`、`<fetcher.Form>` 整段），做两处改动：
1. 删掉外层 `<Drawer title={`买入 ${fundName}`} open={open} onClose={onClose} width={480} destroyOnHidden>…</Drawer>`，把 `<fetcher.Form>` 直接作为组件根返回。标题「买入 基金名」改由调用方包 `SectionCard` 承载，本组件不再渲染标题。
2. props 去掉 `open`/`onClose`，解构里同步删掉。

**保留**所有原注释（尤其 :116-151 关于 `centsToYuan` 必须保持机器可读的那段——这是精度铁律的衍生约束，改动 `BuyDrawer` 时已踩过，不能丢）。`useState`/`useMemo`/`useFetcher` import 不变。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净（此时无调用方，组件自身类型须过）

- [ ] **Step 3: Commit**

```bash
git add app/components/BuyPanel.tsx
git commit -m "feat(ui): BuyPanel 由 BuyDrawer 重构为内嵌面板

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `SellPanel`（由 `SellDrawer` 重构，加份额滑块）

**Files:**
- Create: `app/components/SellPanel.tsx`

**Interfaces:**
- Consumes: `calcRedeem`、`ShareLotInput`/`RedeemTier`（`~/domain/redeem`）、`navToDisplay`/`rateToPercent`/`SHARE_SCALE`/`sharesToDisplay`（`~/domain/money`）、`fmtYuan`、`DataRow`、`COLOR`/`pnlColor`（`~/theme`）
- Produces:
  ```ts
  export interface SellPanelProps {
    fundCode: string;
    fundName: string;
    availableSharesScaled: number;  // 已扣待确认赎回占用
    navScaled: number;
    navDate: string | null;
    lots: ShareLotInput[];
    tiers: RedeemTier[];
    confirmDate: string;            // 预计确认日
    action: string;
  }
  export function SellPanel(props: SellPanelProps): JSX.Element;
  ```

- [ ] **Step 1: 实现**

新建 `app/components/SellPanel.tsx`：**逐字照抄** `app/components/SellDrawer.tsx` 的 :50-284（`sharesInput` state、`sharesScaled`/`overLimit`/`estimate`/`canSubmit`、`<fetcher.Form>` 整段含 FIFO `Table` :177-209、总额/费合计/到账/已实现盈亏 :210-254、disclaimer :255-260、提交按钮），改动：
1. 删外层 `<Drawer …>`，`<fetcher.Form>` 作根。标题由调用方 `SectionCard` 承载。
2. props 去掉 `open`/`onClose`。
3. **把 :138-158 的 25/50/75/全部 四个 `<Button>` 换成 antd `<Slider>`**（spec §4「份额滑块」）：
   ```tsx
   <Form.Item label="赎回份额" layout="vertical" style={{ marginBottom: 12 }}>
     <Input name="shares" size="large" inputMode="decimal"
       placeholder={`最多 ${sharesToDisplay(availableSharesScaled)} 份`}
       value={sharesInput} onChange={e => setSharesInput(e.target.value)} suffix="份" />
   </Form.Item>
   {availableSharesScaled > 0 && (
     <Slider
       min={0} max={availableSharesScaled}
       step={Math.max(1, Math.floor(availableSharesScaled / 100))}
       value={Math.min(sharesScaled, availableSharesScaled)}
       onChange={(v) => setSharesInput((v / SHARE_SCALE).toFixed(4))}
       tooltip={{ formatter: (v) => `${sharesToDisplay(v ?? 0)} 份` }}
       style={{ marginBottom: 16 }}
     />
   )}
   ```
   滑块与 Input 共享 `sharesInput`：滑块拖动 → 写 `sharesInput`；Input 输入 → `sharesScaled` 重算 → 滑块 `value` 跟随。`step` 给约 100 档，小份额时退化为 1。
4. import 补 `Slider`（antd），删 `Button`（不再用快捷按钮；提交按钮仍用 `Button`，**保留** `Button` import）。

**保留** :220-228「赎回费合计刻意不标红」那段注释（红=涨的系统约束，改 SellDrawer 时已论证过）。FIFO `Table` 是 §4.0 唯一保留的 Table，结构不动，只跟着搬过来。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净

- [ ] **Step 3: Commit**

```bash
git add app/components/SellPanel.tsx
git commit -m "feat(ui): SellPanel 由 SellDrawer 重构，份额滑块 + FIFO 分档明细

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/me/holdings/:code` 单只持仓详情路由

**Files:**
- Create: `app/routes/me.holdings.$code.tsx`
- Modify: `app/routes.ts`（加一行）

**Interfaces:**
- Consumes: `getHoldingDetail`/`getOrdersByFund`（T1）、`BuyPanel`（T2）、`SellPanel`（T3）、`OrderList`（`~/components/OrderList`）、`StatBig`/`SectionCard`/`EmptyState`（`~/components/ui/*`）、`fmtYuan`、`navToDisplay`/`sharesToDisplay`/`yuanToCents`/`SHARE_SCALE`（`~/domain/money`）、`findRedeemRate`/`DEFAULT_REDEEM_TIERS`（`~/domain/redeem`）、`countDays`/`resolveConfirmDate`/`toBeijing`（`~/domain/trading-calendar`）、`placeBuyOrder`/`placeSellOrder`（`~/services/trade`）、`requireUser`（`~/services/guard`）、`getAppContext`、`COLOR`/`pnlColor`、`Table`/`Tag`/`Button`/`Space`/`Typography`（antd）
- Produces: 路由 `/me/holdings/:code`，loader/action/component。

- [ ] **Step 1: 注册路由**

`app/routes.ts` 在 `route("me/holdings", "routes/me.holdings.tsx"),` 下一行加：
```ts
route("me/holdings/:code", "routes/me.holdings.$code.tsx"),
```

- [ ] **Step 2: 实现 loader + action + component**

新建 `app/routes/me.holdings.$code.tsx`：

```tsx
import type { Route } from "./+types/me.holdings.$code";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { useFetcher } from "react-router";
import { BuyPanel } from "~/components/BuyPanel";
import { SellPanel } from "~/components/SellPanel";
import { OrderList } from "~/components/OrderList";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account } from "~/db/schema";
import { navToDisplay, rateToPercent, SHARE_SCALE, sharesToDisplay, yuanToCents } from "~/domain/money";
import { findRedeemRate } from "~/domain/redeem";
import { countDays, resolveConfirmDate, toBeijing } from "~/domain/trading-calendar";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getHoldingDetail, getOrdersByFund } from "~/services/portfolio-service";
import { placeBuyOrder, placeSellOrder } from "~/services/trade";
import { COLOR, pnlColor } from "~/theme";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "持仓详情 · 模拟基金" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const code = params.code;

  const detail = await getHoldingDetail(db, user.id, code);
  if (!detail) {
    // 没有这只持仓（或已清仓且 holding 行已不在）→ 404，与 funds.$code 同款
    throw new Response(`没找到 ${code} 的持仓`, { status: 404 });
  }

  const acc = await db.query.account.findFirst({ where: eq(account.userId, user.id) });
  const orders = await getOrdersByFund(db, user.id, code);

  return {
    detail,
    cash: acc?.cash ?? 0,
    orders,
    // 现在下单会落到哪个确认日（卖出试算持有天数用）
    confirmDate: resolveConfirmDate(new Date()),
    // 批次「持有天数」列的参照日；server 算好传下去，组件内不 new Date()
    today: toBeijing(new Date()).format("YYYY-MM-DD"),
  };
}

/** 加仓与赎回共用 action，intent 区分（从 me.holdings 原样迁来） */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);
  const fundCode = params.code;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  try {
    if (intent === "buy") {
      const amount = String(fd.get("amount") ?? "");
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return { error: "请输入正确的金额" };
      await placeBuyOrder(db, env, { userId: user.id, fundCode, amountCents: yuanToCents(amount) });
      return { ok: true, message: "加仓下单成功，待 T+1 确认" };
    }
    if (intent === "sell") {
      const shares = String(fd.get("shares") ?? "");
      const n = Number(shares);
      if (!Number.isFinite(n) || n <= 0) return { error: "请输入正确的份额" };
      await placeSellOrder(db, env, { userId: user.id, fundCode, sharesScaled: Math.round(n * SHARE_SCALE) });
      return { ok: true, message: "赎回下单成功，待 T+1 确认后到账" };
    }
    return { error: "未知操作" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

export default function MeHoldingDetail({ loaderData, params }: Route.ComponentProps) {
  const { detail: d, cash, orders, confirmDate, today } = loaderData;
  const fetcher = useFetcher<typeof action>();
  // key: fetcher 提交后把 fundCode 带回来，强制 BuyPanel/SellPanel 重新挂载清空输入
  const [tick, setTick] = useState(0);
  const actionUrl = `/me/holdings/${params.code}`;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space align="baseline">
        <Title level={3} style={{ margin: 0 }}>{d.fundName}</Title>
        <Text type="secondary">{d.fundCode}</Text>
        {d.fundType && <Tag>{d.fundType}</Tag>}
        <Button size="small" href="/me/holdings">← 返回持仓</Button>
      </Space>

      {fetcher.data?.ok && <Alert type="success" showIcon message={fetcher.data.message} closable />}
      {fetcher.data?.error && <Alert type="error" showIcon message={fetcher.data.error} closable />}

      {/* 持仓概览：与 /me/holdings 列表同源估值 */}
      <SectionCard title="持仓概览">
        <Space size={48} wrap>
          <StatBig label="持有市值" value={fmtYuan(d.marketValueCents)} suffix="元" />
          <StatBig label="持有收益" value={`${d.pnlCents > 0 ? "+" : ""}${fmtYuan(d.pnlCents)}`} suffix="元" size={24} color={pnlColor(d.pnlCents)} />
          <StatBig label="成本" value={fmtYuan(d.costCents)} suffix="元" size={24} />
          <StatBig label="持有份额" value={sharesToDisplay(d.sharesScaled)} suffix="份" size={24} />
          {d.navDate && <StatBig label={`净值（${d.navDate}）`} value={navToDisplay(d.navScaled)} size={24} />}
        </Space>
      </SectionCard>

      {/* 份额批次：让 FIFO 阶梯费率这个系统最独特的设计对用户可见 */}
      <SectionCard title={`份额批次（${d.lots.length} 批）`}>
        {d.lots.length === 0 ? (
          <EmptyState description="无在持批次" />
        ) : (
          <Table
            size="small" pagination={false} rowKey="id" dataSource={d.lots}
            columns={[
              { title: "确认日", dataIndex: "confirmDate" },
              { title: "份额", dataIndex: "sharesScaled", align: "right",
                render: (v: number) => sharesToDisplay(v) },
              { title: "成本", dataIndex: "costCents", align: "right",
                render: (v: number) => `${fmtYuan(v)} 元` },
              { title: "持有天数", key: "holdDays", align: "right",
                render: (_, l) => `${countDays(l.confirmDate, today)} 天` },
              { title: "当前费率档", key: "rate", align: "right",
                // 按今天的持有天数查档，告诉用户「这批现在赎回按几费率」
                render: (_, l) => rateToPercent(findRedeemRate(d.tiers, countDays(l.confirmDate, today))) },
            ]}
          />
        )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          赎回按批次先进先出，每批按各自持有天数查费率档——
          所以一笔赎回可能同时按多档费率计费。下方「卖出」面板可试算明细。
        </Paragraph>
      </SectionCard>

      {/* 加仓·卖出·定投 三入口 */}
      {d.navScaled > 0 && (
        <SectionCard title="加仓">
          <BuyPanel key={`buy-${tick}`}
            fundCode={d.fundCode} fundName={d.fundName}
            purchaseRate={d.purchaseRate} minPurchaseCents={d.minPurchase}
            navScaled={d.navScaled} navDate={d.navDate} cashCents={cash}
            action={actionUrl} />
        </SectionCard>
      )}

      {d.availableShares > 0 && d.lots.length > 0 && (
        <SectionCard title="卖出">
          <SellPanel key={`sell-${tick}`}
            fundCode={d.fundCode} fundName={d.fundName}
            availableSharesScaled={d.availableShares} navScaled={d.navScaled} navDate={d.navDate}
            lots={d.lots} tiers={d.tiers} confirmDate={confirmDate}
            action={actionUrl} />
        </SectionCard>
      )}

      <Button href="/me/dca">设置/管理定投 →</Button>

      {/* 该基金交易流水 */}
      <SectionCard title={`该基金交易（${orders.length} 笔）`}>
        {orders.length === 0 ? <EmptyState description="还没有该基金的交易记录" /> : <OrderList orders={orders} detailed />}
      </SectionCard>
    </Space>
  );
}
```

注意点（实现者必读）：
- `useState` 的 `tick` 仅为提交后强制面板重挂清空输入；fetcher 提交成功后调 `setTick(t=>t+1)`。若 fetcher 成功回写复杂，可改为提交按钮 `onClick` 后在 `fetcher.data?.ok` 的 `useEffect` 里 `setTick`——但优先简单：提交按钮 onClick 先 `setTick` 再提交，或用 `useEffect(()=>{ if(fetcher.data?.ok) setTick(t=>t+1) }, [fetcher.data])`。取后者，补 `useEffect` import。
- 批次表是 §4.0 精神下的新合法表格（同维度多行对比），色值全走 token，无 hex 字面量。
- `findRedeemRate` 从 `~/domain/redeem` import（domain 纯函数，service/route 调用合法）。

- [ ] **Step 3: typecheck + lint + workers 回归**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: 干净；workers 测试全绿（含 T1 新测，无回归）

- [ ] **Step 4: Commit**

```bash
git add app/routes.ts app/routes/me.holdings.$code.tsx
git commit -m "feat(route): /me/holdings/:code 单只持仓详情 + 份额批次展示

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `OrderTimeline` + `/me/orders` 改版

**Files:**
- Create: `app/components/OrderTimeline.tsx`
- Modify: `app/routes/me.orders.tsx`

**Interfaces:**
- Consumes: `OrderView`（`~/services/portfolio-service`）、`fmtYuan`、`navToDisplay`/`sharesToDisplay`（`~/domain/money`）、`COLOR`（`~/theme`）
- Produces: `OrderTimeline({ orders: OrderView[] })`；`/me/orders` 用它替换 `OrderList`。

- [ ] **Step 1: 实现 `OrderTimeline`**

新建 `app/components/OrderTimeline.tsx`：
```tsx
import type { OrderView } from "~/services/portfolio-service";
import { Tag, Timeline, Tooltip } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { navToDisplay, sharesToDisplay } from "~/domain/money";
import { COLOR } from "~/theme";

/** 与 OrderList 同款降噪：只有 pending/failed 贴 Tag，confirmed 是常态不贴 */
const STATUS_TAG: Partial<Record<OrderView["status"], { color: string; text: string }>> = {
  pending: { color: "orange", text: "待确认" },
  failed: { color: "red", text: "失败" },
};

export interface OrderTimelineProps {
  orders: OrderView[];
}

/**
 * 订单确认进度时间线。每笔订单是一个节点：
 * pending 蓝（进行中）+「T+1 确认中」突出、confirmed 灰（常态）、failed 红。
 * 把 T+1 目标日（confirmDate）与成交明细按时间线呈现，比平铺列表更接近支付宝的「订单状态流」。
 */
export function OrderTimeline({ orders }: OrderTimelineProps) {
  if (orders.length === 0) return null;
  return (
    <Timeline
      items={orders.map(o => {
        const tag = STATUS_TAG[o.status];
        const color = o.status === "pending" ? "blue" : o.status === "failed" ? "red" : "gray";
        return {
          color,
          children: (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <a href={`/funds/${o.fundCode}`} style={{ color: COLOR.textPrimary, fontWeight: 500 }}>
                  {o.fundName}
                </a>
                <span style={{ fontSize: 12, color: COLOR.textSecondary }}>{o.fundCode}</span>
                {o.side === "buy" ? <Tag color="blue">申购</Tag> : <Tag>赎回</Tag>}
                {o.source === "dca" && <Tag color="purple">定投</Tag>}
                {tag && (o.failReason
                  ? <Tooltip title={o.failReason}><Tag color={tag.color}>{tag.text}</Tag></Tooltip>
                  : <Tag color={tag.color}>{tag.text}</Tag>)}
              </div>
              <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
                {o.side === "buy" ? `委托 ${fmtYuan(o.amount ?? 0)} 元` : `委托 ${sharesToDisplay(o.shares ?? 0)} 份`}
                {" · 下单 "}{o.placeDate}{" · 确认日 "}{o.confirmDate}
                {o.status === "pending" && (
                  <span style={{ color: COLOR.primary }}>（T+1 确认中）</span>
                )}
              </div>
              {o.status === "confirmed" && o.dealNav !== null && (
                <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
                  {o.dealAmount !== null && `${o.side === "buy" ? "净申购" : "到账"} ${fmtYuan(o.dealAmount)} 元 · `}
                  {`成交净值 ${navToDisplay(o.dealNav)}`}
                  {o.dealShares !== null && ` · ${sharesToDisplay(o.dealShares)} 份`}
                  {o.fee !== null && ` · 费 ${fmtYuan(o.fee)} 元`}
                </div>
              )}
            </div>
          ),
        };
      })}
    />
  );
}
```

- [ ] **Step 2: 改 `/me/orders`**

`app/routes/me.orders.tsx`：把 import 的 `OrderList` 换成 `OrderTimeline`，`<OrderList orders={…slice} detailed />` 换成 `<OrderTimeline orders={orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} />`。loader/pending Alert/分页/footer Paragraph 全部保留不动。

- [ ] **Step 3: typecheck + lint + 领域回归**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 干净；领域测试全绿

- [ ] **Step 4: Commit**

```bash
git add app/components/OrderTimeline.tsx app/routes/me.orders.tsx
git commit -m "feat(ui): OrderTimeline 订单确认进度 + /me/orders 改版

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `funds.$code` → 内嵌 `BuyPanel`

**Files:**
- Modify: `app/routes/funds.$code.tsx`（:168-295 组件区）

**Interfaces:**
- Consumes: `BuyPanel`（T2）、`SectionCard`、`StatBig`、`NavChart`、`DataRow`（均已在该文件 import）、`EmptyState` 视情况
- Produces: 详情页「买入」内嵌面板（替代 买入按钮 + `BuyDrawer`）。

- [ ] **Step 1: 改组件**

`app/routes/funds.$code.tsx` 组件 `FundDetail`：
1. 删 `const [buyOpen, setBuyOpen] = useState(false);`，删 `useState` import（若无其它用途）。
2. 删 `import { BuyDrawer } from "~/components/BuyDrawer";`，加 `import { BuyPanel } from "~/components/BuyPanel";`，加 `import { SectionCard } from "~/components/ui/SectionCard";`（若未 import）。
3. 把「买入」按钮区（:217-237）改为：登录且有 `latest` 时渲染 `<SectionCard title="买入"><BuyPanel fundCode={f.code} fundName={f.name} purchaseRate={f.purchaseRate} minPurchaseCents={f.minPurchase} navScaled={latest.unitNav} navDate={latest.navDate} cashCents={cash} action={`/funds/${f.code}`} /></SectionCard>`；未登录时保留 `<Button type="primary" size="large" href="/register">注册后即可买入</Button>`（可放进一个 `SectionCard title="买入"` 里）；「继续搜索」按钮保留。
4. 删文件末尾的 `<BuyDrawer … />`（:279-292）。

`action`（:127-151）保持不变（仍是 `getCurrentUser` guest-ok + `placeBuyOrder`，BuyPanel posts 到 `/funds/${code}`）。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净

- [ ] **Step 3: Commit**

```bash
git add app/routes/funds.$code.tsx
git commit -m "feat(funds): 详情页 BuyDrawer → 内嵌 BuyPanel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `me.holdings` 瘦身 + 删 `BuyDrawer`/`SellDrawer`

**Files:**
- Modify: `app/routes/me.holdings.tsx`
- Modify: `app/components/HoldingList.tsx`（加 `getHref` 可选 prop）
- Delete: `app/components/BuyDrawer.tsx`
- Delete: `app/components/SellDrawer.tsx`

**Interfaces:**
- Consumes: `getPortfolio`（已用）、`HoldingList`（加 `getHref`）、`FundListItem`（`href` 期一已留）
- Produces: `/me/holdings` 列表行链到 `/me/holdings/:code`；无 action/无抽屉。

- [ ] **Step 1: `HoldingList` 加 `getHref`**

`app/components/HoldingList.tsx` 的 `HoldingListProps` 加可选 `getHref?: (h: HoldingView) => string;`，`<FundListItem …/>` 加 `href={getHref ? getHref(h) : undefined}`（不传则 `FundListItem` 用默认 `/funds/${code}`，只读页不受影响）。注释说明这是期一 `FundListItem.href` 留的口子兑现。

- [ ] **Step 2: `me.holdings` 瘦身**

`app/routes/me.holdings.tsx`：
1. loader：删 `details` 的 `Promise.all`（:46-89），删 `confirmDate`、删 `shareLot`/`orders`/`fund`/`DEFAULT_REDEEM_TIERS`/`resolveConfirmDate` 相关 import；只留 `getPortfolio(db,user.id)` + `acc.cash`。return `{ portfolio, cash }`。
2. 删整个 `action`（:101-141）（buy/sell 已迁到 `me.holdings.$code`）。删 `placeBuyOrder`/`placeSellOrder`/`yuanToCents`/`SHARE_SCALE` import。
3. 组件：删 `useFetcher`/`useState`/`buyTarget`/`sellTarget`/`detailOf`、删 `fetcher.data` 两个 Alert、删 `<BuyDrawer>`/`<SellDrawer>`（:253-283）。删 `BuyDrawer`/`SellDrawer` import。
4. `<HoldingList>`：`renderNote` 保留（份额/成本/净值 + 批次数；但批次数来自 `details` 已删——改为不再显示批次数，只显示 `份额 · 成本 · 净值`，或把「X 批」与「待赎回」一并去掉，因为这些细节现在归属详情页）。`renderActions`（加仓/赎回按钮）删除——动作下沉到详情页。加 `getHref={h => \`/me/holdings/${h.fundCode}\`}`。
5. `renderNote` 简化后（无批次数/无待赎回，避免再查 lots）：用 `sharesAndNavNote`（`~/components/HoldingList` 已导出）即可——它给「份额 · 净值（日期）」，与本页「点进单只看细节」的定位一致。直接 `renderNote={sharesAndNavNote}`，删掉原来的内联 `renderNote`。成本可保留：`renderNote={h => \`${sharesAndNavNote(h)} · 成本 ${fmtYuan(h.costCents)} 元\`}`。
6. 「持仓明细」SectionCard 末尾的 Paragraph（:246-249）保留（解释批次是什么）。
7. StatBig 三数（持仓市值/可用现金/浮动盈亏）保留不动。

- [ ] **Step 3: 删抽屉**

确认 `BuyDrawer` 无其它调用方（Task 6 已迁 `funds.$code`，本 Task 已迁 `me.holdings`）后：
```bash
git rm app/components/BuyDrawer.tsx app/components/SellDrawer.tsx
```

- [ ] **Step 4: typecheck + lint + workers 回归**

Run: `pnpm typecheck && pnpm lint && pnpm verify`
Expected: 干净；`pnpm verify` 含 lint+typecheck+领域测试全绿（应用层用 `pnpm test:workers` 复跑一次确认无回归）

- [ ] **Step 5: Commit**

```bash
git add app/routes/me.holdings.tsx app/components/HoldingList.tsx
git rm app/components/BuyDrawer.tsx app/components/SellDrawer.tsx
git commit -m "refactor(me): me.holdings 瘦身为列表点进单只，删 BuyDrawer/SellDrawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**（§10 期三交付项 + §9 页面清单）：
- `/me/holdings/:code` 新路由（含份额批次展示，FIFO 阶梯费率对用户可见）→ T1+T4 ✓
- `OrderTimeline` + `/me/orders` 改版 → T5 ✓
- `BuyDrawer`/`SellDrawer` → `BuyPanel`/`SellPanel` → T2+T3+T6+T7 ✓
- 验收①「单只持仓页数据与 /me/holdings 汇总一致」→ `getHoldingDetail` 与 `getPortfolio` 共用 `latestNavMap`+`valuateHolding`，T1 测试断言 `marketValueCents===246900` 与同源估值 ✓
- 验收②「赎回面板能展示按批次分档的费用明细」→ `SellPanel` 保留 `SellDrawer` 的 FIFO `Table`（§4.0 唯一保留表）✓
- §4 组件分层 `OrderTimeline`/`BuyPanel`/`SellPanel` 均在 `app/components/` ✓
- §4.0 FIFO 表保留：`SellPanel` 保留；T4 批次展示表是新合法表格（同维度多行对比，色值走 token），不违反「实体列表换卡片」 ✓
- §9 `/me/holdings` 改（点进单只）→ T7 ✓

**2. Placeholder 扫描**：无 TBD/TODO；T1 测试代码完整可跑；T2/T3 指明「逐字照抄」具体行号区间 + 精确 diff；T4 给出完整 loader/action/component 代码；T5 给出完整 `OrderTimeline` 代码；T6/T7 给出精确改动点。无「add appropriate error handling」之类空话。

**3. 类型一致性**：
- `HoldingDetailView`（T1 定义）的字段 `lots/pendingShares/availableShares/tiers/purchaseRate/minPurchase` 与 T4 loader 消费（`d.lots.length`/`d.availableShares`/`d.tiers`/`d.purchaseRate`/`d.minPurchase`）逐字对齐 ✓
- `BuyPanelProps`（T2）与 T4/T6 调用方传参逐字对齐（`fundCode/fundName/purchaseRate/minPurchaseCents/navScaled/navDate/cashCents/action`）✓
- `SellPanelProps`（T3）与 T4 调用方传参逐字对齐（`availableSharesScaled`/`lots`/`tiers`/`confirmDate`/`action`）✓
- `OrderTimelineProps.orders: OrderView[]`（T5）与 `me.orders` 传入 `orders.slice(...)` 类型一致 ✓
- `getOrdersByFund` 返回 `OrderView[]`（T1）→ T4 `OrderList orders={orders}`（`OrderListProps.orders: OrderView[]`）✓
- `ShareLotInput`（`~/domain/redeem` 已存在）字段 `{id, sharesScaled, costCents, confirmDate}`：T1 lots map 与 `SellPanel` 喂 `calcRedeem` 一致；T4 批次表 `dataIndex` 用 `confirmDate`/`sharesScaled`/`costCents` 与 `ShareLotInput` 字段名一致 ✓

**4. 风险点**：
- T4 用 `findRedeemRate`（domain 纯函数）在 route 层算「当前费率档」展示——这是 domain 函数的只读调用，不违反三层（route 调 domain 纯函数合法，与 `funds.$code` 用 `rateToPercent` 同性质）✓
- T7 删 `me.holdings` action 后，`me.holdings` 不再有 `useFetcher`——确认 `fetcher.data` Alert 一并删 ✓
- 删 `BuyDrawer`/`SellDrawer` 前必须 T6（`funds.$code` 迁完）+ T7（`me.holdings` 迁完）都落地，否则悬空 import → 顺序锁定 T7 最后 ✓
- `OrderTimeline` 用 antd `Timeline`（SSR 安全，无 canvas），无需 lazy ✓
