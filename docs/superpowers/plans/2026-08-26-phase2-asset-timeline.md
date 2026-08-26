# 期二 · 我的资产（账本重放）实施计划

> ## 状态：Task 1–5 已落地 · 2026-08-26
>
> 实现区间 `801549f..2e4ecd1`：
>
> | Task | commit    | 交付                                      |
> | ---- | --------- | ----------------------------------------- |
> | 1    | `801549f` | `replayDailyAssets` 纯函数 + TDD 测试     |
> | 2    | `686b65a` | `asset-service.ts` 查 D1 拼 `ReplayInput` |
> | 3    | `33aac6d` | `AssetTrendChart.tsx`                     |
> | 4    | `08b5928` | `ProfitCalendar.tsx`                      |
> | 5    | `2e4ecd1` | `/me` 装配                                |
>
> - **下方复选框全部未勾，但上表五项已完成。** 本计划按 commit 跟踪进度，不靠勾选框。
>   别把「未勾」读成「未做」，更不要照此重新施工。
> - ⏳ **未完：末尾 `## Self-Review` 章节尚未走过。** 期一的对应环节是
>   Task 11 收尾验收（`338aedc`）+ 分支级缺陷清收（`7bcc760`，14 项）——
>   期二还缺这一步，接手时从这里继续。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 domain 纯函数从 `transactions` / `orders` / `fund_nav` 重放出每日总资产与日收益，装配「资产走势曲线 + 收益日历 + 收益（截至 X 日）」到 `/me`，不动金融内核。

**Architecture:** domain 纯函数 `replayDailyAssets` 单趟扫描日期轴，前向填充现金与净值，扣净入金算日收益（签到/初始本金不算赚）；`asset-service` 查 D1 拼 `ReplayInput` 喂纯函数；`AssetTrendChart` 照抄 `NavChart` 的 `lazy + useSyncExternalStore` 范式（canvas 库 SSR 会炸 hydration）；`ProfitCalendar` 纯 `div + CSS Grid` 可 SSR、零额外依赖；`/me` 装配。

**Tech Stack:** React Router 8 framework mode / antd 6 / `@ant-design/charts`（lazy）/ decimal.js / dayjs / Drizzle + D1。

**Spec:** [`docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md`](../specs/2026-08-25-alipay-style-refactor-design.md) §5（资产时间线）、§4.1/4.2（组件范式）、§9（页面清单 `/me`）、§11（测试策略）。本计划从 spec 论证，执行者两份都读。

## Global Constraints

抄自 CLAUDE.md 与 spec，每条任务的隐性要求都包含本节：

- **包管理器必须用 pnpm**，不要用 npm。
- **精度铁律**：DB 里没有小数——金额×100（分）、份额×10000、净值×10000、费率×10000（万分之）。中间运算一律走 `decimal.js`，最后 `roundInt()`（HALF_UP）回整数。**绝不用 JS 浮点数算钱**。工具函数全在 `app/domain/money.ts`。
- **三层洁净架构是硬约束**：`app/domain/` 纯函数不依赖 D1/网络，可脱离运行时单测；`app/services/` 依赖 D1 把数据喂给 domain 再写回；`app/routes/` 只装配 loader/action + 页面组件。**不要跨层。**
- **新增金融计算先在 domain 写纯函数 + 单测**，再在 service 层接线。
- **颜色单一出处 `app/theme.ts`**（`COLOR` / `pnlColor`）。**不写十六进制色值字面量**；antd 语义色（`colorSuccess` 绿 / `colorError` 红）**不映射涨跌**，涨跌只通过 `COLOR.up` / `COLOR.down` / `pnlColor()` 表达。
- **依赖 canvas/DOM 的库必须懒加载**：`lazy()` + `useSyncExternalStore` 判客户端 + SSR 与加载期渲染同一个骨架屏。**直接复制 `app/components/NavChart.tsx` 的结构，不要自创写法。**
- 测试两套配置，跑单个测试要选对，**不要加 `--`**：领域层 `pnpm test tests/domain/asset-timeline.test.ts`；应用层 `pnpm test:workers tests/services/xxx.test.ts`。
- **代码加合理中文注释。** 注释只写代码本身表达不了的约束（为什么这么干、踩过的坑），不要写「这行做了什么」。
- UnoCSS 只写布局与间距，颜色/圆角/阴影走 antd token 与 `COLOR`。改了 class 后 `pnpm uno:build`（`dev`/`build` 已自动前置）。
- `Date.now()` / `Math.random()` 在 app 代码里能用（不是 workflow 脚本），但**为避免 SSR hydration 不一致，组件默认状态优先从 props/data 派生，不要用 `new Date()`**。

---

## File Structure

| 文件 | 责任 | 动作 |
| ---- | ---- | ---- |
| `tests/domain/asset-timeline.test.ts` | `replayDailyAssets` 的 TDD 测试（node 环境，毫秒级） | 新建 |
| `app/domain/asset-timeline.ts` | 纯函数 `replayDailyAssets` + `ReplayInput` / `DailyAsset` 类型 | 新建 |
| `app/services/asset-service.ts` | `getAssetTimeline(db, userId)`：查 D1 → 拼 `ReplayInput` → 重放 → `{ daily, latest }` | 新建 |
| `app/components/AssetTrendChart.tsx` | 资产走势曲线（lazy 范式，照抄 `NavChart`） | 新建 |
| `app/components/ProfitCalendar.tsx` | 收益日历（纯 `div + CSS Grid`，SSR 安全） | 新建 |
| `app/routes/me._index.tsx` | loader 加 `getAssetTimeline`；装配走势卡 + 日历卡 + 收益（截至 X 日） | 修改 |

**不新建表、不新增 cron**（spec §5.1 决策：账本重放，0 表 0 cron）。

---

## Task 1: `replayDailyAssets` 纯函数 + TDD 测试

**Files:**
- Create: `tests/domain/asset-timeline.test.ts`
- Create: `app/domain/asset-timeline.ts`

**Interfaces:**
- Produces（本任务定义，后续任务消费）:

```ts
// app/domain/asset-timeline.ts
export interface ReplayInput {
  /** 参与重放的日期轴（升序去重）。service 层取 nav_date 并集 ∪ 流水日期 */
  dateAxis: string[];
  /** 现金账本：升序，每条为「该时刻变动后余额（分）」 */
  cashLedger: { date: string; balance: number }[];
  /** 当日净入金（分）：仅 checkin / init 之和，按日聚合 */
  netDepositByDate: Map<string, number>;
  /** 已确认订单：按 confirmDate 升序，buy 加份额、sell 减份额 */
  confirmedOrders: {
    fundCode: string;
    side: "buy" | "sell";
    confirmDate: string;
    /** ×10000 整数 */
    dealShares: number;
  }[];
  /** 各基金净值序列（升序），键为基金代码 */
  navSeries: Map<string, { navDate: string; unitNav: number }[]>;
}

export interface DailyAsset {
  date: string;
  /** 当日现金（分） */
  cashCents: number;
  /** 当日持仓市值合计（分） */
  marketValueCents: number;
  /** 当日总资产（分）= 现金 + 市值 */
  totalAssetCents: number;
  /** 当日收益（分），已扣净入金 */
  dayPnlCents: number;
  /** 当日收益率 = dayPnlCents / 前一日总资产；前一日为 0 或首日 → 0（避免除零） */
  dayPnlRate: number;
}

export function replayDailyAssets(input: ReplayInput): DailyAsset[];
```

**算法（spec §5.2，单趟扫描，O(天数 + 订单数)）**——实现者照此写，不要抄本计划的伪代码当字面实现，先读懂 `app/domain/portfolio.ts` 的 `valuateHolding` 精度约定：

沿 `dateAxis` 前进，维护三个游标：现金账本游标 `cashIdx`、订单游标 `orderIdx`、`Map<fundCode, sharesScaled>` 持仓份额。每到一天 D：

1. 推进 `orderIdx`，把所有 `confirmDate === D` 的订单并入份额 Map（`buy` 加 `dealShares`，`sell` 减 `dealShares`）。订单按 `confirmDate` 升序排好，`===` 匹配即可。
2. 推进 `cashIdx`：只要 `cashLedger[cashIdx].date <= D` 就前进，**前向填充**——当日现金取最后一条被消费掉的 `balance`；一条都没有则现金为 `0`。
3. 对份额 Map 每个非零条目，取该基金 `navDate <= D` 的最后一条 `unitNav`（**前向填充**，覆盖非交易日、停牌、净值未同步）算市值。市值公式与 `valuateHolding` 一致：`roundInt(sharesToDecimal(shares).mul(navToDecimal(nav)).mul(YUAN))`，每只基金各自 `roundInt` 后累加。某基金在 D 之前还没有任何净值 → 此时分额必为 0（确认日必然有净值），跳过。
4. `totalAssetCents = cashCents + marketValueCents`。
5. **第 5 步是整个功能的灵魂**：`dayPnlCents = totalAsset(D) − totalAsset(D−1) − netDeposit(D)`。首日无前一日 → `0`。**必须扣净入金**：签到领 500 不是「今天赚了 500」。买入/赎回不算净入金（现金↔份额转换，总资产不变）；赎回手续费是真实亏损，**不做任何特殊处理**——现金减少了而份额没有等价增加，公式自动算出这个亏损。
6. `dayPnlRate`：前一日总资产为 `0` 或首日 → `0`（避免除零得 `NaN`/`Infinity`）；否则 `new Decimal(dayPnlCents).div(prevTotalAssetCents).toNumber()`。
7. 推 `prevTotalAssetCents = totalAssetCents` 进下一天。

> **净值与份额的 `===` 前向填充注意**：用「游标前进 + 记住上一个有效值」实现，不要在每一天对整条净值序列 `filter` / `findLast`（那是 O(天数 × 净值数)，单用户几十天无所谓但难看）。序列已升序，游标单调前进即可。

---

- [ ] **Step 1: 先写测试文件（TDD，此时被测函数还不存在）**

把下面全部测试写入 `tests/domain/asset-timeline.test.ts`。断言里的数字都已核算过（见每条注释），实现者照抄即可，不要自己改数。测试风格对齐 `tests/domain/redeem.test.ts`（`describe/it/expect`，中文描述）。

```ts
import { describe, expect, it } from "vitest";
import type { ReplayInput } from "~/domain/asset-timeline";
import { replayDailyAssets } from "~/domain/asset-timeline";

/** 造一个空输入，测试里只覆写关心的字段 */
function buildInput(over: Partial<ReplayInput> = {}): ReplayInput {
  return {
    dateAxis: [],
    cashLedger: [],
    netDepositByDate: new Map(),
    confirmedOrders: [],
    navSeries: new Map(),
    ...over,
  };
}

describe("replayDailyAssets 账本重放", () => {
  describe("净入金不计入日收益（核心）", () => {
    it("签到日净入金被扣除，dayPnl 为 0（而非 +500 元假收益）", () => {
      // 净值走平 1.0000，确保市值不变，dayPnl 只受净入金影响
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02"],
        // 08-01 初始入金 1000 元；08-02 签到 +500 元
        cashLedger: [
          { date: "2026-08-01", balance: 100000 }, // 1000 元
          { date: "2026-08-02", balance: 150000 }, // +500 元签到 → 1500 元
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 100000], // init 1000 元
          ["2026-08-02", 50000], // checkin 500 元
        ]),
        confirmedOrders: [
          // 08-01 确认买入 1 份，市值 = 1 × 1.0 = 1 元 = 100 分
          { fundCode: "000001", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 },
        ],
        navSeries: new Map([
          ["000001", [
            { navDate: "2026-08-01", unitNav: 10000 }, // 1.0000
            { navDate: "2026-08-02", unitNav: 10000 }, // 1.0000（走平）
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：现金 100000 + 市值 100 = 100100，首日 dayPnl=0
      expect(r[0].totalAssetCents).toBe(100100);
      expect(r[0].dayPnlCents).toBe(0);
      // 08-02：现金 150000 + 市值 100 = 150100；扣净入金 50000 后 dayPnl=0
      //   若忘了扣净入金，dayPnl 会是 50000（假收益）
      expect(r[1].totalAssetCents).toBe(150100);
      expect(r[1].dayPnlCents).toBe(0);
    });

    it("非交易日的签到日也并入日期轴并扣除，不漏到下一交易日", () => {
      // 08-01(周五) 有 nav；08-02(周六) 无 nav 但有签到 → 08-02 必须在 dateAxis 里
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03"],
        cashLedger: [
          { date: "2026-08-01", balance: 100000 },
          { date: "2026-08-02", balance: 150000 }, // 周六签到 +500
          { date: "2026-08-03", balance: 150000 }, // 无变化
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 100000],
          ["2026-08-02", 50000],
        ]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 },
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-03", unitNav: 10000 }, // 08-02 无净值（周末）
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：100000 + 100 = 100100
      expect(r[0].totalAssetCents).toBe(100100);
      // 08-02（周六）：签到 +500 扣净入金后 dayPnl=0；市值前向填充 1.0 → 100
      expect(r[1].totalAssetCents).toBe(150100);
      expect(r[1].dayPnlCents).toBe(0);
      // 08-03：无变化，前一日已扣过签到 → dayPnl=0（不会把签到再算一次）
      expect(r[2].dayPnlCents).toBe(0);
    });
  });

  describe("净值前向填充", () => {
    it("基金停牌日（nav 缺失）用前一交易日净值前向填充，不归零", () => {
      // A 在 08-02 停牌；B 走平。dateAxis 含 08-02（B 有净值）
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03"],
        cashLedger: [{ date: "2026-08-01", balance: 200000 }], // 2000 元 init
        netDepositByDate: new Map([["2026-08-01", 200000]]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 }, // 1 份
          { fundCode: "B", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 }, // 1 份
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 }, // 1.0
            // 08-02 停牌
            { navDate: "2026-08-03", unitNav: 12000 }, // 1.2
          ]],
          ["B", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
            { navDate: "2026-08-03", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：A=100 + B=100 = 200，现金 200000 → 200200
      expect(r[0].totalAssetCents).toBe(200200);
      // 08-02：A 停牌前向填充 1.0 → 100；B 1.0 → 100；现金 200000 → 200200
      //   若前向填充坏了（A 归零），总资产会掉到 200100
      expect(r[1].totalAssetCents).toBe(200200);
      expect(r[1].dayPnlCents).toBe(0);
      // 08-03：A 复牌 1.2 → 120；B 1.0 → 100；现金 200000 → 200220
      expect(r[2].totalAssetCents).toBe(200220);
      expect(r[2].dayPnlCents).toBe(20);
    });
  });

  describe("赎回手续费自然体现为当日亏损", () => {
    it("赎回手续费不做特殊处理，dayPnl 恰好等于手续费（负数）", () => {
      // 08-01 买 1000 份 @1.0；08-02 全赎 @1.0，扣手续费 15 元
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02"],
        // 08-01 init 2000 元，买入花 1000 → 余额 1000；
        // 08-02 赎回到账 985 元（毛 1000 − 手续费 15）→ 1985 元
        cashLedger: [
          { date: "2026-08-01", balance: 100000 }, // 1000 元
          { date: "2026-08-02", balance: 198500 }, // +985 元
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 200000], // 只有 init 是净入金；买/赎/费都不算
        ]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000000 }, // 1000 份
          { fundCode: "A", side: "sell", confirmDate: "2026-08-02", dealShares: 10000000 }, // 全赎
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：1000 份 × 1.0 = 100000 市值 + 现金 100000 = 200000
      expect(r[0].totalAssetCents).toBe(200000);
      // 08-02：份额 0，现金 198500 → 总资产 198500
      //   dayPnl = 198500 − 200000 − 0 = −1500，恰好等于 15 元手续费
      expect(r[1].totalAssetCents).toBe(198500);
      expect(r[1].dayPnlCents).toBe(-1500);
    });
  });

  describe("清仓后曲线变纯现金水平线", () => {
    it("全部清仓后无持仓无操作，总资产持平、dayPnl=0", () => {
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03"],
        cashLedger: [
          { date: "2026-08-01", balance: 100000 },
          { date: "2026-08-02", balance: 198500 },
          // 08-03 无新流水，前向填充取 08-02 的 198500
        ],
        netDepositByDate: new Map([["2026-08-01", 200000]]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000000 },
          { fundCode: "A", side: "sell", confirmDate: "2026-08-02", dealShares: 10000000 },
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
            { navDate: "2026-08-03", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-02 与 08-03 总资产相等（纯现金水平线），08-03 dayPnl=0
      expect(r[1].totalAssetCents).toBe(198500);
      expect(r[2].totalAssetCents).toBe(198500);
      expect(r[2].dayPnlCents).toBe(0);
    });
  });

  describe("空账户 / 单日 / 除零保护", () => {
    it("空账户返回空数组", () => {
      const r = replayDailyAssets(buildInput({}));
      expect(r).toEqual([]);
    });

    it("单日场景：只有一天时 dayPnl 与 rate 均为 0", () => {
      const input = buildInput({
        dateAxis: ["2026-08-01"],
        cashLedger: [{ date: "2026-08-01", balance: 100000 }],
        netDepositByDate: new Map([["2026-08-01", 100000]]),
        confirmedOrders: [],
        navSeries: new Map(),
      });
      const r = replayDailyAssets(input);
      expect(r).toHaveLength(1);
      expect(r[0].totalAssetCents).toBe(100000);
      expect(r[0].dayPnlCents).toBe(0);
      expect(r[0].dayPnlRate).toBe(0);
    });

    it("前一日总资产为 0 时 dayPnlRate 归零，不产生 NaN/Infinity", () => {
      // 08-01 一无所有；08-02 才 init 入金 500 元（仍无持仓）
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02"],
        cashLedger: [{ date: "2026-08-02", balance: 50000 }],
        netDepositByDate: new Map([["2026-08-02", 50000]]),
        confirmedOrders: [],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：全 0，首日 rate=0
      expect(r[0].totalAssetCents).toBe(0);
      expect(r[0].dayPnlCents).toBe(0);
      expect(r[0].dayPnlRate).toBe(0);
      // 08-02：现金 50000，无持仓 → 50000；前一日总资产 0 → rate 必须为 0（非 NaN）
      expect(r[1].totalAssetCents).toBe(50000);
      expect(r[1].dayPnlCents).toBe(0); // 50000 − 0 − 净入金 50000 = 0
      expect(r[1].dayPnlRate).toBe(0);
      expect(Number.isFinite(r[1].dayPnlRate)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认 RED（函数还没写，必须先看到失败）**

Run: `pnpm test tests/domain/asset-timeline.test.ts`
Expected: FAIL，报 `replayDailyAssets` 未定义 / 模块找不到。**必须先看到这个失败**，再写实现。如果直接绿了，说明测试没接上被测对象，停下来查。

- [ ] **Step 3: 写 `app/domain/asset-timeline.ts` 实现**

按上面「算法」节的 7 步实现 `replayDailyAssets`，导出 `ReplayInput` / `DailyAsset` 接口与函数。精度走 `app/domain/money.ts` 的 `sharesToDecimal` / `navToDecimal` / `YUAN` / `roundInt`。**不要** `import` 任何 `services/` 或 `db/` 的东西（domain 层零运行时依赖，node 单测要能跑）。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm test tests/domain/asset-timeline.test.ts`
Expected: 全部通过。任何一条不过，改 `asset-timeline.ts` 直到全绿——**不要改测试里的断言数字去凑实现**，断言是规格。

- [ ] **Step 5: 跑全量领域测试确认没回归**

Run: `pnpm test`
Expected: 全部通过（含原有 133 条 + 新增）。期一只碰样式不碰 domain，这里不该有回归。

- [ ] **Step 6: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净。`app/domain/asset-timeline.ts` 不能有上行 import。

- [ ] **Step 7: Commit**

```bash
git add tests/domain/asset-timeline.test.ts app/domain/asset-timeline.ts
git commit -m "feat(domain): 账本重放纯函数 replayDailyAssets + TDD 测试"
```

---

## Task 2: `asset-service.ts` 接线

**Files:**
- Create: `app/services/asset-service.ts`

**Interfaces:**
- Consumes: `replayDailyAssets` / `ReplayInput` / `DailyAsset`（Task 1 产出）；`Db`（`~/db/client`）；schema 表 `transactions` / `orders` / `fundNav`（`~/db/schema`）；`toBeijing`（`~/domain/trading-calendar`，与 `checkin-service` 同款）；`getNavSeries`（`~/services/portfolio-service`，已升序，复用免重写）。
- Produces（Task 5 消费）:

```ts
export async function getAssetTimeline(
  db: Db,
  userId: number,
): Promise<{
  daily: DailyAsset[];
  /** 最新一个重放日的日收益。⚠️ 页面必须标注日期，不能硬写「昨日」 */
  latest: DailyAsset | null;
}>;
```

**职责（spec §5.3）**：查 D1 → 拼 `ReplayInput` → 喂 `replayDailyAssets()` → 派生 `{ daily, latest }`。`latest = daily.length ? daily[daily.length - 1] : null`。

**查询要点**（实现者照写，注意每条都是 load-bearing，错了重放就错）：

1. **已确认订单**：从 `orders` 取 `userId=?` 且 `status='confirmed'` 且 `dealShares is not null` 的行，`orderBy(confirmDate asc, id asc)`，映射成 `{ fundCode, side, confirmDate, dealShares }`。**只取 confirmed**——pending/failed 没成交，份额没变。同时收集去重的 `fundCode` 列表。
2. **现金账本**：从 `transactions` 取 `userId=?` 的行，`orderBy(createdAt asc, id asc)`，映射成 `{ date, balance }`。**日期转换是关键**：`createdAt` 是 UTC 毫秒，`fund_nav.navDate` 是北京日历日，必须用 `toBeijing(new Date(row.createdAt)).format("YYYY-MM-DD")` 转成北京日期串对齐（与 `checkin-service` 给 `checkinDate` 的做法一致）。
3. **净入金按日聚合**：遍历上面同一批 `transactions` 行，**仅 `type` 为 `checkin` 或 `init`** 的 `amount` 按 `date` 聚合进 `Map<string, number>`。`buy`/`sell`/`fee` **不算**净入金。`amount` 对 checkin/init 是正数（入账），直接加。
4. **净值序列**：对步骤 1 收集的每个 `fundCode`，调 `getNavSeries(db, code)`（已升序，返回 `{ navDate, unitNav, growthRate }[]`），映射成 `{ navDate, unitNav }[]`（丢 `growthRate`）。无持仓基金 → 空列表。
5. **日期轴**（⚠️ 对 spec §5.2 的刻意修正）：`dateAxis` = 所有基金 `navDate` 的并集 **∪ 所有 `cashLedger.date`**，升序去重。spec 原文只说 nav_date 并集，但那样周末签到会漏到下一交易日显示成假收益（违反期二核心断言）。把流水日期也并进来，签到日才有自己的 `dateAxis` 条目去扣净入金。**这条必须在代码注释里写清楚为什么并上流水日期。**

**降级**：任何一步查不到数据都不抛——空数据让 `replayDailyAssets` 返回空数组，`latest=null`，页面渲染空态。**绝不抛给上层**（沿用 `fund-data.ts` 三条铁律精神）。

**不复用 `getTransactions`/`getOrders`** 的原因：它们默认 `limit=100`，重放要全量。asset-service 直接查表，只取需要的列，不拼 `fundName`（重放不需要名字）。

- [ ] **Step 1: 写 `app/services/asset-service.ts`**

按上面 5 条查询 + 拼 `ReplayInput` + 调 `replayDailyAssets` + 返回 `{ daily, latest }` 实现。加合理中文注释（尤其是日期转换和 dateAxis 并集那两处）。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净。`services/` 层可以 import `domain/` 与 `db/`，但不能被 `domain/` 反向 import。

- [ ] **Step 3: 跑领域测试确认没回归（service 没有单测，靠 typecheck + Task 5 的页面接线验证）**

Run: `pnpm test`
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add app/services/asset-service.ts
git commit -m "feat(service): asset-service 查 D1 拼 ReplayInput 重放资产时间线"
```

---

## Task 3: `AssetTrendChart.tsx`（照抄 NavChart 范式）

**Files:**
- Create: `app/components/AssetTrendChart.tsx`

**Interfaces:**
- Consumes: `DailyAsset`（Task 1）；`PeriodTabs`（`~/components/ui/PeriodTabs`，期一已建）；`EmptyState`（`~/components/ui/EmptyState`）；`YUAN`（`~/domain/money`）；`@ant-design/charts` 的 `Line` + `LineConfig`。
- Produces: `<AssetTrendChart data={DailyAsset[]} />`（Task 5 装配）。

**范式（spec §4.1，必须照抄 `app/components/NavChart.tsx`）**：

- `const Line = lazy(async () => { const m = await import("@ant-design/charts"); return { default: m.Line }; })`
- `useSyncExternalStore(emptySubscribe, () => true, () => false)` 判 `mounted`（SSR 返回 false）。**直接抄 NavChart 的 `useIsClient` 与 `emptySubscribe`，不要换写法。**
- `ChartSkeleton` 抄 NavChart 那个（同样的渐变骨架，`height: 320`）。SSR 与懒加载期渲染同一个骨架，保证前后结构一致不闪。
- `RANGES` 抄 NavChart：`1m`(30) / `3m`(90) / `1y`(365) / `all`(MAX_SAFE_INTEGER)，默认 `"3m"`。
- `PeriodTabs` 放图表上方（与 NavChart 一致）。
- 数据空 → `<EmptyState description="暂无资产走势数据" />`（不走骨架）。

**与 NavChart 的差异（实现者注意，只改这几处）**：

- 入参是 `DailyAsset[]`（不是 `NavPoint[]`）。`chartData` 取最后 N 条，映射成 `{ date: d.date, asset: Number((d.totalAssetCents / YUAN).toFixed(2)) }`。**用 `YUAN` 而非 `NAV_SCALE`**——这是金额（分→元），不是净值。
- `LineConfig`：`xField: "date"`，`yField: "asset"`，`height: 320`，`smooth: true`，`autoFit: true`。
  - `scale.y`：**`zero: false, nice: true`**（与 NavChart 同理——总资产波动幅度小，Y 轴从 0 起会压成一条直线）。
  - `axis.y.labelFormatter`: `(v: number) => v.toFixed(2)`。
  - `tooltip.items`: `[{ channel: "y", name: "总资产（元）", valueFormatter: (v: number) => v.toFixed(2) }]`。
- 注释把「为什么 lazy / 为什么 zero:false」从 NavChart 抄过来并改成资产语境，不要留净值语境的错注释（期一教训：注释陈述代码不做的事被 review 连抓）。

- [ ] **Step 1: 写组件**

照 NavChart 结构，按上面差异点改。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净。

- [ ] **Step 3: Commit**

```bash
git add app/components/AssetTrendChart.tsx
git commit -m "feat(ui): AssetTrendChart 资产走势曲线（照抄 NavChart lazy 范式）"
```

---

## Task 4: `ProfitCalendar.tsx`（纯 div + CSS Grid）

**Files:**
- Create: `app/components/ProfitCalendar.tsx`

**Interfaces:**
- Consumes: `DailyAsset`（Task 1）；`COLOR`（`~/theme`，唯一色源）；`pnlColor`（`~/theme`）；`fmtYuan`（`~/components/ui/format`，带千分位）；dayjs（已 dep，`trading-calendar` 在用）。
- Produces: `<ProfitCalendar data={DailyAsset[]} />`（Task 5 装配）。

**范式（spec §4.2，刻意不用图表库）**：

日历是纯布局问题（7 列网格 + 格子配色），用 `@ant-design/charts` 的 heatmap 会为此白背一个 canvas 依赖 + lazy 包装 + 骨架屏。本组件用 `div` + CSS Grid 实现，**可 SSR，零额外依赖，不需要 lazy**。

**结构**：

- Props: `{ data: DailyAsset[] }`。
- 建一个 `Map<string, DailyAsset>`（键 `date`，YYYY-MM-DD）供 O(1) 查格子。
- 状态 `currentMonth`（YYYY-MM 串，如 `"2026-08"`）。**初始值从 data 派生**：`data.length ? data[data.length - 1].date.slice(0, 7) : ""`。**不要用 `new Date()` 取当月**——SSR 服务端/客户端时区不同会 hydration 不一致。data 为空 → 直接 `<EmptyState description="暂无收益日历" />` 返回。
- 月导航：上一月 / 下一月两个 `Button`（用 antd `Button` + 简单 `‹` `›` 文字或 `LeftOutlined`/`RightOutlined`，若图标没引过就用文字避免新增 import 麻烦）。**下一月禁用条件从 data 派生**：`currentMonth >= lastDataMonth`（`lastDataMonth = data 最后一条的月）时禁用 next`——避免用 `new Date()`。上一月无下界限制（最早可翻到有数据之前，格子全灰，可接受）。
- 表头：周一到周日 `一二三四五六日`（国内日历周一为始）。用 CSS Grid `gridTemplateColumns: repeat(7, 1fr)`。
- 月格子：算 `firstDay = dayjs(\`${currentMonth}-01\`)`，`daysInMonth = firstDay.daysInMonth()`，`startOffset = firstDay.day()` 转成周一为始的偏移：`const w = firstDay.day(); const startOffset = w === 0 ? 6 : w - 1;`。前面填 `startOffset` 个空格，后面填 `daysInMonth` 个日期格。dayjs 全从 `currentMonth` 串派生，**确定性，SSR 安全**。
- 每个日期格内容：右上小字日号；若有数据，中间小字 `dayPnlCents`（带 `+/−` 号、`pnlColor` 着色，用 `fmtYuan` 但可只显示整数元部分——实现者取一个不溢格的简短形式，如 `fmtYuan(d.dayPnlCents)` 太长就只显示 `Math.trunc(dayPnlCents/100)` 元；**注释里说明取舍**）。无数据只显日号。

**格子配色（spec §4.2）**——这是本组件的核心，配色来自 `COLOR`，**不写 RGB 字面量**：

- 无数据 → 浅灰底（`COLOR.neutral` 拼低透明度，或 antd 的浅背景）。
- `dayPnlCents === 0` → 中性灰。
- `dayPnlCents > 0` → `COLOR.up` 系（红），按 `|dayPnlRate|` 绝对值分 4 档深浅：`≥0.015 / ≥0.008 / ≥0.003 / >0`。
- `dayPnlCents < 0` → `COLOR.down` 系（绿），同 4 档。

深浅机制：用 hex8 透明度后缀拼在 `COLOR.up`/`COLOR.down` 上（如 `${COLOR.up}28` / `4D` / `80` / `B3` 四档），或等价的 `rgba`。**基色必须来自 `COLOR`，不要另写 `#F5222D` 字面量**（期一已把全仓旧色值清零，别回退）。0 用 `COLOR.neutral` 同法拼低透明度。具体 4 档透明度值实现者定，注释里写清分档规则。

- [ ] **Step 1: 写组件**

按上面结构实现。dayjs 只用于月算术，**不调 `new Date()` / `dayjs()` 无参**。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净。

- [ ] **Step 3: Commit**

```bash
git add app/components/ProfitCalendar.tsx
git commit -m "feat(ui): ProfitCalendar 收益日历（纯 div + CSS Grid，SSR 安全）"
```

---

## Task 5: `/me` 装配

**Files:**
- Modify: `app/routes/me._index.tsx`

**Interfaces:**
- Consumes: `getAssetTimeline`（Task 2）；`AssetTrendChart`（Task 3）；`ProfitCalendar`（Task 4）；现有 `getPortfolio` / `getCheckinStatus` / `getOrders`（`~/services/portfolio-service` / `~/services/checkin-service`）；`StatBig` / `SectionCard` / `fmtYuan` / `pnlColor` / `COLOR`（期一已建）。
- Produces: 改版后的 `/me` 页面。

**loader 改动**：现有 `Promise.all` 里加 `getAssetTimeline(db, user.id)`，返回值加 `timeline`。即 `return { user, portfolio, checkinStatus, orders, timeline }`。

**页面装配（spec §9 给的 `/me` 元素清单：总资产大数字 + 收益（截至 X 日）+ 持仓收益 + 资产走势 + 收益日历 + 持仓卡片速览 + 签到）**。按下列顺序排，**保留**现有的签到卡、持仓速览卡、最近订单卡（期一已做好的视觉，不动），**新增**走势卡、日历卡、收益头条：

1. 标题区（保留）。
2. `SectionCard` 资产总览（保留）→ `<PortfolioSummary portfolio={portfolio} />`（已有总资产大数字 / 持仓市值 / 现金 / 浮动盈亏=持仓收益）。
3. `SectionCard` **资产走势**（新增）：
   - 头条：`timeline.latest` 存在时，一个 `StatBig`，`label` = `` `收益（截至 ${monthLabel} 月 ${dayLabel} 日）` ``（把 `latest.date` "2026-08-26" 拆成 `Number("08")` / `Number("26")` 去前导零），`value` = `` `${latest.dayPnlCents > 0 ? "+" : ""}${fmtYuan(latest.dayPnlCents)}` ``，`color` = `pnlColor(latest.dayPnlCents)`，`suffix="元"`，`size={24}`。**标题写「截至 X 月 X 日」而非「昨日」**（spec §5.3：净值同步有延迟，20:30 cron 才拉当日净值，硬写「昨日」在没同步时是错的）。`timeline.latest` 为 null → 不渲染这个 StatBig（或渲染 `—`）。
   - `<AssetTrendChart data={timeline.daily} />`。`daily` 为空时组件自己出 EmptyState。
4. `SectionCard` **收益日历**（新增）→ `<ProfitCalendar data={timeline.daily} />`。
5. `SectionCard` 每日签到（保留，整体下移到日历之下）。
6. `SectionCard` 我的持仓（保留）→ `<HoldingList holdings={holdings} renderNote={sharesAndNavNote} />`，`extra` 保留「管理持仓 →」。
7. `SectionCard` 最近订单（保留）→ `<OrderList orders={orders} />`。

**不要动** `action`（签到逻辑不变）。**不要改** `PortfolioSummary`（它被 `/`、`/master` 共用，改它会影响别的页）。新增的收益头条是 `/me` 独有，写在 `me._index.tsx` 里，不要塞进 `PortfolioSummary`。

- [ ] **Step 1: 改 loader**

`Promise.all` 加 `getAssetTimeline(db, user.id)`，返回 `timeline`。

- [ ] **Step 2: 改页面组件**

按上面 1–7 顺序装配。引 `AssetTrendChart` / `ProfitCalendar` / `getAssetTimeline` / `pnlColor`（后者已在文件内 import `COLOR`，补 `pnlColor`）。

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净。

- [ ] **Step 4: 起本地服务肉眼验收（实现者在本机跑）**

Run: `pnpm dev`（已自动前置 `uno:build`），打开 `/me`。
Expected: 资产总览卡不变；下方新增「资产走势」卡（首屏骨架屏，挂载后出曲线）+「收益日历」卡（SSR 直出当月网格）；签到/持仓/订单卡不变。无控制台报错、无 hydration 报错。

- [ ] **Step 5: 跑全量校验**

Run: `pnpm verify`
Expected: lint 0/0、typecheck 干净、领域测试全绿。

- [ ] **Step 6: Commit**

```bash
git add app/routes/me._index.tsx
git commit -m "feat(me): /me 装配资产走势 + 收益日历 + 收益(截至X日)"
```

---

## Self-Review

写完后跑过一遍 spec 对照（已合入上面的任务）：

**1. Spec 覆盖**：
- §5.2 `ReplayInput`/`DailyAsset`/算法 → Task 1 ✓
- §5.3 `getAssetTimeline` + 「截至 X 日」措辞 → Task 2 / Task 5 ✓
- §4.1 AssetTrendChart lazy 范式 → Task 3 ✓
- §4.2 ProfitCalendar 纯 div + CSS Grid + 4 档配色 → Task 4 ✓
- §9 `/me` 元素清单 → Task 5 ✓
- §11 测试 5 项要求（净入金不计 / 前向填充 / 赎回费自然亏损 / 清仓水平线 / 除零） → Task 1 测试全覆盖 ✓，另加「非交易日签到」一项防 spec 的 dateAxis 漏 ✓
- §10 期二验收「签到日不显示为收益」→ Task 1 核心 it ✓；「资产走势回溯到首笔交易日」→ 重放天然从最早 nav 起 ✓；`pnpm test` 全绿 → 各任务 Step ✓

**2. 占位符扫描**：无 TBD/TODO/"适当处理"；测试断言数字均核算过；service 查询列名与 `app/db/schema.ts` 核对一致（`transactions.createdAt/balance/type/amount`、`orders.status/dealShares/confirmDate/side/fundCode`、`fundNav.navDate/unitNav`）✓。

**3. 类型一致性**：`ReplayInput`/`DailyAsset` 在 Task 1 定义，Task 2/3/4/5 消费的字段名（`dateAxis`/`cashLedger`/`netDepositByDate`/`confirmedOrders`/`navSeries`；`DailyAsset.date/cashCents/marketValueCents/totalAssetCents/dayPnlCents/dayPnlRate`）前后一致 ✓。`getAssetTimeline` 返回 `{ daily, latest }`，Task 5 用 `timeline.daily` / `timeline.latest` ✓。

**刻意修正 spec 的一处**（已在 Task 2 注明）：`dateAxis` 并入流水日期，否则周末签到漏成假收益——这是保 spec 核心断言（「签到日不显示为收益」）的必要修正，不是无关偏离。
