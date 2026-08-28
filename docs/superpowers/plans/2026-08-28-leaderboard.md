# 收益排行榜实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增公开页 `/leaderboard`——全体用户的收益/收益率排行榜（累计口径），含导航入口与首页引流卡片。

**Architecture:** 三层洁净架构：domain 纯函数（口径计算 + 排序，node 单测）→ service（四次 D1 查询拼 `LeaderboardEntryInput[]`，复用 `latestNavMap`）→ route（公开页，两个排序 tab）。零 schema 变更、零 cron、零 KV、零新依赖。

**Tech Stack:** React Router 8 framework mode + antd 6 + Drizzle + D1 + Vitest 双配置（domain node / services workerd）。

**Spec:** `docs/superpowers/specs/2026-08-28-leaderboard-design.md`

## Global Constraints

- **分支：`feat/leaderboard`**（已建好并带着 spec commit，在此基础上开发；不要碰 main）
- **包管理器 pnpm**，装依赖类命令一律 `pnpm <cmd>`
- **跑单测不加 `--`**：domain 用 `pnpm test tests/domain/xxx.test.ts`；services 用 `pnpm test:workers tests/services/xxx.test.ts`
- **精度铁律**：金额整数分、份额/净值 ×10000、中间运算 `decimal.js`、最后 `roundInt()`（HALF_UP）；绝不让浮点碰钱
- **代码必须带合理中文注释**，风格 `@antfu/eslint-config`（双引号 + 分号 + 2 空格）
- **提交粒度：一个 Task 一个 commit**，code review 修正 amend 进对应 Task 的 commit
- **UnoCSS**：改 class 后跑 `pnpm uno:build`（dev/build 自动前置，一般无需手跑；本计划只用现成类 `fp-h-scroll`/`fp-desktop`/`fp-mobile`，不新增 class）
- **颜色/圆角/阴影走 antd 主题 token（`~/theme` 的 COLOR 等），UnoCSS 只写布局与间距**

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `app/domain/leaderboard.ts` | 新建 | 纯函数：口径计算（computeLeaderboard）+ 两维排序（rankLeaderboard）|
| `tests/domain/leaderboard.test.ts` | 新建 | domain 单测（node） |
| `app/services/leaderboard-service.ts` | 新建 | D1 四查拼数据，喂 domain |
| `tests/services/leaderboard.test.ts` | 新建 | service 集成测试（workerd + 真实 D1） |
| `app/routes/leaderboard.tsx` | 新建 | 公开页面（loader + 两个 tab + 我的排名钉行） |
| `app/routes.ts` | 修改 | 注册 `route("leaderboard", ...)` 到公开段 |
| `app/domain/nav.ts` | 修改 | NAV_ITEMS 加「排行榜」项 |
| `tests/domain/nav.test.ts` | 修改 | 补 /leaderboard 断言 |
| `app/routes/_index.tsx` | 修改 | 首页加引流卡片 |

---

### Task 1: 领域层——口径计算与排序

**Files:**
- Create: `app/domain/leaderboard.ts`
- Test: `tests/domain/leaderboard.test.ts`

**Interfaces:**
- Consumes: `roundInt`（`app/domain/money.ts`），`Decimal`（decimal.js）
- Produces（Task 2/3 依赖，签名必须一字不差）:
  - `interface LeaderboardEntryInput { userId: number; username: string; marketValueCents: number; cashCents: number; initialCashCents: number; totalCheckinCents: number; hasTrades: boolean }`
  - `interface LeaderboardEntry extends LeaderboardEntryInput { totalAssetCents: number; totalPnlCents: number; totalPnlRate: number; rank: number }`
  - `computeLeaderboard(rows: LeaderboardEntryInput[]): LeaderboardEntry[]`——过滤无成交者 + 算口径（不带 rank，rank 置 0）
  - `rankLeaderboard(entries: LeaderboardEntry[], by: "rate" | "pnl"): LeaderboardEntry[]`——排序并填 rank，同分同名次（1,2,2,4 型），破平键 userId 升序

- [ ] **Step 1: 写失败测试**

```typescript
// tests/domain/leaderboard.test.ts
import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  rankLeaderboard,
} from "~/domain/leaderboard";

/**
 * 排行榜口径 —— spec §2 的全部断言。
 * 造数约定：金额直接用分，一万元写 1_000_000，读起来跟元对应。
 */

/** 快捷构造：默认 10 万入金、无持仓、无签到，按需覆盖 */
function mk(over: Partial<Parameters<typeof computeLeaderboard>[0][number]>) {
  return {
    userId: 1,
    username: "alice",
    marketValueCents: 0,
    cashCents: 10_000_000,
    initialCashCents: 10_000_000,
    totalCheckinCents: 0,
    hasTrades: true,
    ...over,
  };
}

describe("computeLeaderboard 口径", () => {
  it("纯现金无成交的用户被门槛过滤", () => {
    const out = computeLeaderboard([mk({ hasTrades: false })]);
    expect(out).toHaveLength(0);
  });

  it("有成交但空仓：总资产 = 现金，清仓利润保留在收益里", () => {
    // 入金 10 万，买入后清仓落袋 5000：现金 10.5 万
    const out = computeLeaderboard([
      mk({ cashCents: 10_500_000 }),
    ]);
    expect(out[0].totalAssetCents).toBe(10_500_000);
    expect(out[0].totalPnlCents).toBe(500_000);
    expect(out[0].totalPnlRate).toBeCloseTo(0.05, 10);
  });

  it("只签到不买（有历史成交）：签到是入金不是收益，rate 仍 0", () => {
    // 注册 10 万 + 签到 1000，没买过但历史上成交过（已清仓）
    const out = computeLeaderboard([
      mk({
        cashCents: 10_010_000,
        totalCheckinCents: 10_000,
        hasTrades: true,
      }),
    ]);
    expect(out[0].totalPnlCents).toBe(0);
    expect(out[0].totalPnlRate).toBe(0);
  });

  it("持仓 + 现金：总资产 = 市值 + 现金，盈亏 = 总资产 − 累计入金", () => {
    // 入金 10 万，花 5 万买基金（成本 5 万），市值涨到 6 万
    const out = computeLeaderboard([
      mk({
        marketValueCents: 6_000_000,
        cashCents: 5_000_000,
      }),
    ]);
    expect(out[0].totalAssetCents).toBe(11_000_000);
    expect(out[0].totalPnlCents).toBe(1_000_000);
    expect(out[0].totalPnlRate).toBeCloseTo(0.1, 10);
  });

  it("亏损用户：收益为负、率为负，照常上榜", () => {
    const out = computeLeaderboard([
      mk({ cashCents: 9_000_000 }),
    ]);
    expect(out[0].totalPnlCents).toBe(-1_000_000);
    expect(out[0].totalPnlRate).toBeCloseTo(-0.1, 10);
  });

  it("除零守卫：累计入金为 0 时 rate 返回 0 而非 NaN/Infinity", () => {
    const out = computeLeaderboard([
      mk({
        cashCents: 0,
        initialCashCents: 0,
        totalCheckinCents: 0,
      }),
    ]);
    expect(out[0].totalPnlRate).toBe(0);
    expect(Number.isFinite(out[0].totalPnlRate)).toBe(true);
  });
});

describe("rankLeaderboard 排序", () => {
  const base = [
    mk({ userId: 1, username: "a", cashCents: 10_500_000 }), // pnl +5000, rate +5%
    mk({ userId: 2, username: "b", cashCents: 9_000_000 }), // pnl -10000, rate -10%
    mk({ userId: 3, username: "c", marketValueCents: 20_000_000, cashCents: 0 }), // pnl +10000, rate +10%
  ];

  it("按收益率降序排名", () => {
    const ranked = rankLeaderboard(base, "rate");
    expect(ranked.map(r => r.userId)).toEqual([3, 1, 2]);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it("按总收益降序排名", () => {
    const ranked = rankLeaderboard(base, "pnl");
    expect(ranked.map(r => r.userId)).toEqual([3, 1, 2]);
  });

  it("同分同名次（1,2,2,4 型），破平按 userId 升序", () => {
    const tied = [
      mk({ userId: 5, username: "x", cashCents: 10_500_000 }), // rate +5%
      mk({ userId: 4, username: "y", cashCents: 10_500_000 }), // rate +5%
      mk({ userId: 6, username: "z", cashCents: 11_000_000 }), // rate +10%
      mk({ userId: 7, username: "w", cashCents: 10_000_000 }), // rate 0%
    ];
    const ranked = rankLeaderboard(tied, "rate");
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked.map(r => r.userId)).toEqual([6, 4, 5, 7]);
  });

  it("不修改入参数组（纯函数）", () => {
    const input = [...base];
    rankLeaderboard(base, "rate");
    expect(base).toEqual(input);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/domain/leaderboard.test.ts`
Expected: FAIL，报模块 `~/domain/leaderboard` 不存在

- [ ] **Step 3: 最小实现**

```typescript
// app/domain/leaderboard.ts
import Decimal from "decimal.js";
import { roundInt } from "./money";

/**
 * 收益排行榜的领域层（spec §2/§4.1）。
 *
 * 口径是本文件唯一的「为什么」：
 *   累计入金 = initialCash + totalCheckin
 *   总收益   = 总资产 − 累计入金（已实现 + 浮动盈亏都在内）
 *   收益率   = 总收益 ÷ 累计入金
 * 这样清仓落袋的利润不会从榜上消失（浮盈口径会），签到是入金不算收益（刷不了榜）。
 * 与 asset-timeline 的「净入金」概念一致，全站口径自洽。
 */

/** 单用户原始数据（service 层从 D1 查出后拼好喂进来） */
export interface LeaderboardEntryInput {
  userId: number;
  username: string;
  /** 持仓市值合计（分），由 service 用最新净值算好 */
  marketValueCents: number;
  cashCents: number;
  initialCashCents: number;
  totalCheckinCents: number;
  /** 是否有过 confirmed 订单（上榜门槛） */
  hasTrades: boolean;
}

/** 计算完口径的条目。rank 由 rankLeaderboard 填，compute 出来时恒为 0 */
export interface LeaderboardEntry extends LeaderboardEntryInput {
  /** 总资产（分）= 市值 + 现金 */
  totalAssetCents: number;
  /** 总收益（分）= 总资产 − 累计入金 */
  totalPnlCents: number;
  /** 收益率（普通小数，0.05 表示 +5%） */
  totalPnlRate: number;
  rank: number;
}

/**
 * 过滤（门槛）+ 算口径。纯函数，不排序。
 * 门槛：从未成交的纯新号不上榜——它们收益恒为 0，榜上一堆 0% 空号没有信息量。
 */
export function computeLeaderboard(
  rows: LeaderboardEntryInput[],
): LeaderboardEntry[] {
  return rows
    .filter(r => r.hasTrades)
    .map((r) => {
      // 累计入金 = 初始本金 + 签到（两者都是 account 表现成字段）
      const depositedCents
        = r.initialCashCents + r.totalCheckinCents;
      const totalAssetCents = r.marketValueCents + r.cashCents;
      const totalPnlCents = totalAssetCents - depositedCents;
      // 除零守卫：注册即有 init 入金，理论到不了 0，守卫只是不让 NaN 上榜
      const totalPnlRate
        = depositedCents === 0
          ? 0
          : new Decimal(totalPnlCents).div(depositedCents).toNumber();

      return {
        ...r,
        totalAssetCents,
        totalPnlCents,
        totalPnlRate,
        rank: 0,
      };
    });
}

/**
 * 排序并填 rank。by = 'rate'（收益率榜）/ 'pnl'（总收益榜）。
 *
 * 同分同名次（1,2,2,4 型）：先按指标降序，同指标按 userId 升序破平，
 * rank = 「严格大于自己的条目数 + 1」，天然产出竞赛排名。
 */
export function rankLeaderboard(
  entries: LeaderboardEntry[],
  by: "rate" | "pnl",
): LeaderboardEntry[] {
  const metric = (e: LeaderboardEntry) => (by === "rate" ? e.totalPnlRate : e.totalPnlCents);
  const sorted = [...entries].sort((a, b) => {
    const d = metric(b) - metric(a);
    return d !== 0 ? d : a.userId - b.userId;
  });
  return sorted.map((e) => {
    // 比较用 Decimal：rate 是普通小数，浮点直接比较在极接近时会误判同名次
    const strictlyGreater = sorted.filter(other =>
      new Decimal(metric(other)).greaterThan(metric(e)),
    ).length;
    return { ...e, rank: strictlyGreater + 1 };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/domain/leaderboard.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 跑 lint**

Run: `pnpm lint`
Expected: 无新增报错

- [ ] **Step 6: Commit**

```bash
git add app/domain/leaderboard.ts tests/domain/leaderboard.test.ts
git commit -m "feat(leaderboard): 领域层口径计算与排序——累计口径，清仓利润保留"
```

---

### Task 2: 服务层——D1 聚合查询

**Files:**
- Create: `app/services/leaderboard-service.ts`
- Test: `tests/services/leaderboard.test.ts`

**Interfaces:**
- Consumes: `computeLeaderboard` / `rankLeaderboard`（Task 1 签名）；`latestNavMap`（`app/services/portfolio-service.ts`，签名 `latestNavMap(db, codes) → Map<string, { navDate; unitNav; growthRate }>`）；`navToDecimal`/`sharesToDecimal`（`app/domain/money.ts`）；表 `user`/`account`/`holding`/`orders`
- Produces（Task 3 依赖）:
  - `interface LeaderboardView { byRate: LeaderboardEntry[]; byPnl: LeaderboardEntry[] }`
  - `getLeaderboard(db: Db): Promise<LeaderboardView>`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/services/leaderboard.test.ts
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import {
  account,
  checkin,
  dcaPlan,
  fund,
  fundNav,
  holding,
  orders,
  session,
  shareLot,
  transactions,
  user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getLeaderboard } from "~/services/leaderboard-service";
import { registerUser } from "~/services/auth";

/** 与 settle.test.ts 同款的清理/造数范式 */
async function resetAll() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(shareLot);
  await db.delete(holding);
  await db.delete(orders);
  await db.delete(dcaPlan);
  await db.delete(checkin);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
  await db.delete(fundNav);
  await db.delete(fund);
}

async function seedFund(code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试成长混合",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

/** 写入某日净值（×10000） */
async function seedNav(navDate: string, unitNav: number, code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fundNav).values({
    fundCode: code,
    navDate,
    unitNav,
    accNav: unitNav,
    growthRate: 0,
  });
}

async function seedUser(name: string) {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

/**
 * 造一笔已确认订单（只为了过「hasTrades」门槛，成交数字不重要）。
 * placeBuyOrder + settle 太重，直接插 orders 行——排行榜只看 status。
 */
async function seedConfirmedOrder(userId: number) {
  const db = getDb(env.DB);
  await db.insert(orders).values({
    userId,
    fundCode: "000001",
    side: "buy",
    status: "confirmed",
    source: "manual",
    amount: 100_000,
    placeDate: "2026-08-24",
    confirmDate: "2026-08-25",
    dealNav: 15_000,
    dealShares: 6_568_133,
    dealAmount: 98_522,
    fee: 1_478,
    createdAt: Date.parse("2026-08-24T06:00:00Z"),
  });
}

beforeEach(resetAll);

describe("getLeaderboard", () => {
  it("空库返回空榜", async () => {
    const db = getDb(env.DB);
    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(0);
    expect(lb.byPnl).toHaveLength(0);
  });

  it("三用户：门槛过滤 + 市值估值 + 两维排序", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 15_000); // 净值 1.5

    // alice：10 万入金，花 2000 元买 2000 份（份额 ×10000 存 20_000_000），
    // 成本 200_000 分；现金 9.8 万。净值 1.5 → 市值 300_000 分，
    // 总资产 10_100_000，收益 +100_000（+1%）
    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 20_000_000,
      totalCost: 200_000,
    });
    await db
      .update(account)
      .set({ cash: 9_800_000 })
      .where(eq(account.userId, alice));

    // bob：纯签到 1000 元、无成交 → 不上榜
    const bob = await seedUser("bob");
    await db
      .update(account)
      .set({ cash: 10_010_000, totalCheckin: 10_000 })
      .where(eq(account.userId, bob));

    // carol：10 万入金，空仓现金 10.5 万 → 收益 +5%
    const carol = await seedUser("carol");
    await seedConfirmedOrder(carol);
    await db
      .update(account)
      .set({ cash: 10_500_000 })
      .where(eq(account.userId, carol));

    const lb = await getLeaderboard(db);

    // bob 被门槛过滤；carol(+5%) 压过 alice(+1%)
    expect(lb.byRate.map(e => e.username)).toEqual(["carol", "alice"]);
    expect(lb.byRate[0].totalPnlRate).toBeCloseTo(0.05, 10);
    // alice：市值 = 2000 份 × 1.5 × 100 = 300_000 分
    expect(lb.byRate[1].marketValueCents).toBe(300_000);
    expect(lb.byRate[1].totalAssetCents).toBe(10_100_000);
    expect(lb.byRate[1].totalPnlCents).toBe(100_000);
    // 总收益榜同序（+500_000 > +100_000）
    expect(lb.byPnl.map(e => e.username)).toEqual(["carol", "alice"]);
  });

  it("持仓无净值时用成本兜底（同 getPortfolio 口径）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    // 注意：不 seedNav——holding 有持仓但 fund_nav 空

    const alice = await seedUser("alice");
    await seedConfirmedOrder(alice);
    await db.insert(holding).values({
      userId: alice,
      fundCode: "000001",
      totalShares: 20_000_000,
      totalCost: 200_000,
    });
    await db
      .update(account)
      .set({ cash: 9_800_000 })
      .where(eq(account.userId, alice));

    const lb = await getLeaderboard(db);
    // 无净值 → 市值按成本 200_000 兜底 → 总资产 10 万，收益 0
    expect(lb.byRate[0].marketValueCents).toBe(200_000);
    expect(lb.byRate[0].totalPnlCents).toBe(0);
  });

  it("pending/failed 订单不算门槛", async () => {
    const db = getDb(env.DB);
    const alice = await seedUser("alice");
    await db.insert(orders).values({
      userId: alice,
      fundCode: "000001",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 100_000,
      placeDate: "2026-08-24",
      confirmDate: "2026-08-25",
      createdAt: Date.now(),
    });

    const lb = await getLeaderboard(db);
    expect(lb.byRate).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:workers tests/services/leaderboard.test.ts`
Expected: FAIL，报模块 `~/services/leaderboard-service` 不存在

- [ ] **Step 3: 最小实现**

```typescript
// app/services/leaderboard-service.ts
import type { Db } from "~/db/client";
import type { LeaderboardEntry, LeaderboardEntryInput } from "~/domain/leaderboard";
import { eq } from "drizzle-orm";
import { navToDecimal, sharesToDecimal, YUAN } from "~/domain/money";
import {
  computeLeaderboard,
  rankLeaderboard,
} from "~/domain/leaderboard";
import { account, holding, orders, user } from "~/db/schema";
import { roundInt } from "~/domain/money";
import { latestNavMap } from "~/services/portfolio-service";

/**
 * 排行榜 service（spec §4.2）：四次查询拼 LeaderboardEntryInput[]，喂领域层。
 *
 * 刻意不做 KV 缓存 / cron 物化：模拟盘用户量小，全量内存计算绰绰有余，
 * KV 写入 1000 次/天是全站最紧额度，别去挤。
 * 任何一步查不到数据都不抛：空数据让页面渲染空态。
 */

/** 页面直接消费的视图：两个维度各自排好序 */
export interface LeaderboardView {
  byRate: LeaderboardEntry[];
  byPnl: LeaderboardEntry[];
}

export async function getLeaderboard(db: Db): Promise<LeaderboardView> {
  // ── 查询 1：全量用户 + 账户 ──────────────────────────────────────
  const users = await db
    .select({
      userId: user.id,
      username: user.username,
      cash: account.cash,
      initialCash: account.initialCash,
      totalCheckin: account.totalCheckin,
    })
    .from(user)
    .leftJoin(account, eq(account.userId, user.id));

  // ── 查询 2：全量持仓 ─────────────────────────────────────────────
  const holdings = await db.select().from(holding);

  // ── 查询 3：最新净值（一次取所有涉及基金） ────────────────────────
  const codes = [...new Set(holdings.map(h => h.fundCode))];
  const navMap = await latestNavMap(db, codes);

  // ── 查询 4：哪些用户有过 confirmed 订单（上榜门槛） ────────────────
  const confirmedUserIds = new Set(
    (await db
      .selectDistinct({ userId: orders.userId })
      .from(orders)
      .where(eq(orders.status, "confirmed")))
      .map(r => r.userId),
  );

  // ── 市值聚合：userId → 持仓市值合计 ────────────────────────────────
  // 估值口径与 getPortfolio 完全一致：无净值时按成本兜底，不另立口径
  const marketValueByUser = new Map<number, number>();
  for (const h of holdings) {
    // 过滤已清仓行（份额 0 的持仓记录还在表里，市值贡献为 0）
    if (h.totalShares <= 0)
      continue;
    const navInfo = navMap.get(h.fundCode);
    // 无净值 → 成本兜底（市值 = 成本）
    const mvCents = navInfo
      ? roundInt(
          sharesToDecimal(h.totalShares)
            .mul(navToDecimal(navInfo.unitNav))
            .mul(YUAN),
        )
      : h.totalCost;
    const prev = marketValueByUser.get(h.userId) ?? 0;
    marketValueByUser.set(h.userId, prev + mvCents);
  }

  // ── 拼 LeaderboardEntryInput 喂领域层 ─────────────────────────────
  const inputs: LeaderboardEntryInput[] = users.map((u) => {
    const mv = marketValueByUser.get(u.userId) ?? 0;
    return {
      userId: u.userId,
      username: u.username,
      marketValueCents: mv,
      // leftJoin 无 account 时兜 0（防御，正常注册必有 account）
      cashCents: u.cash ?? 0,
      initialCashCents: u.initialCash ?? 0,
      totalCheckinCents: u.totalCheckin ?? 0,
      hasTrades: confirmedUserIds.has(u.userId),
    };
  });

  const entries = computeLeaderboard(inputs);
  return {
    byRate: rankLeaderboard(entries, "rate"),
    byPnl: rankLeaderboard(entries, "pnl"),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:workers tests/services/leaderboard.test.ts`
Expected: PASS。注意份额是 ×10000 缩放：`totalShares=20_000_000` 表示 2000 份，市值 = 2000 × 1.5 × 100 = 300_000 分，断言已按此写好。

- [ ] **Step 5: Commit**

```bash
git add app/services/leaderboard-service.ts tests/services/leaderboard.test.ts
git commit -m "feat(leaderboard): service 层 D1 四查聚合，口径复用 getPortfolio 兜底"
```

---

### Task 3: 路由与页面

**Files:**
- Create: `app/routes/leaderboard.tsx`
- Modify: `app/routes.ts`（公开段加一行）
- Modify: `app/domain/nav.ts`（NAV_ITEMS 加项）
- Modify: `tests/domain/nav.test.ts`（补断言）

**Interfaces:**
- Consumes: `getLeaderboard`（Task 2 签名）、`getCurrentUser`（`~/services/guard`）、`LeaderboardEntry`（Task 1）、UI 组件 `SectionCard`/`EmptyState`/`PnlText`/`fmtYuan`/`pnlColor`（均为现成导出）
- Produces: 公开路由 `/leaderboard`

- [ ] **Step 1: 注册路由 + 导航项，先让 nav 测试红**

`app/routes.ts` 公开段（`route("master", ...)` 那组里）加：

```typescript
route("leaderboard", "routes/leaderboard.tsx"),
```

`app/domain/nav.ts` 的 `NAV_ITEMS` 改为（排行榜插在主理人的盘之后，无前缀冲突，顺序不敏感但保持信息架构：首页 → 围观 → 竞技）：

```typescript
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "/", label: "首页" },
  { key: "/master", label: "主理人的盘" },
  { key: "/leaderboard", label: "排行榜" },
  { key: "/funds", label: "基金" },
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];
```

`tests/domain/nav.test.ts` 顶部 describe 前加一个用例（文件内现有 describe 内补 it）：

```typescript
it("/leaderboard 命中「排行榜」导航项", () => {
  expect(resolveSelectedKey("/leaderboard", NAV_ITEMS)).toBe("/leaderboard");
});
```

- [ ] **Step 2: 跑 nav 测试确认失败**

Run: `pnpm test tests/domain/nav.test.ts`
Expected: FAIL——路由文件 `routes/leaderboard.tsx` 不存在导致 typegen 相关报错，或 nav 断言红（取决于 typegen 是否先挂）。若是 typegen 挂：先建一个占位 `app/routes/leaderboard.tsx`（导出空 loader 与组件 `export default () => null`）让测试能跑，下一步再填真身。**占位文件在本 Task 结束前必须被真实现替换。**

- [ ] **Step 3: 写页面真身**

```tsx
// app/routes/leaderboard.tsx
import type { Route } from "./+types/leaderboard";
import type { LeaderboardEntry } from "~/domain/leaderboard";
import { Space, Tabs, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { getLeaderboard } from "~/services/leaderboard-service";
import { COLOR } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "收益排行榜 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  // 游客也可看（公开页，与 /master 同级）；已登录则带上 id 用于钉「我的排名」
  const [me, lb] = await Promise.all([
    getCurrentUser(request, db),
    getLeaderboard(db),
  ]);
  return { me, lb };
}

/** 名次徽章：前三金/银/铜色，其余灰 */
function RankBadge({ rank }: { rank: number }) {
  const color = rank === 1 ? "#f5a623" : rank === 2 ? "#a0a0a0" : rank === 3 ? "#b07840" : undefined;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 12,
        background: color ?? "transparent",
        color: color ? "#fff" : COLOR.textSecondary,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {rank}
    </span>
  );
}

/** 单行榜单条目 */
function LeaderRow({
  entry,
  meId,
}: {
  entry: LeaderboardEntry;
  meId: number | null;
}) {
  const isMe = meId !== null && entry.userId === meId;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 0",
        borderBottom: `1px solid ${COLOR.border}`,
        background: isMe ? "rgba(22,119,255,0.06)" : undefined,
      }}
    >
      <RankBadge rank={entry.rank} />
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontWeight: 500, color: COLOR.textPrimary }}>
          {entry.username}
          {isMe && <Tag color="blue" style={{ marginLeft: 8 }}>我</Tag>}
        </div>
        <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
          总资产 {fmtYuan(entry.totalAssetCents)} 元
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <PnlText cents={entry.totalPnlCents} size={14} />
        <div style={{ marginTop: 2 }}>
          <PnlText rate={entry.totalPnlRate} size={12} />
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard({ loaderData }: Route.ComponentProps) {
  const { me, lb } = loaderData;
  const meId = me?.id ?? null;

  /** 自己的条目（可能不在榜上：没成交过 / 没登录） */
  const mine
    = meId === null ? null : lb.byRate.find(e => e.userId === meId) ?? null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          收益排行榜
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          总收益 = 总资产 − 累计入金（初始本金 + 签到奖励）。已清仓落袋的收益也保留在榜上，
          只签到不买基金刷不了榜。
        </Paragraph>
      </div>

      <SectionCard>
        {lb.byRate.length === 0
          ? (
              <EmptyState description="还没有人开过单">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  注册后买第一只基金，就能上榜了
                </Typography.Text>
              </EmptyState>
            )
          : (
              <Tabs
                defaultActiveKey="rate"
                items={[
                  {
                    key: "rate",
                    label: "收益率榜",
                    children: lb.byRate.map(e => (
                      <LeaderRow key={e.userId} entry={e} meId={meId} />
                    )),
                  },
                  {
                    key: "pnl",
                    label: "总收益榜",
                    children: lb.byPnl.map(e => (
                      <LeaderRow key={e.userId} entry={e} meId={meId} />
                    )),
                  },
                ]}
              />
            )}
      </SectionCard>

      {/* 已登录且不在前排：底部钉一行「我的排名」。
          不在榜上（没成交）时也提示，形成引导闭环 */}
      {meId !== null && (
        <SectionCard title="我的排名">
          {mine
            ? (
                <LeaderRow entry={mine} meId={meId} />
              )
            : (
                <EmptyState description="还没有上榜——下一单就能上榜" />
              )}
        </SectionCard>
      )}
    </Space>
  );
}
```

- [ ] **Step 4: 跑全部相关测试 + lint + typecheck**

```bash
pnpm test tests/domain/nav.test.ts
pnpm test tests/domain/leaderboard.test.ts
pnpm lint
pnpm typecheck
```

Expected: 全绿。typecheck 会自动跑 `react-router typegen`，`./+types/leaderboard` 生成后才类型安全。

- [ ] **Step 5: 本地起服务人工看一眼**

```bash
pnpm dev
```

浏览器开 `http://localhost:5173/leaderboard`：空态文案、两个 tab、我的排名卡片、顶栏「排行榜」导航项。截图或口头确认观感。

- [ ] **Step 6: Commit**

```bash
git add app/routes/leaderboard.tsx app/routes.ts app/domain/nav.ts tests/domain/nav.test.ts
git commit -m "feat(leaderboard): 公开页 /leaderboard——双 tab 榜单 + 我的排名"
```

---

### Task 4: 首页引流卡片

**Files:**
- Modify: `app/routes/_index.tsx`（「主理人的示范盘」卡片与卖点 Row 之间插一张卡）

**Interfaces:**
- Consumes: 现有 `SectionCard`/`Button`/`Title`/`Paragraph`、`CARD_SHADOW`（`~/theme`）
- Produces: 无（纯展示）

- [ ] **Step 1: 加卡片**

在 `_index.tsx` 的「主理人的示范盘」`SectionCard`（`loaderData.admin === null` 三元）之后、卖点 `Row` 之前插入：

```tsx
{/* 排行榜引流：游客与已登录都给入口（移动端底栏进不去排行榜，这是移动端唯一入口） */}
<SectionCard
  title="收益排行榜"
  extra={<a href="/leaderboard">看完整榜单 →</a>}
>
  <Paragraph type="secondary" style={{ marginBottom: 16 }}>
    全站用户的模拟盘同台竞技：收益率、总收益两个维度实时排名。
    注册开第一单，看看你能不能排到主理人前面。
  </Paragraph>
  <Button type="primary" href="/leaderboard">
    去看排行榜
  </Button>
</SectionCard>
```

- [ ] **Step 2: lint + typecheck + 本地确认**

```bash
pnpm lint && pnpm typecheck
```

`pnpm dev` 起服务，首页确认卡片出现在主理人盘与卖点之间，链接可达 `/leaderboard`。

- [ ] **Step 3: Commit**

```bash
git add app/routes/_index.tsx
git commit -m "feat(leaderboard): 首页排行榜引流卡片（移动端唯一入口）"
```

---

### Task 5: 全量校验与收尾

**Files:**
- Modify: `CLAUDE.md`（文档表格加一行）、`docs/superpowers/plans/2026-08-28-leaderboard.md`（盖状态戳）

**Interfaces:**
- Consumes: 无
- Produces: 完工状态

- [ ] **Step 1: 全量校验**

```bash
pnpm verify
```

Expected: lint + typecheck + domain 单测全绿。

```bash
pnpm test:workers
```

Expected: services 全绿（含新 leaderboard.test.ts 与既有测试——确认没把别人的测试搞挂）。

- [ ] **Step 2: 人工验收**

`pnpm dev` 起服务，造点数据（或用 `npx wrangler d1 execute fund-plan-db --local` 手插几个用户），确认：

1. 榜单排序正确（收益率榜、总收益榜）
2. 空态、我的排名、`/leaderboard` 公开可访问（登出状态）
3. 顶栏新导航项高亮正确
4. 移动端宽度（DevTools 375px）下榜单行不溢出

- [ ] **Step 3: 更新文档并盖状态戳**

`CLAUDE.md` 的计划表格加一行：

```markdown
| `2026-08-28-leaderboard.md` | 已完成 `<起>..<止>` |
```

（`<起>..<止>` 填实际 commit 区间。）

计划文件标题下、`For agentic workers` 行之前盖：

```text
> ## 状态：已完成 · 2026-08-28
>
> 实现区间 `<起>..<止>`
>
> - **下方复选框全部未勾，但工作已完成。** 别把「未勾」读成「未做」，勿照此重新施工。
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-08-28-leaderboard.md
git commit -m "docs(leaderboard): 完工收尾——计划状态戳与文档索引"
```

---

## Self-Review 记录

- **Spec 覆盖**：§2 口径（Task 1）、§3 门槛与字段（Task 1/2/3）、§4.1 domain（Task 1）、§4.2 service（Task 2）、§4.3 页面（Task 3）、§4.4 导航（Task 3）+ 首页引流（Task 4）、§5 错误处理（Task 2/3 空态与兜底）、§6 测试（Task 1/2/3）——全覆盖
- **占位符扫描**：无 TBD/TODO；Task 3 Step 2 的「占位文件」有明确的替换指令
- **类型一致性**：`LeaderboardEntryInput`/`LeaderboardEntry`/`computeLeaderboard`/`rankLeaderboard`/`getLeaderboard`/`LeaderboardView` 各 Task 引用签名一致
- **已修正**：初稿 Task 2 测试的份额缩放数字与注释不自洽（totalShares 按 ×10000 算清后重写造数）；Task 3 页面多余 import（`computeLeaderboard`/`Empty`）已从代码块中移除
