# 期四·发现与详情 实施计划

> ## 状态：已完成 · 2026-08-26
>
> 实现区间 `5f74dcf..2d59b74`
>
> | Task | commit    | 交付                                                  |
> | ---- | --------- | ----------------------------------------------------- |
> | 1    | `5f74dcf` | `watchlist` 自选表 + 迁移（复合主键防重复关注）        |
> | 2    | `f5bd73f` | 抽 `ensureFund` 到 `fund-data.ts`，详情页复用         |
> | 3    | `cf9e1a9` | `watchlist-service` + 导出 `latestNavMap`            |
> | 4    | `22b02d1` | `calcPeriodReturns` 阶段涨幅纯函数 + TDD 测试         |
> | 5    | `d815fb0` | 四个东财 fetcher（排行/详情/重仓股/沪深300）+ 测试    |
> | 6    | `4665846` | `getFundRank` 东财排行 + 本地降级                     |
> | 7    | `dbb2f1b` | `/me/watchlist` 自选列表 + 导航加「自选」             |
> | 8    | `afea5be` | `/funds` 升级发现页（搜索 + 类型×周期排行榜）         |
> | 9    | `ae72a99` | 详情页增强（阶段涨幅/经理/规模/重仓股/加自选/定投）  |
> | 10   | `2d59b74` | 沪深300 基准叠加（彩蛋，标「可砍」——已落地）          |
>
> - **下方复选框全部未勾，但工作已完成。** 别把「未勾」读成「未做」，勿照此重新施工。
> - ✅ 本文无作废段落 —— 计划原文是对的，Self-Review 5 项验收逐字落地；
>   T10 彩蛋（沪深300 基准叠加）虽标「可砍」也一并做了。
>   验证基线：`pnpm verify`（lint+typecheck+159 领域测试）+ `pnpm test:workers`
>   （10 文件 96 应用层测试）全绿，工作区 clean。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把交易体验的最后一公里补齐——新增自选（唯一新表）、`/funds` 升级为带排行榜的发现页、详情页增强阶段涨幅表/经理/规模/成立日/重仓股/加自选/定投入口，首访净值拉取 120→400 天。

**Architecture:** 不动撮合/精度/T+1 内核。`watchlist` 是本次唯一新表（复合主键防重复关注）。`ensureFund` 从 `funds.$code` loader 抽到 `fund-data.ts` 供自选与详情复用。`performance.ts` 是新增的 domain 纯函数（TDD，算阶段涨幅，本地 `fund_nav` 计算，不新增接口依赖）。东财三个新接口各包一层 fetcher + KV 缓存 + 降级（拉不到只是少一张卡片，不报错）。`/funds` 排行榜东财接口挂掉时走本地降级（用 `calcPeriodReturns` 算已入库基金排行，榜单短但不空）。

**Tech Stack:** React Router 8 framework mode（flat routes）+ antd 6（`Table`/`Segmented`/`DataRow` 均 SSR 安全）+ Drizzle/D1 + decimal.js + dayjs。

**Spec:** `docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md` §6（`performance.ts` 算法）、§7（`watchlist` 表 + `ensureFund`）、§8（数据接入层扩展与风险分级）、§9（页面清单：`/funds` 升级、`/funds/:code` 增强、`/me/watchlist` 新增、root 导航加「自选」）、§10（期四交付与验收）、§11（测试策略）、§12（沪深300 可砍）。东财接口头规则见 CLAUDE.md「已知陷阱」与 `app/services/fund-data.ts` 顶部注释。

## Global Constraints

- 包管理器**必须用 pnpm**，不要 npm。
- **精度铁律**：DB 全整数——金额×100（分）、份额×10000、净值×10000、费率×10000（万分之）。中间运算一律 decimal.js，最后 `roundInt()`（HALF_UP）回整数。**绝不用 JS 浮点数算钱**。工具函数全在 `app/domain/money.ts`。阶段涨幅（`PeriodReturns`）沿用万分之整数（`rateToPercent` 直接展示）。
- **三层洁净架构硬约束**：`app/domain/` 纯函数不依赖 D1/网络；`app/services/` 依赖 D1/网络喂 domain；`app/routes/` 只装配。不跨层。本期新增的 `calcPeriodReturns` 是 domain 纯函数（TDD）；`ensureFund`/`fetchFundRank`/`fetchFundDetail`/`fetchFundPosition`/`fetchIndexNav` 是数据接入层（`fund-data.ts`）；`watchlist-service`/`rank-service` 是应用层。
- **颜色单一出处** `app/theme.ts`（`COLOR`/`pnlColor`）；不写十六进制色值字面量；antd 语义色不映射涨跌；涨红跌绿。日涨跌用 `pnlColor` 或 `PnlText`，不占红绿给操作色。
- **东财接口头规则**（实测见 `fund-data.ts` 顶部注释）：`rankhandler`（网页端）用 `EM_WEB_HEADERS`（带 Referer）；`fundmobapi`（移动端）用 `EM_MOBILE_HEADERS`（**绝不能带浏览器 UA**，否则 200 但 `Datas` 空）；`push2his`（沪深300，新域名）带 `Referer: https://quote.eastmoney.com/`。别合并 `EM_WEB_HEADERS`/`EM_MOBILE_HEADERS`。
- **数据接入层三条铁律**：全部走 KV 缓存；异常不抛给上层（回退缓存/空值）；数值在这层转整数。拉不到数据 → 不渲染那张卡片，绝不白屏。
- canvas 库必须 lazy+`useSyncExternalStore`+SSR/加载期同一骨架屏。本期**不引入新 canvas 库**（沪深300基准叠加复用现有 `NavChart`，不新增图表库）。
- 测试两套：领域 `pnpm test tests/domain/x.test.ts`，应用层 `pnpm test:workers tests/services/x.test.ts`，**不加 `--`**。
- 改了 schema 后**必须** `pnpm db:generate` 再 `pnpm db:migrate:local`（本地）才能跑 workers 测试（测试从 `drizzle/` 读迁移建表）。
- **SSR 安全**：组件内不直接 `new Date()`/无参 `dayjs()`；需要「今天」由 loader 在 server 端算好传入。**service 层可以用 `new Date()`/`Date.now()`**（settle.ts 等已如此）。
- **提交粒度：一个 Task 一个 commit，不要更细。** code review 的修正 `git commit --amend` 进该 Task 自己的 commit；「计划写错→改计划→再实现」走同一个 commit，不拆两条。
- commit message 结尾：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- `centsToYuan`（**非** `fmtYuan`）对任何回流进 `<Input>` 的值是 load-bearing（带逗号 → `Number()` 得 NaN）。本期 `BuyPanel` 不动，新加的定投入口若引入输入框沿用此约束。
- `HoldingList.renderNote` 必填；`FundListItem.href` 可选（期一已留口子）。排行榜与自选列表用 `FundListItem` 卡片（§4.0 实体列表换卡片），不回退成 `Table`。

---

## File Structure

| 文件 | 动作 | 职责 |
| ---- | ---- | ---- |
| `app/db/schema.ts` | 改 | 新增 `watchlist` 表（复合主键 `(userId, fundCode)` 防重复关注），补 `schema` 导出与 `WatchlistRow` 类型 |
| `drizzle/0001_*.sql` | 生成 | `pnpm db:generate` 产出的 watchlist 建表迁移 |
| `tests/db/schema.test.ts` | 改 | 补一条 watchlist 复合主键防重复关注的测试 |
| `app/services/fund-data.ts` | 改 | 抽 `ensureFund(db, env, code)`；新增 `fetchFundRank`、`fetchFundDetail`（经理/规模/成立日/公司/基准/费率）、`fetchFundPosition`（重仓股）、`fetchIndexNav`（沪深300，可砍） |
| `tests/domain/fund-data.test.ts` | 改 | 给四个新 fetcher 补 stub 测试（解析、降级返回空/null、KV 缓存命中不打网络） |
| `app/services/portfolio-service.ts` | 改 | 导出 `latestNavMap`，map 值追加 `growthRate`（供 watchlist-service 取日涨跌；既有 `getPortfolio`/`getHoldingDetail` 读法不变） |
| `app/services/watchlist-service.ts` | 建 | `addWatch`/`removeWatch`/`listWatch`/`isWatched`；`addWatch` 先 `ensureFund` 落档案再 `onConflictDoNothing` 插入 |
| `tests/services/watchlist.test.ts` | 建 | workers 环境测：重复关注幂等、级联删除、`listWatch` 带基金名+净值、`isWatched` |
| `app/domain/performance.ts` | 建 | `calcPeriodReturns(series)` 纯函数：近1周/1月/3月/6月/1年/YTD/成立来，万分之整数，前向填充，数据不足 null |
| `tests/domain/performance.test.ts` | 建 | TDD：空/单点全 null、前向填充（目标日落在非交易日）、YTD 跨年、近1年需足够数据、成立来 |
| `app/services/rank-service.ts` | 建 | `getFundRank(db, env, type, period)`：东财 `fetchFundRank` + 本地降级（用 `calcPeriodReturns` 算已入库基金排行，按 `type` 前缀过滤，榜单短但不空） |
| `tests/services/rank.test.ts` | 建 | workers 环境测：东财有数据时直用、东财挂掉时本地降级非空且按周期降序、类型过滤 |
| `app/components/PeriodReturnTable.tsx` | 建 | 阶段涨幅表 UI，消费 `PeriodReturns`，null 渲染「—」，值走 `rateToPercent` |
| `app/routes/me.watchlist.tsx` | 建 | 自选列表页（`FundListItem` 卡片）+ add/remove action |
| `app/routes.ts` | 改 | 加 `route("me/watchlist", "routes/me.watchlist.tsx")` |
| `app/root.tsx` | 改 | 导航加「自选」入口（放在「基金」与「我的」之间，`selectedKey` 匹配顺序要求它在 `/me` 之前） |
| `app/routes/funds._index.tsx` | 改 | 升级发现页：搜索框（保留）+ 排行榜（类型 Tab × 周期切换，URL 驱动 `?type=&period=`），删硬编码 `SUGGESTED` |
| `app/routes/funds.$code.tsx` | 改 | `ensureFund` 替换内联档案逻辑；首访净值 120→400；加阶段涨幅表、基金概况（经理/规模/成立日/公司/基准/管理费/托管费）、重仓股、加自选、定投入口 |
| `app/components/NavChart.tsx` | 改（T10 可砍） | 接受可选 `benchmark` 序列，叠加归一化基准线（沪深300） |

任务依赖：T1（表）→ T3（watchlist-service，需表+ensureFund）；T2（ensureFund）→ T3、T9；T3 → T7、T9；T4（performance）→ T6、T9；T5（fetchers）→ T6、T9、T10；T6（rank-service，需 T4+T5）→ T8；T7（watchlist 路由，需 T3）独立于 T8；T8（发现页，需 T6）；T9（详情页，需 T2+T3+T4+T5）；T10（沪深300，需 T5，可砍）。

按依赖排施工序：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10。

---

### Task 1: `watchlist` 表 + 迁移 + schema 测试

**Files:**
- Modify: `app/db/schema.ts`（`checkin` 表后追加 `watchlist`；`schema` 导出对象追加；末尾追加 `WatchlistRow` 类型）
- Generate: `drizzle/0001_*.sql`（`pnpm db:generate` 产出，文件名由 drizzle-kit 定）
- Modify: `tests/db/schema.test.ts`（补一条测试）
- Run: `pnpm db:migrate:local`（建本地表，否则 workers 测试无表）

**Interfaces:**
- Consumes: `sqliteTable`/`integer`/`text`/`primaryKey`（已在 schema.ts import）、`user`（外键）
- Produces（后续任务消费）:
  ```ts
  export const watchlist = sqliteTable("watchlist", { ... }); // 见下
  export type WatchlistRow = typeof watchlist.$inferSelect;
  ```

- [ ] **Step 1: 在 `app/db/schema.ts` 追加 `watchlist` 表**

在 `checkin` 表定义之后、`export const schema = {` 之前插入：
```ts
/**
 * 自选基金（用户收藏的基金，与持仓无关）。
 *
 * 复合主键 (userId, fundCode) 天然防重复关注，不需要额外唯一约束——
 * 重复 INSERT 用 onConflictDoNothing 吞掉即可。
 * userId 级联删除：用户没了自选也跟着没。
 */
export const watchlist = sqliteTable(
  "watchlist",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.fundCode] })],
);
```

在 `export const schema = { ... }` 对象里 `checkin,` 后追加一行 `watchlist,`。

在文件末尾便捷类型区追加：
```ts
export type WatchlistRow = typeof watchlist.$inferSelect;
```

- [ ] **Step 2: 生成迁移**

Run: `pnpm db:generate`
Expected: 在 `drizzle/` 下生成 `0001_*.sql`（含 `CREATE TABLE \`watchlist\`` + 复合主键）。记下生成的文件名。

- [ ] **Step 3: 应用到本地 D1**

Run: `pnpm db:migrate:local`
Expected: `🚣 1 migration applied`（或类似），本地库有了 watchlist 表。

- [ ] **Step 4: 补 schema 测试**

在 `tests/db/schema.test.ts` 末尾（最后一个 `it` 之后、`describe` 闭合之前）追加：
```ts
  it("watchlist 复合主键 (user_id, fund_code) 防重复关注", async () => {
    const db = getDb(env.DB);
    const [u] = await db
      .insert(user)
      .values({
        username: "watcher",
        passwordHash: "h",
        salt: "s",
        role: "user",
        createdAt: Date.now(),
      })
      .returning();

    await db.insert(watchlist).values({
      userId: u.id,
      fundCode: "000001",
      createdAt: Date.now(),
    });

    // 同一用户再关注同一只基金 → 复合主键拒绝（onConflictDoNothing 在 service 层吞，这里直接插应报错）
    await expect(
      db.insert(watchlist).values({
        userId: u.id,
        fundCode: "000001",
        createdAt: Date.now(),
      }),
    ).rejects.toThrow();
  });
```

并在 `tests/db/schema.test.ts` 顶部 schema import 里加 `watchlist`：
```ts
import { checkin, fund, fundNav, user, watchlist } from "~/db/schema";
```

- [ ] **Step 5: 跑 workers 测试确认通过**

Run: `pnpm test:workers tests/db/schema.test.ts`
Expected: PASS（含新增的 watchlist 测试）

- [ ] **Step 6: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净

- [ ] **Step 7: Commit**

```bash
git add app/db/schema.ts drizzle/ tests/db/schema.test.ts
git commit -m "feat(db): watchlist 自选表 + 迁移（复合主键防重复关注）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 抽 `ensureFund` 到 `fund-data.ts`，`funds.$code` 接线

**Files:**
- Modify: `app/services/fund-data.ts`（顶部补 schema/db import；新增 `ensureFund`）
- Modify: `app/routes/funds.$code.tsx`（loader 的档案块 :37-70 替换为 `ensureFund` 调用）

**Interfaces:**
- Consumes: `fund`（`~/db/schema`）、`Db`（`~/db/client`）、`fetchFundBasic`（同文件）、`DEFAULT_REDEEM_TIERS`（`~/domain/redeem`）、`eq`（`drizzle-orm`）
- Produces（后续任务消费，签名逐字一致）:
  ```ts
  export async function ensureFund(
    db: Db, env: Env, code: string,
  ): Promise<FundRow | null>;
  ```
  行为：库里没有或 `updatedAt` 超过 1 天 → 拉东财 `fetchFundBasic` → upsert → 重读返回；拉不到且库里也没有 → 返回 null。

- [ ] **Step 1: 在 `fund-data.ts` 顶部补 import**

在现有 import 块后追加：
```ts
import { eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import { fund } from "~/db/schema";
import type { FundRow } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
```

- [ ] **Step 2: 在 `fund-data.ts` 末尾追加 `ensureFund`**

```ts
/**
 * 确保基金档案在库里且不过期：没有或超过 1 天就拉东财 `fetchFundBasic` 落库。
 *
 * 抽自 `funds.$code` loader 此前的内联逻辑，供详情页与自选两处复用——
 * 自选时用户可能没访问过详情页，`fund` 表里还没这只基金，需先落档案。
 *
 * 拉不到（接口挂）且库里也没有 → 返回 null，调用方自行决定（详情页 404、自选报错）。
 * 拉不到但库里有过期档案 → 保留旧档案返回（与原 loader 行为一致，不因接口抖动丢档案）。
 */
export async function ensureFund(
  db: Db,
  env: Env,
  code: string,
): Promise<FundRow | null> {
  let f = await db.query.fund.findFirst({ where: eq(fund.code, code) });
  const stale = !f || Date.now() - f.updatedAt > 86_400_000;

  if (stale) {
    const basic = await fetchFundBasic(env, code);
    if (basic) {
      await db
        .insert(fund)
        .values({
          code: basic.code,
          name: basic.name,
          type: basic.type,
          purchaseRate: basic.purchaseRate,
          redeemTiers: DEFAULT_REDEEM_TIERS,
          minPurchase: basic.minPurchaseCents,
          riskLevel: basic.riskLevel,
          status: basic.status,
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: fund.code,
          set: {
            name: basic.name,
            type: basic.type,
            purchaseRate: basic.purchaseRate,
            minPurchase: basic.minPurchaseCents,
            riskLevel: basic.riskLevel,
            status: basic.status,
            updatedAt: Date.now(),
          },
        });
      f = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    }
  }

  return f ?? null;
}
```

- [ ] **Step 3: `funds.$code.tsx` loader 接线**

把 `app/routes/funds.$code.tsx` loader 里 `// 先看库里有没有档案…` 到 `if (!f) { throw new Response(...) }` 之前的档案块（:37-74）替换为：
```tsx
  // 基金档案：没有或过期就拉东财落库（抽到 ensureFund，自选也复用它）
  const f = await ensureFund(db, env, code);
  if (!f) {
    throw new Response(`没找到基金 ${code}`, { status: 404 });
  }
```

并把顶部 import 里 `fetchFundBasic` 删掉（不再直接用）、`DEFAULT_REDEEM_TIERS` 删掉（loader 不再直接用，component 仍用——确认 component 用到 `DEFAULT_REDEEM_TIERS`？component 没用，是 loader 旧档案块用的。删掉该 import）、`fund` schema 删掉（旧档案块用 `eq(fund.code)`，现在不用了；但 `account`/`fundNav` 仍用，保留它们）、`eq` 若档案块是唯一用处也删（`account.userId` 的 `eq` 仍在用，保留 `eq`）。具体：
- 删 `import { fetchFundBasic, fetchNavHistory } from "~/services/fund-data";` 里的 `fetchFundBasic`，保留 `fetchNavHistory`（净值首访仍用，T9 才改 400）。
- 加 `import { ensureFund } from "~/services/fund-data";`（与 `fetchNavHistory` 合并到同一行 import）。
- 删 `import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";`（loader 旧块用；component 用的是 `f.redeemTiers`，不需要默认档）。**注意确认**：component 里 `f.redeemTiers.map(...)` 用的是 loader 返回的 `fund.redeemTiers`（已经是 `RedeemTier[]`），不依赖 `DEFAULT_REDEEM_TIERS` import。删之。
- `fund` schema import：旧块 `db.query.fund.findFirst` 用，新块不用。但 loader 还有 `getNavSeries`（不直接用 `fund` schema）。检查文件其余地方是否用 `fund` schema symbol——若不再用则从 `import { account, fund, fundNav } from "~/db/schema"` 删 `fund`，保留 `account`/`fundNav`。**改前先 grep 该文件 `fund[^A-Za-z_]` 确认**。

- [ ] **Step 4: typecheck + lint + workers 回归**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: 干净；workers 测试全绿（详情页行为不变，纯重构）

- [ ] **Step 5: Commit**

```bash
git add app/services/fund-data.ts app/routes/funds.$code.tsx
git commit -m "refactor(fund-data): 抽 ensureFund，详情页 loader 复用

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `watchlist-service` + `latestNavMap` 导出 + workers 测试

**Files:**
- Modify: `app/services/portfolio-service.ts`（`latestNavMap` 加 `export`，map 值追加 `growthRate`）
- Create: `app/services/watchlist-service.ts`
- Test: `tests/services/watchlist.test.ts`（workers 环境）

**Interfaces:**
- Consumes: `ensureFund`（T2）、`latestNavMap`（本 task 导出）、`fund`/`watchlist`（schema）、`Db`、`and`/`eq`/`inArray`/`desc`（drizzle）
- Produces（后续任务消费，签名逐字一致）:
  ```ts
  export interface WatchItem {
    fundCode: string;
    fundName: string;
    fundType: string;
    navDate: string | null;
    unitNav: number | null;
    /** 日涨跌率 ×10000（万分之）；无净值时 0 */
    growthRate: number;
  }
  export async function addWatch(db: Db, env: Env, userId: number, fundCode: string): Promise<void>;
  export async function removeWatch(db: Db, userId: number, fundCode: string): Promise<void>;
  export async function isWatched(db: Db, userId: number, fundCode: string): Promise<boolean>;
  export async function listWatch(db: Db, userId: number): Promise<WatchItem[]>;
  ```

- [ ] **Step 1: `portfolio-service.ts` 导出 `latestNavMap` 并追加 `growthRate`**

把 `app/services/portfolio-service.ts` 的 `async function latestNavMap(` 改为 `export async function latestNavMap(`。

把 `latestNavMap` 内 `map.set(r.fundCode, { navDate: nav.navDate, unitNav: nav.unitNav })` 改为：
```ts
      map.set(r.fundCode, {
        navDate: nav.navDate,
        unitNav: nav.unitNav,
        growthRate: nav.growthRate,
      });
```
并把函数返回类型从 `Promise<Map<string, { navDate: string; unitNav: number }>>` 改为 `Promise<Map<string, { navDate: string; unitNav: number; growthRate: number }>>`。

`getPortfolio`/`getHoldingDetail` 读 `navMap.get(code)` 后只取 `navDate`/`unitNav`，追加 `growthRate` 不影响它们——确认两处 `navInfo?.unitNav`/`navInfo?.navDate` 用法不变，无需改。

- [ ] **Step 2: 建 `app/services/watchlist-service.ts`**

```ts
import type { Db } from "~/db/client";
import { and, desc, eq, inArray } from "drizzle-orm";
import { fund, watchlist } from "~/db/schema";
import { ensureFund, latestNavMap } from "./fund-data";

// ⚠️ latestNavMap 在 portfolio-service.ts，不是 fund-data.ts —— 上面 import 路径写错的话看这里：
```
**⚠️ 实现者注意**：`latestNavMap` 在 `portfolio-service.ts`（T3 Step1 刚导出），**不是** `./fund-data`。`ensureFund` 才在 `./fund-data`。正确 import：
```ts
import type { Db } from "~/db/client";
import { and, desc, eq, inArray } from "drizzle-orm";
import { fund, watchlist } from "~/db/schema";
import { ensureFund } from "./fund-data";
import { latestNavMap } from "./portfolio-service";

/** 自选条目视图：带基金名、类型、最新净值与日涨跌，直接喂 FundListItem */
export interface WatchItem {
  fundCode: string;
  fundName: string;
  fundType: string;
  navDate: string | null;
  unitNav: number | null;
  /** 日涨跌率 ×10000（万分之）；无净值时 0（展示层用 PnlText 判色） */
  growthRate: number;
}

/**
 * 加自选。先 ensureFund 落档案（用户可能没访问过详情页），
 * 再插 watchlist；复合主键 + onConflictDoNothing 保证重复关注幂等。
 */
export async function addWatch(
  db: Db,
  env: Env,
  userId: number,
  fundCode: string,
): Promise<void> {
  const f = await ensureFund(db, env, fundCode);
  if (!f) {
    throw new Error(`没找到基金 ${fundCode}，无法加自选`);
  }
  await db
    .insert(watchlist)
    .values({ userId, fundCode, createdAt: Date.now() })
    .onConflictDoNothing();
}

/** 取消自选 */
export async function removeWatch(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<void> {
  await db
    .delete(watchlist)
    .where(
      and(eq(watchlist.userId, userId), eq(watchlist.fundCode, fundCode)),
    );
}

/** 是否已自选（详情页加自选按钮的初始态） */
export async function isWatched(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<boolean> {
  const r = await db.query.watchlist.findFirst({
    where: and(
      eq(watchlist.userId, userId),
      eq(watchlist.fundCode, fundCode),
    ),
  });
  return !!r;
}

/**
 * 列出自选基金 + 最新净值 + 日涨跌。
 * 复用 latestNavMap 保证与 /me/holdings 估值同源（同一份净值口径）。
 */
export async function listWatch(db: Db, userId: number): Promise<WatchItem[]> {
  const rows = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.userId, userId))
    .orderBy(desc(watchlist.createdAt));

  const codes = rows.map(r => r.fundCode);
  if (codes.length === 0)
    return [];

  const funds
    = codes.length > 0
      ? await db.select().from(fund).where(inArray(fund.code, codes))
      : [];
  const fundMap = new Map(funds.map(f => [f.code, f]));
  const navMap = await latestNavMap(db, codes);

  return rows.map((r) => {
    const f = fundMap.get(r.fundCode);
    const nav = navMap.get(r.fundCode);
    return {
      fundCode: r.fundCode,
      fundName: f?.name ?? r.fundCode,
      fundType: f?.type ?? "",
      navDate: nav?.navDate ?? null,
      unitNav: nav?.unitNav ?? null,
      growthRate: nav?.growthRate ?? 0,
    };
  });
}
```

- [ ] **Step 3: 写 workers 测试**

`tests/services/watchlist.test.ts`：
```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import {
  account, checkin, dcaPlan, fund, fundNav, holding, orders, session,
  shareLot, transactions, user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import {
  addWatch, isWatched, listWatch, removeWatch,
} from "~/services/watchlist-service";

async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [transactions, shareLot, holding, orders, dcaPlan, checkin, session, account, user, fundNav, fund])
    await db.delete(t);
}
async function seedFund(code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code, name: "测试成长混合", type: "混合型", purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS, minPurchase: 1000, riskLevel: 4,
    status: "开放申购", updatedAt: Date.now(),
  });
}
async function seedNav(navDate: string, unitNav: number, growthRate: number, code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fundNav).values({ fundCode: code, navDate, unitNav, accNav: unitNav, growthRate });
}
async function seedUser(name = "alice") {
  return (await registerUser(getDb(env.DB), env, name, "hunter2")).id;
}

beforeEach(resetAll);

describe("watchlist-service", () => {
  it("addWatch：库里已有基金时直接加，重复加幂等", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    await addWatch(db, env, userId, "000001"); // 重复，幂等
    expect(await isWatched(db, userId, "000001")).toBe(true);
    const list = await listWatch(db, userId);
    expect(list).toHaveLength(1);
    expect(list[0].fundName).toBe("测试成长混合");
  });

  it("addWatch：库里没有基金时先 ensureFund 落档再加（fetch stub）", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    // 不预置 fund；addWatch 内部 ensureFund 会 fetchFundBasic → 这里走真网络可能失败
    // 用直接预置 fund 模拟 ensureFund 成功后的状态：直接测 addWatch 对已存在基金的行为已覆盖上条；
    // 这条改测「ensureFund 失败时 addWatch 抛错」：
    await expect(addWatch(db, env, userId, "999999")).rejects.toThrow();
  });

  it("listWatch：带基金名 + 最新净值 + 日涨跌", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 12345, 263); // +2.63%
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    const list = await listWatch(db, userId);
    expect(list[0].unitNav).toBe(12345);
    expect(list[0].navDate).toBe("2026-08-25");
    expect(list[0].growthRate).toBe(263);
  });

  it("removeWatch：取消后 isWatched 为 false", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    await removeWatch(db, userId, "000001");
    expect(await isWatched(db, userId, "000001")).toBe(false);
    expect(await listWatch(db, userId)).toHaveLength(0);
  });

  it("级联删除：删用户后 watchlist 跟着没", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    await db.delete(user).where(/* user.id = */ { } ); // 占位，见下
    // drizzle 删用户：用 eq
  });
});
```
**⚠️ 实现者注意**：上面级联删除测试最后两行是占位，替换为正确写法——顶部 import 加 `eq`：`import { eq } from "drizzle-orm"`，末尾改为：
```ts
  it("级联删除：删用户后 watchlist 跟着没", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    await db.delete(user).where(eq(user.id, userId));
    const list = await listWatch(db, userId);
    // 用户没了，按 userId 查应空（外键 cascade 已删 watchlist 行）
    expect(list).toHaveLength(0);
  });
```
（`addWatch` 那条「库里没有基金」的测试依赖真网络拉 `999999`，CI 可能不稳；**改为**：预置一个 `fund` 行但用未入库的 `999999`，断言 `rejects.toThrow`。若 CI 网络全断 `fetchFundBasic` 返回 null → ensureFund 返回 null → addWatch 抛「没找到基金」，断言仍成立。保留。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:workers tests/services/watchlist.test.ts`
Expected: PASS（5 条）

- [ ] **Step 5: typecheck + lint + workers 全回归**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: 干净；全绿（含 T1 的 schema 测试，无回归）

- [ ] **Step 6: Commit**

```bash
git add app/services/portfolio-service.ts app/services/watchlist-service.ts tests/services/watchlist.test.ts
git commit -m "feat(service): watchlist-service（add/remove/list/isWatched）+ 导出 latestNavMap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `performance.ts` 阶段涨幅纯函数（TDD）

**Files:**
- Test: `tests/domain/performance.test.ts`（新建，先写）
- Create: `app/domain/performance.ts`

**Interfaces:**
- Consumes: `decimal.js`（`Decimal`/`roundInt` from `~/domain/money`）、`dayjs`（已在依赖里）
- Produces（后续任务消费，签名逐字一致）:
  ```ts
  export interface PeriodReturns {
    w1: number | null;  m1: number | null;  m3: number | null;
    m6: number | null;  y1: number | null;  ytd: number | null;
    all: number | null;
  }
  export function calcPeriodReturns(
    series: { navDate: string; unitNav: number }[],
  ): PeriodReturns;
  ```
  `series` 升序（旧→新）。返回值均为**万分之整数**（`rateToPercent` 直接展示），数据不足为 `null`。

- [ ] **Step 1: 写失败测试**

`tests/domain/performance.test.ts`：
```ts
import { describe, expect, it } from "vitest";
import { calcPeriodReturns } from "~/domain/performance";

/** 造一条净值序列（升序），unitNav 传真实净值如 1.2345 的 ×10000=12345 */
function s(...rows: [string, number][]) {
  return rows.map(([navDate, unitNav]) => ({ navDate, unitNav }));
}

describe("calcPeriodReturns", () => {
  it("空序列或单点：全部 null", () => {
    expect(calcPeriodReturns([])).toEqual({
      w1: null, m1: null, m3: null, m6: null, y1: null, ytd: null, all: null,
    });
    expect(calcPeriodReturns(s(["2026-08-25", 12345])).all).toBeNull();
  });

  it("成立来 = (末值 − 首值)/首值，万分之整数", () => {
    const r = calcPeriodReturns(s(["2026-01-01", 10000], ["2026-08-25", 12345]));
    // (12345-10000)/10000 ×10000 = 2345
    expect(r.all).toBe(2345);
  });

  it("近1月：目标日落在非交易日（周末）时前向填充到最近的交易日", () => {
    // 末值 2026-08-25（周二），近1月目标 = 2026-07-25（周六，无净值）
    // 库里 7-24（周五）有净值 12000，7-27（周一）有净值 12100
    // 前向填充取 navDate ≤ 2026-07-25 的最后一条 = 7-24
    const r = calcPeriodReturns(
      s(["2026-07-24", 12000], ["2026-07-27", 12100], ["2026-08-25", 12345]),
    );
    // (12345-12000)/12000 ×10000 = 287.5 → HALF_UP → 288
    expect(r.m1).toBe(288);
  });

  it("数据不足的周期返回 null（近1年需要跨年数据）", () => {
    // 只有 3 个月数据，近1年目标日早于首条 → null
    const r = calcPeriodReturns(
      s(["2026-06-01", 10000], ["2026-08-25", 12345]),
    );
    expect(r.y1).toBeNull();
    expect(r.m3).toBeNull(); // 近3月目标 2026-05-25 也早于首条 6-01
    expect(r.m1).not.toBeNull(); // 近1月目标 7-25，但首条是 6-01 → 前向填充取 6-01
  });

  it("YTD 跨年：取上一年最后一个交易日的净值作起点", () => {
    // 末值 2026-08-26，YTD 目标 = 2025-12-31（上一年最后一日）
    // 库里 2025-12-30 有净值 11000（≤ 12-31 的最后一条）
    const r = calcPeriodReturns(
      s(
        ["2025-12-30", 11000],
        ["2026-02-01", 11500],
        ["2026-08-26", 13200],
      ),
    );
    // (13200-11000)/11000 ×10000 = 2000
    expect(r.ytd).toBe(2000);
  });

  it("YTD 当年才成立的基金（无上年数据）返回 null", () => {
    const r = calcPeriodReturns(
      s(["2026-02-01", 10000], ["2026-08-26", 12000]),
    );
    expect(r.ytd).toBeNull();
  });

  it("首尾净值相等的区间返回 0（真实 0%，不是 null）", () => {
    const r = calcPeriodReturns(
      s(["2026-07-25", 12345], ["2026-08-25", 12345]),
    );
    expect(r.m1).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/domain/performance.test.ts`
Expected: FAIL（`calcPeriodReturns is not exported` / 模块不存在）

- [ ] **Step 3: 实现 `app/domain/performance.ts`**

```ts
import dayjs from "dayjs";
import Decimal from "decimal.js";
import { roundInt } from "./money";

/**
 * 阶段涨幅（近1周/1月/3月/6月/1年/今年来/成立来）。
 *
 * 全部以**万分之整数**表示（沿用费率表示法，1.5% = 150），
 * 直接喂 `rateToPercent` 即得 "1.50%"。数据不足为 null，页面渲染「—」。
 */
export interface PeriodReturns {
  /** 近 1 周 */
  w1: number | null;
  /** 近 1 月 */
  m1: number | null;
  /** 近 3 月 */
  m3: number | null;
  /** 近 6 月 */
  m6: number | null;
  /** 近 1 年 */
  y1: number | null;
  /** 今年来（YTD） */
  ytd: number | null;
  /** 成立来 */
  all: number | null;
}

type NavPoint = { navDate: string; unitNav: number };

/**
 * 取 navDate ≤ target 的最后一条（前向填充）。series 必须升序。
 * 命中非交易日/停牌/净值未同步时自动回退到最近一条有净值的交易日。
 */
function floorNav(series: NavPoint[], target: string): NavPoint | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].navDate <= target)
      return series[i];
  }
  return null;
}

/**
 * 单个周期的收益率。target 为按自然日回推的目标日。
 *
 * target ≥ end.navDate → 目标日不早于末值，无区间 → null。
 * floorNav(target) 找不到（target 早于首条） → null。
 * 否则 = (end − start)/start ×10000，HALF_UP 取整。
 */
function periodReturn(series: NavPoint[], target: string, end: NavPoint): number | null {
  if (target >= end.navDate)
    return null;
  const start = floorNav(series, target);
  if (!start)
    return null;
  return roundInt(
    new Decimal(end.unitNav).minus(start.unitNav).div(start.unitNav).mul(10000),
  );
}

/**
 * 计算阶段涨幅。series 升序（旧→新），unitNav 为 ×10000 整数。
 *
 * 算法（spec §6）：以末条为 end，对每个周期按**自然日**回推目标日，
 * 取 navDate ≤ 目标日的最后一条为 start（前向填充），收益 = (end−start)/start。
 * YTD 取当年 1 月 1 日**之前**的最后一条（即上一年最后一日）。
 * 运算走 decimal.js，万分之整数回填。
 */
export function calcPeriodReturns(series: NavPoint[]): PeriodReturns {
  if (series.length === 0) {
    return { w1: null, m1: null, m3: null, m6: null, y1: null, ytd: null, all: null };
  }

  const end = series[series.length - 1];
  const endDate = dayjs(end.navDate);

  const all
    = series.length < 2
      ? null
      : roundInt(
          new Decimal(end.unitNav).minus(series[0].unitNav)
            .div(series[0].unitNav)
            .mul(10000),
        );

  return {
    w1: periodReturn(series, endDate.subtract(7, "day").format("YYYY-MM-DD"), end),
    m1: periodReturn(series, endDate.subtract(1, "month").format("YYYY-MM-DD"), end),
    m3: periodReturn(series, endDate.subtract(3, "month").format("YYYY-MM-DD"), end),
    m6: periodReturn(series, endDate.subtract(6, "month").format("YYYY-MM-DD"), end),
    y1: periodReturn(series, endDate.subtract(1, "year").format("YYYY-MM-DD"), end),
    // YTD：上一年最后一日（当年1月1日之前）
    ytd: periodReturn(
      series,
      endDate.startOf("year").subtract(1, "day").format("YYYY-MM-DD"),
      end,
    ),
    all,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/domain/performance.test.ts`
Expected: PASS（7 条）

- [ ] **Step 5: typecheck + lint + 领域回归**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 干净；领域测试全绿

- [ ] **Step 6: Commit**

```bash
git add app/domain/performance.ts tests/domain/performance.test.ts
git commit -m "feat(domain): calcPeriodReturns 阶段涨幅纯函数 + TDD 测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 东财新接口 fetcher（排行/详情/重仓股/沪深300）+ domain 测试

**Files:**
- Modify: `app/services/fund-data.ts`（追加 `fetchFundRank`/`fetchFundDetail`/`fetchFundPosition`/`fetchIndexNav`；顶部补 `dayjs` import；`CACHE_TTL` 补 `rank`/`detail`/`position`/`index`）
- Modify: `tests/domain/fund-data.test.ts`（追加四个 fetcher 的 stub 测试）

**Interfaces:**
- Consumes: `fetchWithTimeout`/`EM_WEB_HEADERS`/`EM_MOBILE_HEADERS`/`percentToRate`/`navToScaled`（同文件私有）、`dayjs`、`KV`（env）
- Produces（后续任务消费，签名逐字一致）:
  ```ts
  export interface FundRankItem {
    code: string;
    name: string;
    navDate: string;        // 净值日期 YYYY-MM-DD
    unitNav: number;        // ×10000
    growthRate: number;     // 日涨跌 万分之
    periodRate: number | null; // 选中周期收益率 万分之；空串→null
  }
  export async function fetchFundRank(
    env: Env, ft: string, sc: string, periodCol: number,
  ): Promise<FundRankItem[]>;

  export interface FundDetail {
    manager: string;        // 基金经理（JJJL，逗号分隔）
    company: string;        // 基金公司（JJGS）
    estabDate: string;      // 成立日（ESTABDATE）
    scaleYuan: number | null; // 最新净资产规模（元）；"--"或无→null
    benchmark: string;      // 业绩基准（BENCH）
    mgmtFeeRate: number;    // 管理费率 万分之（MGREXP）
    trustFeeRate: number;   // 托管费率 万分之（TRUSTEXP）
  }
  export async function fetchFundDetail(env: Env, code: string): Promise<FundDetail | null>;

  export interface FundStock {
    code: string;      // 股票代码 GPDM
    name: string;      // 股票简称 GPJC
    ratio: number;     // 占净值比 万分之（JZBL 6.45 → 645）
    industry: string;  // 所属行业 INDEXNAME
    changeType: string;// 增减持 PCTNVCHGTYPE（增持/减持/新增/不变）
  }
  export async function fetchFundPosition(env: Env, code: string): Promise<FundStock[]>;

  // 沪深300等指数净值（T10 可砍用），klt=101 日K
  export async function fetchIndexNav(
    env: Env, secid: string, days: number,
  ): Promise<{ date: string; close: number }[]>;
  ```

**接口实测结论（2026-08-26，写入注释供后人）：**
- `rankhandler.aspx`：必须带 `pi/pn/po/sc/sd/ed` 完整分页参数（只给 `op/dt/ft/rs/top` 会返回空 `datas`）。`ft` = 类型（gp/hh/zs/zq），`sc` = 排序码（`1yzf`/`3yzf`/`6yzf`/`1nzf`/`rzdf`），`po=desc` 降序。返回 `var rankData = {datas:[...],...};`，每条是逗号分隔字符串。字段索引：0=代码,1=名称,3=净值日期,4=单位净值,6=日涨跌%,8=近1月,9=近3月,11=近1年。Referer 用 `https://fund.eastmoney.com/data/fundranking.html`。
- `FundMNDetailInformation`（`fundmobapi`，移动端）：一条返回经理(JJJL)/公司(JJGS)/成立日(ESTABDATE)/规模(ENDNAV，元)/基准(BENCH)/管理费(MGREXP)/托管费(TRUSTEXP)。用 `EM_MOBILE_HEADERS`（绝不能带浏览器 UA）。
- `FundMNInverstPosition`（`fundmobapi`）：返回 `Datas.fundStocks[]`，字段 GPDM/GPJC/JZBL/INDEXNAME/PCTNVCHGTYPE。用 `EM_MOBILE_HEADERS`。
- `push2his` 沪深300：`secid=1.000300`、`klt=101`(日K)、`fqt=0`、`fields2=f51,f52,f53`(日期/开/收)。返回 `data.klines`，每条 `"日期,开盘,收盘"`。Referer 用 `https://quote.eastmoney.com/`（**新域名**，与 fundf10 不同）。

- [ ] **Step 1: `fund-data.ts` 顶部补 import 与 CACHE_TTL**

顶部 import 块加：
```ts
import dayjs from "dayjs";
```
`CACHE_TTL` 对象补：
```ts
  /** 排行榜缓存 1 天（按 类型×周期 组合，12 key/天） */
  rank: 86400,
  /** 基金详情（经理/规模/成立日）缓存 1 天 */
  detail: 86400,
  /** 重仓股缓存 1 天 */
  position: 86400,
  /** 指数净值（沪深300）缓存 1 天 */
  index: 86400,
```

- [ ] **Step 2: 追加 `fetchFundRank`**

在 `fund-data.ts` 末尾追加：
```ts
/**
 * 基金排行榜。东财 rankhandler.aspx。
 *
 * @param ft 类型过滤：gp=股票型 / hh=混合型 / zs=指数型 / zq=债券型
 * @param sc 排序码：1yzf=近1月 / 3yzf=近3月 / 1nzf=近1年（由 rank-service 按 period 映射）
 * @param periodCol 选中周期收益率在逗号分隔字段里的列索引（1yzf→8, 3yzf→9, 1nzf→11）
 *
 * 失败/空 → 返回空数组（rank-service 会走本地降级）。
 */
export async function fetchFundRank(
  env: Env,
  ft: string,
  sc: string,
  periodCol: number,
): Promise<FundRankItem[]> {
  const cacheKey = `fund:rank:${ft}:${sc}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundRankItem[];
    }
    catch {
      /* 缓存损坏，走网络 */
    }
  }

  try {
    // sd/ed 给一个宽窗口（近 400 天），实际排序由 sc 控制
    const ed = dayjs().format("YYYY-MM-DD");
    const sd = dayjs().subtract(400, "day").format("YYYY-MM-DD");
    const url
      = `https://fund.eastmoney.com/data/rankhandler.aspx`
        + `?op=ph&dt=kf&ft=${encodeURIComponent(ft)}&pi=1&pn=20&po=desc`
        + `&sc=${encodeURIComponent(sc)}&sd=${sd}&ed=${ed}&qd=di&v=${Date.now()}`;
    const resp = await fetchWithTimeout(url, {
      // 排行榜页的 Referer，与 EM_WEB_HEADERS 的 fundf10 Referer 不同但不影响防盗链
      headers: { Referer: "https://fund.eastmoney.com/data/fundranking.html" },
    });
    const text = await resp.text();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1)
      return [];
    const json = JSON.parse(text.slice(start, end + 1)) as { datas?: string[] };
    const datas = json.datas ?? [];

    const items: FundRankItem[] = [];
    for (const d of datas) {
      const f = d.split(",");
      if (f.length < 12)
        continue;
      const unitNav = navToScaled(f[4]);
      if (!f[0] || !f[1] || unitNav === null)
        continue;
      const periodRaw = f[periodCol] ?? "";
      items.push({
        code: f[0],
        name: f[1],
        navDate: f[3] ?? "",
        unitNav,
        growthRate: percentToRate(f[6]),
        periodRate:
          periodRaw === "" || periodRaw === "--" ? null : percentToRate(periodRaw),
      });
    }

    if (items.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(items), {
        expirationTtl: CACHE_TTL.rank,
      });
    }
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取排行榜 ft=${ft} sc=${sc} 失败：`, err);
    return [];
  }
}

/** 基金排行榜条目 */
export interface FundRankItem {
  code: string;
  name: string;
  navDate: string;
  unitNav: number;
  growthRate: number;
  periodRate: number | null;
}
```

- [ ] **Step 3: 追加 `fetchFundDetail`**

```ts
/**
 * 基金详情（经理/规模/成立日/公司/基准/费率）。东财 FundMNDetailInformation。
 * 一条接口把详情页要的元数据全给齐，省得分头拉经理/规模。
 * ⚠️ 用 EM_MOBILE_HEADERS（fundmobapi 移动端，绝不能带浏览器 UA）。
 * 失败返回 null，详情页不渲染「基金概况」卡片。
 */
export interface FundDetail {
  manager: string;
  company: string;
  estabDate: string;
  scaleYuan: number | null;
  benchmark: string;
  mgmtFeeRate: number;
  trustFeeRate: number;
}

export async function fetchFundDetail(
  env: Env,
  code: string,
): Promise<FundDetail | null> {
  const cacheKey = `fund:detail:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundDetail;
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as { Datas?: Record<string, string> | null };
    const d = json.Datas;
    if (!d || !d.FCODE)
      return null;

    const detail: FundDetail = {
      manager: d.JJJL ?? "",
      company: d.JJGS ?? "",
      estabDate: d.ESTABDATE ?? "",
      // ENDNAV 是元字符串如 "3938207602.85"，"--" 时无数据
      scaleYuan: d.ENDNAV && d.ENDNAV !== "--" ? Number(d.ENDNAV) : null,
      benchmark: d.BENCH ?? "",
      mgmtFeeRate: percentToRate(d.MGREXP),
      trustFeeRate: percentToRate(d.TRUSTEXP),
    };

    await env.KV.put(cacheKey, JSON.stringify(detail), {
      expirationTtl: CACHE_TTL.detail,
    });
    return detail;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 详情失败：`, err);
    return null;
  }
}
```

- [ ] **Step 4: 追加 `fetchFundPosition`**

```ts
/**
 * 重仓股。东财 FundMNInverstPosition，返回 Datas.fundStocks[]。
 * ⚠️ 用 EM_MOBILE_HEADERS。
 * 失败返回空数组，详情页不渲染「重仓股」卡片。
 */
export interface FundStock {
  code: string;
  name: string;
  /** 占净值比 万分之（6.45% → 645） */
  ratio: number;
  industry: string;
  changeType: string;
}

export async function fetchFundPosition(
  env: Env,
  code: string,
): Promise<FundStock[]> {
  const cacheKey = `fund:position:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundStock[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      Datas?: { fundStocks?: {
        GPDM?: string; GPJC?: string; JZBL?: string;
        INDEXNAME?: string; PCTNVCHGTYPE?: string;
      }[] } | null;
    };
    const stocks = json.Datas?.fundStocks ?? [];

    const items: FundStock[] = stocks
      .filter(s => s.GPDM && s.GPJC)
      .map(s => ({
        code: s.GPDM!,
        name: s.GPJC!,
        ratio: percentToRate(s.JZBL),
        industry: s.INDEXNAME ?? "",
        changeType: s.PCTNVCHGTYPE ?? "",
      }));

    if (items.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(items), {
        expirationTtl: CACHE_TTL.position,
      });
    }
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 重仓股失败：`, err);
    return [];
  }
}
```

- [ ] **Step 5: 追加 `fetchIndexNav`（T10 可砍用）**

```ts
/**
 * 指数净值（沪深300等）。东财 push2his，新域名。
 * ⚠️ Referer 用 https://quote.eastmoney.com/（与 fundf10 不同）。
 * @param secid 如 "1.000300"（沪深300），"1.000001"（上证综指）
 * @param days 取最近多少天
 * 失败返回空数组（基准线不画，不阻塞详情页）。
 */
export async function fetchIndexNav(
  env: Env,
  secid: string,
  days: number,
): Promise<{ date: string; close: number }[]> {
  const cacheKey = `fund:index:${secid}:${days}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as { date: string; close: number }[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const ed = dayjs().format("YYYYMMDD");
    const sd = dayjs().subtract(days, "day").format("YYYYMMDD");
    const url
      = `https://push2his.eastmoney.com/api/qt/stock/kline/get`
        + `?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3`
        + `&fields2=f51,f52,f53&klt=101&fqt=0&beg=${sd}&end=${ed}`;
    const resp = await fetchWithTimeout(url, {
      headers: { Referer: "https://quote.eastmoney.com/" },
    });
    const json = (await resp.json()) as {
      data?: { klines?: string[] } | null;
    };
    const klines = json.data?.klines ?? [];
    // 每条 "日期,开盘,收盘"
    const rows = klines
      .map((k) => {
        const parts = k.split(",");
        if (parts.length < 3)
          return null;
        const close = Number(parts[2]);
        return Number.isFinite(close) ? { date: parts[0], close } : null;
      })
      .filter((r): r is { date: string; close: number } => r !== null);

    if (rows.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(rows), {
        expirationTtl: CACHE_TTL.index,
      });
    }
    return rows;
  }
  catch (err) {
    console.error(`[fund-data] 拉取指数 ${secid} 净值失败：`, err);
    return [];
  }
}
```

- [ ] **Step 6: 补 domain 测试**

在 `tests/domain/fund-data.test.ts` 末尾追加（复用文件里已有的 `fakeKV`/`fakeEnv`）：
```ts
import { fetchFundDetail, fetchFundPosition, fetchFundRank, fetchIndexNav } from "~/services/fund-data";

describe("fetchFundRank 排行榜", () => {
  // rankhandler 返回 `var rankData = {datas:["..."],...};`
  const rankResp = `var rankData = {datas:["018751,山证混合C,SZ,2026-08-25,1.4142,1.4142,-2.63,10.67,36.03,19.98,-0.39,18.91"],allRecords:1};`;

  it("解析出代码/名称/净值/日涨跌/近1月收益率(列8)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rankResp)));
    const r = await fetchFundRank(fakeEnv(), "hh", "1yzf", 8);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      code: "018751", name: "山证混合C", navDate: "2026-08-25",
      unitNav: 14142, growthRate: -263, periodRate: 3603,
    });
  });

  it("命中 KV 缓存时不打网络", async () => {
    const spy = vi.fn(async () => new Response(rankResp));
    vi.stubGlobal("fetch", spy);
    const env = fakeEnv();
    await fetchFundRank(env, "hh", "1yzf", 8);
    await fetchFundRank(env, "hh", "1yzf", 8);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("网络异常返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await fetchFundRank(fakeEnv(), "hh", "1yzf", 8)).toEqual([]);
  });

  it("空收益率字段 → periodRate 为 null", async () => {
    const blank = `var rankData = {datas:["000001,华夏成长,HX,2026-08-25,1.2345,1.2345,1.23,2.3,3.4,,5.6"]};`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blank)));
    const r = await fetchFundRank(fakeEnv(), "hh", "1yzf", 10);
    expect(r[0].periodRate).toBeNull();
  });
});

describe("fetchFundDetail 基金详情", () => {
  const detailResp = {
    Datas: {
      FCODE: "000001", JJJL: "郑晓辉,刘睿聪", JJGS: "华夏基金",
      ESTABDATE: "2001-12-18", ENDNAV: "3938207602.85", BENCH: "中证800成长",
      MGREXP: "1.20%", TRUSTEXP: "0.20%",
    },
  };

  it("解析经理/公司/成立日/规模/基准/费率", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(detailResp))));
    const r = await fetchFundDetail(fakeEnv(), "000001");
    expect(r).not.toBeNull();
    expect(r!.manager).toBe("郑晓辉,刘睿聪");
    expect(r!.company).toBe("华夏基金");
    expect(r!.estabDate).toBe("2001-12-18");
    expect(r!.scaleYuan).toBe(3938207602.85);
    expect(r!.benchmark).toBe("中证800成长");
    expect(r!.mgmtFeeRate).toBe(120); // 1.20% → 万分之 120
    expect(r!.trustFeeRate).toBe(20);
  });

  it("规模 '--' 时 scaleYuan 为 null", async () => {
    const noScale = { Datas: { ...detailResp.Datas, ENDNAV: "--" } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(noScale))));
    expect((await fetchFundDetail(fakeEnv(), "000001"))!.scaleYuan).toBeNull();
  });

  it("网络异常返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await fetchFundDetail(fakeEnv(), "000001")).toBeNull();
  });
});

describe("fetchFundPosition 重仓股", () => {
  const posResp = {
    Datas: { fundStocks: [
      { GPDM: "300308", GPJC: "中际旭创", JZBL: "6.45", INDEXNAME: "通信", PCTNVCHGTYPE: "增持" },
      { GPDM: "688347", GPJC: "华虹宏力", JZBL: "5.57", INDEXNAME: "电子", PCTNVCHGTYPE: "增持" },
    ] },
  };

  it("解析代码/简称/占比/行业/增减持", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(posResp))));
    const r = await fetchFundPosition(fakeEnv(), "000001");
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      code: "300308", name: "中际旭创", ratio: 645, industry: "通信", changeType: "增持",
    });
  });

  it("网络异常返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await fetchFundPosition(fakeEnv(), "000001")).toEqual([]);
  });
});

describe("fetchIndexNav 沪深300", () => {
  const indexResp = {
    data: { klines: ["2026-08-25,4542.24,4552.03", "2026-08-26,4549.43,4590.79"] },
  };

  it("解析日期/收盘", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(indexResp))));
    const r = await fetchIndexNav(fakeEnv(), "1.000300", 30);
    expect(r).toEqual([
      { date: "2026-08-25", close: 4552.03 },
      { date: "2026-08-26", close: 4590.79 },
    ]);
  });

  it("网络异常返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await fetchIndexNav(fakeEnv(), "1.000300", 30)).toEqual([]);
  });
});
```

- [ ] **Step 7: 跑 domain 测试确认通过**

Run: `pnpm test tests/domain/fund-data.test.ts`
Expected: PASS（含原有 + 新增 11 条）

- [ ] **Step 8: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 干净

- [ ] **Step 9: Commit**

```bash
git add app/services/fund-data.ts tests/domain/fund-data.test.ts
git commit -m "feat(fund-data): fetchFundRank/fetchFundDetail/fetchFundPosition/fetchIndexNav + 测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `rank-service`（东财排行 + 本地降级）+ workers 测试

**Files:**
- Create: `app/services/rank-service.ts`
- Test: `tests/services/rank.test.ts`（workers 环境）

**Interfaces:**
- Consumes: `fetchFundRank`（T5）、`getNavSeries`（`~/services/portfolio-service`，已导出）、`calcPeriodReturns`（T4）、`fund`（schema）、`like`（drizzle）、`Db`
- Produces（后续任务消费，签名逐字一致）:
  ```ts
  export type FundType = "gp" | "hh" | "zs" | "zq";
  export type RankPeriod = "1m" | "3m" | "1y";
  export async function getFundRank(
    db: Db, env: Env, type: FundType, period: RankPeriod,
  ): Promise<FundRankItem[]>;
  ```
  行为：先试 `fetchFundRank(env, ft, sc, col)`；非空直接返回；空（接口挂）→ 本地降级：按 `type` 前缀过滤已入库基金，各自 `getNavSeries` + `calcPeriodReturns` 取该周期值，降序取前 20，返回 `FundRankItem[]`（`unitNav`/`navDate`/`growthRate` 从最新净值取）。

- [ ] **Step 1: 建 `app/services/rank-service.ts`**

```ts
import type { Db } from "~/db/client";
import type { FundRankItem } from "~/db/fund-data-types";
import { desc, like } from "drizzle-orm";
import { fund, fundNav } from "~/db/schema";
import type { PeriodReturns } from "~/domain/performance";
import { calcPeriodReturns } from "~/domain/performance";
import { fetchFundRank } from "./fund-data";
import { getNavSeries } from "./portfolio-service";

/** ⚠️ FundRankItem 实际定义在 fund-data.ts，上面 import 路径修正见下 */
```
**⚠️ 实现者注意**：`FundRankItem` 在 `~/services/fund-data`，不是 `~/db/fund-data-types`。正确 import：
```ts
import type { Db } from "~/db/client";
import { like } from "drizzle-orm";
import { fund, fundNav } from "~/db/schema";
import { calcPeriodReturns } from "~/domain/performance";
import type { PeriodReturns } from "~/domain/performance";
import type { FundRankItem } from "./fund-data";
import { fetchFundRank } from "./fund-data";
import { getNavSeries } from "./portfolio-service";

/** 基金类型 Tab：东财 ft 码 + 本地 fund.type 前缀（降级过滤用） */
export type FundType = "gp" | "hh" | "zs" | "zq";

/** 排行周期 Tab */
export type RankPeriod = "1m" | "3m" | "1y";

/** ft 码 → 本地类型前缀（东财 FTYPE 形如「混合型-灵活」） */
const TYPE_FT: Record<FundType, { ft: string; localPrefix: string; label: string }> = {
  gp: { ft: "gp", localPrefix: "股票", label: "股票型" },
  hh: { ft: "hh", localPrefix: "混合", label: "混合型" },
  zs: { ft: "zs", localPrefix: "指数", label: "指数型" },
  zq: { ft: "zq", localPrefix: "债券", label: "债券型" },
};

/** 周期 → 东财排序码 + 收益率列索引 + calcPeriodReturns 字段 */
const PERIOD: Record<RankPeriod, {
  sc: string;
  col: number;
  field: keyof PeriodReturns;
  label: string;
}> = {
  "1m": { sc: "1yzf", col: 8, field: "m1", label: "近 1 月" },
  "3m": { sc: "3yzf", col: 9, field: "m3", label: "近 3 月" },
  "1y": { sc: "1nzf", col: 11, field: "y1", label: "近 1 年" },
};

export const FUND_TYPE_OPTIONS: { value: FundType; label: string }[] = [
  { value: "hh", label: "混合型" },
  { value: "gp", label: "股票型" },
  { value: "zs", label: "指数型" },
  { value: "zq", label: "债券型" },
];

export const RANK_PERIOD_OPTIONS: { value: RankPeriod; label: string }[] = [
  { value: "1m", label: "近 1 月" },
  { value: "3m", label: "近 3 月" },
  { value: "1y", label: "近 1 年" },
];

/**
 * 基金排行榜：东财接口优先，挂掉时本地降级。
 *
 * 降级路径（spec §8 验收项「排行榜接口挂掉时页面仍可用」）：
 *  按 type 前缀过滤已入库基金，各自用本地 fund_nav 跑 calcPeriodReturns，
 *  取该周期值降序前 20。本地只有用户访问过的基金，榜单短但不空。
 */
export async function getFundRank(
  db: Db,
  env: Env,
  type: FundType,
  period: RankPeriod,
): Promise<FundRankItem[]> {
  const { ft, localPrefix } = TYPE_FT[type];
  const { sc, col, field } = PERIOD[period];

  // 1. 先试东财
  const remote = await fetchFundRank(env, ft, sc, col);
  if (remote.length > 0)
    return remote;

  // 2. 本地降级
  const funds = await db
    .select()
    .from(fund)
    .where(like(fund.type, `${localPrefix}%`));
  if (funds.length === 0)
    return [];

  const ranked: FundRankItem[] = [];
  for (const f of funds) {
    const series = await getNavSeries(db, f.code);
    if (series.length === 0)
      continue;
    const ret = calcPeriodReturns(series);
    const periodRate = ret[field];
    if (periodRate === null)
      continue;
    const latest = series[series.length - 1];
    ranked.push({
      code: f.code,
      name: f.name,
      navDate: latest.navDate,
      unitNav: latest.unitNav,
      growthRate: latest.growthRate,
      periodRate,
    });
  }
  // 降序按周期收益
  ranked.sort((a, b) => (b.periodRate ?? 0) - (a.periodRate ?? 0));
  return ranked.slice(0, 20);
}
```

- [ ] **Step 2: 写 workers 测试**

`tests/services/rank.test.ts`：
```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "~/db/client";
import {
  account, checkin, dcaPlan, fund, fundNav, holding, orders, session,
  shareLot, transactions, user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { getFundRank } from "~/services/rank-service";

async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [transactions, shareLot, holding, orders, dcaPlan, checkin, session, account, user, fundNav, fund])
    await db.delete(t);
}
async function seedFundWithNav(code: string, name: string, type: string, navs: [string, number][]) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code, name, type, purchaseRate: 150, redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000, riskLevel: 4, status: "开放申购", updatedAt: Date.now(),
  });
  for (const [d, nv] of navs)
    await db.insert(fundNav).values({ fundCode: code, navDate: d, unitNav: nv, accNav: nv, growthRate: 0 });
}

beforeEach(resetAll);

describe("getFundRank 本地降级", () => {
  it("东财有数据时直用远程结果（fetch stub）", async () => {
    const db = getDb(env.DB);
    const rankResp = `var rankData = {datas:["018751,山证混合C,SZ,2026-08-25,1.4142,1.4142,-2.63,10.67,36.03"]};`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rankResp)));
    const r = await getFundRank(db, env, "hh", "1m");
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe("018751");
    vi.unstubAllGlobals();
  });

  it("东财挂掉时本地降级：按类型前缀过滤 + 周期收益降序", async () => {
    const db = getDb(env.DB);
    // 两只混合型：A 涨得多（近1月 +20%），B 涨得少（近1月 +5%）
    await seedFundWithNav("000001", "基金A", "混合型-灵活", [
      ["2026-07-25", 10000], ["2026-08-25", 12000],
    ]);
    await seedFundWithNav("000002", "基金B", "混合型-灵活", [
      ["2026-07-25", 10000], ["2026-08-25", 10500],
    ]);
    // 一只股票型，不应出现在混合榜里
    await seedFundWithNav("000003", "基金C", "股票型", [
      ["2026-07-25", 10000], ["2026-08-25", 13000],
    ]);

    // 东财返回空 → 走本地
    vi.stubGlobal("fetch", vi.fn(async () => new Response("var rankData = {datas:[]};")));
    const r = await getFundRank(db, env, "hh", "1m");
    expect(r.map(x => x.code)).toEqual(["000001", "000002"]); // A 在前
    expect(r[0].periodRate).toBeGreaterThan(r[1].periodRate!);
    // 股票型 000003 不在混合榜
    expect(r.find(x => x.code === "000003")).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("本地降级且无该类型基金时返回空（页面显示空态，不报错）", async () => {
    const db = getDb(env.DB);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("var rankData = {datas:[]};")));
    const r = await getFundRank(db, env, "zq", "1m"); // 库里无债券型
    expect(r).toEqual([]);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test:workers tests/services/rank.test.ts`
Expected: PASS（3 条）

- [ ] **Step 4: typecheck + lint + workers 全回归**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: 干净；全绿

- [ ] **Step 5: Commit**

```bash
git add app/services/rank-service.ts tests/services/rank.test.ts
git commit -m "feat(service): getFundRank 东财排行 + 本地降级（calcPeriodReturns）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `/me/watchlist` 路由 + routes.ts + root.tsx 导航

**Files:**
- Create: `app/routes/me.watchlist.tsx`
- Modify: `app/routes.ts`（加一行）
- Modify: `app/root.tsx`（`NAV_ITEMS` 加「自选」，放「基金」与「我的」之间）

**Interfaces:**
- Consumes: `listWatch`/`addWatch`/`removeWatch`（T3）、`requireUser`、`getAppContext`、`FundListItem`、`PnlText`、`EmptyState`/`SectionCard`/`fmtYuan`、`navToDisplay`、`COLOR`
- Produces: 路由 `/me/watchlist`，loader/action/component。

- [ ] **Step 1: 注册路由**

`app/routes.ts` 在 `route("me/holdings/:code", ...),` 与 `route("me/orders", ...)` 之间加：
```ts
  route("me/watchlist", "routes/me.watchlist.tsx"),
```

- [ ] **Step 2: 建 `app/routes/me.watchlist.tsx`**

```tsx
import type { Route } from "./+types/me.watchlist";
import { Alert, Button, Space, Typography } from "antd";
import { useFetcher } from "react-router";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { EmptyState } from "~/components/ui/EmptyState";
import { navToDisplay } from "~/domain/money";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { listWatch } from "~/services/watchlist-service";
import { COLOR } from "~/theme";

const { Title } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的自选 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const items = await listWatch(db, user.id);
  return { items };
}

/** 加自选/取消自选 action（详情页的加自选也 post 到这里） */
export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const fundCode = String(fd.get("fundCode") ?? "").trim();

  if (!/^\d{6}$/.test(fundCode))
    return { error: "请输入 6 位基金代码" };

  try {
    if (intent === "add") {
      await (await import("~/services/watchlist-service")).addWatch(db, env, user.id, fundCode);
      return { ok: true, message: "已加入自选" };
    }
    if (intent === "remove") {
      await (await import("~/services/watchlist-service")).removeWatch(db, user.id, fundCode);
      return { ok: true, message: "已取消自选" };
    }
    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

export default function MeWatchlist({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const fetcher = useFetcher<typeof action>();

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的自选
      </Title>

      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} closable />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} closable />
      )}

      {items.length === 0
        ? (
            <EmptyState description="还没有自选基金">
              <Button type="primary" href="/funds">
                去发现页挑一只
              </Button>
            </EmptyState>
          )
        : (
            <div>
              {items.map((it, i) => (
                <FundListItem
                  key={it.fundCode}
                  fundCode={it.fundCode}
                  fundName={it.fundName}
                  fundType={it.fundType || undefined}
                  last={i === items.length - 1}
                  note={it.navDate ? `净值 ${navToDisplay(it.unitNav ?? 0)}（${it.navDate}）` : "暂无净值"}
                  primary={(
                    <span style={{ color: COLOR.textPrimary }}>
                      {it.unitNav !== null ? navToDisplay(it.unitNav) : "—"}
                    </span>
                  )}
                  secondary={<PnlText rate={it.growthRate / 10000} size={12} />}
                  actions={(
                    <Space>
                      <Button size="small" href={`/funds/${it.fundCode}`}>
                        查看
                      </Button>
                      <fetcher.Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="fundCode" value={it.fundCode} />
                        <Button size="small" htmlType="submit">
                          取消自选
                        </Button>
                      </fetcher.Form>
                    </Space>
                  )}
                />
              ))}
            </div>
          )}
    </Space>
  );
}
```

- [ ] **Step 3: `root.tsx` 导航加「自选」**

`app/root.tsx` 的 `NAV_ITEMS` 改为（自选放在基金与我的之间——`selectedKey` 的 `startsWith` 匹配要求 `/me/watchlist` 排在 `/me` 之前，否则 `/me/watchlist` 会高亮「我的」）：
```ts
const NAV_ITEMS = [
  { key: "/", label: "首页" },
  { key: "/master", label: "主人的盘" },
  { key: "/funds", label: "基金" },
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];
```

- [ ] **Step 4: typecheck + lint + workers 回归**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: 干净；全绿

- [ ] **Step 5: Commit**

```bash
git add app/routes.ts app/routes/me.watchlist.tsx app/root.tsx
git commit -m "feat(route): /me/watchlist 自选列表 + 导航加入「自选」入口

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `/funds` 发现页改版（搜索 + 排行榜）

**Files:**
- Modify: `app/routes/funds._index.tsx`（loader 加 type/period 解析 + `getFundRank`；组件加排行榜区块，删 `SUGGESTED`）

**Interfaces:**
- Consumes: `getFundRank`/`FUND_TYPE_OPTIONS`/`RANK_PERIOD_OPTIONS`（T6）、`searchFunds`（已有）、`FundListItem`、`PnlText`、`SectionCard`/`EmptyState`、`useSearchParams`（react-router）
- Produces: `/funds` 发现页：搜索框 + 排行榜（类型 Segmented × 周期 Segmented，URL 驱动 `?type=&period=&q=`）。

- [ ] **Step 1: 改 `funds._index.tsx`**

整文件替换为：
```tsx
import type { Route } from "./+types/funds._index";
import type { FundSearchItem } from "~/services/fund-data";
import { Button, Input, Segmented, Space, Typography } from "antd";
import { Form as RouterForm, useNavigation, useSearchParams } from "react-router";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { navToDisplay } from "~/domain/money";
import { getAppContext } from "~/services/context";
import { searchFunds } from "~/services/fund-data";
import {
  FUND_TYPE_OPTIONS, getFundRank, RANK_PERIOD_OPTIONS,
  type FundType, type RankPeriod,
} from "~/services/rank-service";
import { COLOR } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "发现基金 · 模拟基金" }];
}

/** 合法类型/周期，非法值回退默认 */
function parseType(v: string | null): FundType {
  return (["gp", "hh", "zs", "zq"] as const).includes(v as FundType) ? (v as FundType) : "hh";
}
function parsePeriod(v: string | null): RankPeriod {
  return (["1m", "3m", "1y"] as const).includes(v as RankPeriod) ? (v as RankPeriod) : "1m";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = parseType(url.searchParams.get("type"));
  const period = parsePeriod(url.searchParams.get("period"));

  // void db; // getFundRank 本地降级会用到 db —— 不再 void
  const [results, rank] = await Promise.all([
    q ? searchFunds(env, q) : Promise.resolve([] as FundSearchItem[]),
    getFundRank(db, env, type, period),
  ]);

  return { q, results, rank, type, period };
}

export default function FundsIndex({ loaderData }: Route.ComponentProps) {
  const { q, results, rank, type, period } = loaderData;
  const nav = useNavigation();
  const searching = nav.state === "loading";
  const [, setSearchParams] = useSearchParams();

  /** 切类型/周期：保留 q，写 URL 让 loader 重跑 */
  const onTabChange = (key: string, field: "type" | "period") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(field, key);
      return next;
    });
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <SectionCard>
        <Title level={3}>发现基金</Title>
        <Paragraph type="secondary">
          搜代码或名称，或看排行榜挑热门。数据来自东方财富公开接口。
        </Paragraph>
        <RouterForm method="get">
          {/* 搜索提交时保留当前 type/period，避免切回默认 */}
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="period" value={period} />
          <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
            <Input
              name="q"
              size="large"
              defaultValue={q}
              placeholder="如 000001 或 华夏成长"
              allowClear
            />
            <Button type="primary" size="large" htmlType="submit" loading={searching}>
              搜索
            </Button>
          </Space.Compact>
        </RouterForm>
      </SectionCard>

      {q
        ? (
            <SectionCard title={`「${q}」的搜索结果（${results.length} 条）`}>
              {results.length === 0
                ? <EmptyState description="没搜到，换个关键词试试" />
                : (
                    results.map((r, i) => (
                      <FundListItem
                        key={r.code}
                        fundCode={r.code}
                        fundName={r.name}
                        fundType={r.type || undefined}
                        last={i === results.length - 1}
                        actions={(
                          <Button size="small" type="link" href={`/funds/${r.code}`}>
                            查看详情
                          </Button>
                        )}
                      />
                    ))
                  )}
            </SectionCard>
          )
        : null}

      <SectionCard
        title="基金排行榜"
        extra={(
          <Space size="middle">
            <Segmented
              size="small"
              value={type}
              onChange={v => onTabChange(String(v), "type")}
              options={FUND_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
            />
            <Segmented
              size="small"
              value={period}
              onChange={v => onTabChange(String(v), "period")}
              options={RANK_PERIOD_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
            />
          </Space>
        )}
      >
        {rank.length === 0
          ? <EmptyState description="暂无排行数据，接口可能不可用" />
          : (
              <div>
                {rank.map((r, i) => (
                  <FundListItem
                    key={r.code}
                    fundCode={r.code}
                    fundName={r.name}
                    last={i === rank.length - 1}
                    primary={(
                      <span style={{ color: COLOR.textPrimary }}>
                        {r.unitNav > 0 ? navToDisplay(r.unitNav) : "—"}
                        <span style={{ fontSize: 11, color: COLOR.textSecondary, marginLeft: 6 }}>
                          {r.navDate}
                        </span>
                      </span>
                    )}
                    secondary={(
                      <span style={{ fontSize: 12 }}>
                        日涨跌 <PnlText rate={r.growthRate / 10000} size={12} />
                        {r.periodRate !== null && (
                          <>
                            {" · 区间 "}
                            <PnlText rate={r.periodRate / 10000} size={12} />
                          </>
                        )}
                      </span>
                    )}
                    actions={(
                      <Button size="small" type="link" href={`/funds/${r.code}`}>
                        查看详情
                      </Button>
                    )}
                  />
                ))}
              </div>
            )}
      </SectionCard>
    </Space>
  );
}
```

- [ ] **Step 2: typecheck + lint + workers 回归**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: 干净；全绿

- [ ] **Step 3: Commit**

```bash
git add app/routes/funds._index.tsx
git commit -m "feat(funds): /funds 升级为发现页（搜索 + 类型×周期排行榜）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `/funds/:code` 详情页增强

**Files:**
- Create: `app/components/PeriodReturnTable.tsx`
- Modify: `app/routes/funds.$code.tsx`（loader 加 `isWatched`/`fetchFundDetail`/`fetchFundPosition`/`calcPeriodReturns`；首访净值 120→400；组件加阶段涨幅表/基金概况/重仓股/加自选/定投入口）
- Modify: `app/routes/funds.$code.tsx` 的 action：加 `intent=watch` 转发到 watchlist？—— 不转发，加自选直接 post 到 `/me/watchlist`，本路由 action 不动。

**Interfaces:**
- Consumes: `ensureFund`（T2）、`getNavSeries`（已导出）、`calcPeriodReturns`（T4）、`fetchFundDetail`/`fetchFundPosition`（T5）、`isWatched`（T3）、`PeriodReturnTable`（本 task 建）、`BuyPanel`（已有）、`SectionCard`/`StatBig`/`DataRow`/`EmptyState`/`fmtYuan`、`navToDisplay`/`rateToPercent`、`COLOR`/`pnlColor`、antd `Table`/`Tag`/`Button`/`Space`/`Typography`
- Produces: 增强后的详情页。

- [ ] **Step 1: 建 `app/components/PeriodReturnTable.tsx`**

```tsx
import type { PeriodReturns } from "~/domain/performance";
import { DataRow } from "~/components/ui/DataRow";

export interface PeriodReturnTableProps {
  returns: PeriodReturns;
}

const ROWS: { label: string; key: keyof PeriodReturns }[] = [
  { label: "近 1 周", key: "w1" },
  { label: "近 1 月", key: "m1" },
  { label: "近 3 月", key: "m3" },
  { label: "近 6 月", key: "m6" },
  { label: "近 1 年", key: "y1" },
  { label: "今年来", key: "ytd" },
  { label: "成立来", key: "all" },
];

/**
 * 阶段涨幅表。null 渲染「—」，值走 rateToPercent（万分之→百分比）。
 * 用 DataRow 行而非 antd Table —— 7 行键值对，同维度单行对比，
 * DataRow 的 dl/dt/dd 语义比 Table 轻，且与详情页其他概况行一致。
 */
export function PeriodReturnTable({ returns }: PeriodReturnTableProps) {
  return (
    <div>
      {ROWS.map((r, i) => {
        const v = returns[r.key];
        return (
          <DataRow
            key={r.key}
            label={r.label}
            value={v === null ? "—" : `${v > 0 ? "+" : ""}${(v / 10000 * 100).toFixed(2)}%`}
            mono
            last={i === ROWS.length - 1}
          />
        );
      })}
    </div>
  );
}
```

**⚠️ 实现者注意**：上面 value 用了手写格式而非 `rateToPercent`，因为 `rateToPercent` 不补 `+` 号（涨需要显式 `+`）。手写 `${v>0?"+":""}${(v/10000*100).toFixed(2)}%` 正确。保持。

- [ ] **Step 2: `funds.$code.tsx` loader 增强**

在 loader 里，`ensureFund` 之后、净值首访逻辑里把 `fetchNavHistory(env, code, 120)` 改为 `fetchNavHistory(env, code, 400)`（spec §6：近1年需约 250 交易日，120 不够，改 400 约 1.6 年）。

在 loader 末尾 `return { ... }` 之前，对登录用户加 `isWatched`，并并行拉详情/重仓股/阶段涨幅：
```tsx
  // 登录用户才需要现金余额与自选态
  const user = await getCurrentUser(request, db);
  let cash: number | null = null;
  let watched = false;
  if (user) {
    const acc = await db.query.account.findFirst({ where: eq(account.userId, user.id) });
    cash = acc?.cash ?? 0;
    const { isWatched } = await import("~/services/watchlist-service");
    watched = await isWatched(db, user.id, code);
  }

  const latest = series.at(-1) ?? null;

  // 阶段涨幅：本地 fund_nav 计算（不新增接口依赖）
  const periodReturns = calcPeriodReturns(series);

  // 基金概况与重仓股：东财接口，拉不到为 null/[]（不渲染对应卡片）
  const [detail, position] = await Promise.all([
    fetchFundDetail(env, code),
    fetchFundPosition(env, code),
  ]);

  return {
    fund: { ... },       // 原样
    series,
    latest,
    cash,
    isLoggedIn: !!user,
    watched,
    periodReturns,
    detail,
    position,
  };
```

顶部 import 补：
```tsx
import { calcPeriodReturns } from "~/domain/performance";
import { fetchFundDetail, fetchFundPosition, ensureFund, fetchNavHistory } from "~/services/fund-data";
import { isWatched } from "~/services/watchlist-service";
import { PeriodReturnTable } from "~/components/PeriodReturnTable";
```
（删掉不再用的 `fetchFundBasic` import；`DEFAULT_REDEEM_TIERS` 若 loader 不再用但 component 仍用就保留——component 用 `f.redeemTiers`，不用默认档，可删。改前 grep 确认。）

**注意**：loader 里 `isWatched` 用动态 `import` 上面写法在 loader 顶层用静态 import 即可（Step 2 已加静态 import），不要在 loader 里再动态 import。把 `const { isWatched } = await import(...)` 改为直接 `isWatched(db, user.id, code)`（用顶部静态 import）。

- [ ] **Step 3: `funds.$code.tsx` 组件增强**

在 `FundDetail` 组件里，按以下顺序插入新卡片（保持已有的 header / StatBig / NavChart / 赎回费率阶梯 / 买入区）：

a) **净值走势** 之后插入「阶段涨幅」：
```tsx
      <SectionCard title="阶段涨幅">
        <PeriodReturnTable returns={loaderData.periodReturns} />
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          基于本地历史净值计算，前向填充非交易日。数据不足的区间显示「—」。
        </Paragraph>
      </SectionCard>
```

b) **赎回费率阶梯** 之后插入「基金概况」（仅当 `detail` 非空）：
```tsx
      {loaderData.detail && (
        <SectionCard title="基金概况">
          <DataRow label="基金经理" value={loaderData.detail.manager || "—"} />
          <DataRow label="基金公司" value={loaderData.detail.company || "—"} />
          <DataRow label="成立日期" value={loaderData.detail.estabDate || "—"} />
          <DataRow
            label="最新规模"
            value={loaderData.detail.scaleYuan !== null
              ? `${(loaderData.detail.scaleYuan / 1e8).toFixed(2)} 亿元`
              : "—"}
            mono
          />
          <DataRow label="管理费" value={rateToPercent(loaderData.detail.mgmtFeeRate)} mono />
          <DataRow label="托管费" value={rateToPercent(loaderData.detail.trustFeeRate)} mono last />
          {loaderData.detail.benchmark && (
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              业绩基准：{loaderData.detail.benchmark}
            </Paragraph>
          )}
        </SectionCard>
      )}
```

c) **基金概况** 之后插入「重仓股」（仅当 `position` 非空，用 antd `Table`——§4.0 合法表格：同维度多行对比）：
```tsx
      {loaderData.position.length > 0 && (
        <SectionCard title="重仓股（前 10）">
          <Table
            size="small"
            pagination={false}
            rowKey="code"
            dataSource={loaderData.position.slice(0, 10)}
            columns={[
              { title: "代码", dataIndex: "code" },
              { title: "简称", dataIndex: "name" },
              {
                title: "占净值比", dataIndex: "ratio", align: "right",
                render: (v: number) => rateToPercent(v),
              },
              { title: "行业", dataIndex: "industry" },
              { title: "增减持", dataIndex: "changeType" },
            ]}
          />
        </SectionCard>
      )}
```
顶部补 `Table` import（从 antd）。

d) **header** 区（`继续搜索` 按钮旁边）加「加自选」按钮（仅登录）：
```tsx
          <Space style={{ marginTop: 8 }}>
            <Button size="large" href="/funds">继续搜索</Button>
            {isLoggedIn && (
              <fetcher.Form method="post" action="/me/watchlist" style={{ display: "inline" }}>
                <input type="hidden" name="intent" value={loaderData.watched ? "remove" : "add"} />
                <input type="hidden" name="fundCode" value={f.code} />
                <Button
                  size="large"
                  htmlType="submit"
                  // 加自选用主色，已自选用默认色；不占红绿
                  type={loaderData.watched ? "default" : "primary"}
                >
                  {loaderData.watched ? "已自选 ✓" : "加自选"}
                </Button>
              </fetcher.Form>
            )}
          </Space>
```
组件里需要一个 `fetcher`：在 `FundDetail` 函数体顶部加 `const fetcher = useFetcher();`，import `useFetcher` from `react-router`。加自选提交后 `fetcher.data?.ok` 可提示，但为最小改动，按钮提交后靠 `useSearchParams`/reload 刷新 `watched` 也可——**简单起见**：提交后用 `fetcher.data` 在 header 下显式 Alert。在 header 下方加：
```tsx
      {fetcher.data?.ok && <Alert type="success" showIcon message={fetcher.data.message} closable />}
      {fetcher.data?.error && <Alert type="error" showIcon message={fetcher.data.error} closable />}
```

e) **买入区** 之后加「定投」入口（spec §9「买入 + 定投双入口」）：
```tsx
      {isLoggedIn && (
        <SectionCard title="定投">
          <Paragraph type="secondary">
            设置定期定额买入这只基金，系统每天 10:00 自动扫描到期计划下单。
          </Paragraph>
          <Button type="primary" href="/me/dca">去设置定投 →</Button>
        </SectionCard>
      )}
```

- [ ] **Step 4: typecheck + lint + workers 回归 + 领域回归**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:workers`
Expected: 干净；领域 + workers 全绿

- [ ] **Step 5: Commit**

```bash
git add app/components/PeriodReturnTable.tsx app/routes/funds.$code.tsx
git commit -m "feat(funds): 详情页增强（阶段涨幅/经理/规模/成立日/重仓股/加自选/定投入口，首访净值 400 天）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 沪深300基准叠加（彩蛋，可砍）

**⚠️ 本任务可砍。** spec §10/§12 明确沪深300基准叠加是期四彩蛋，风险最高、价值最低（装饰性）。若时间/额度紧，跳过本任务不影响期四验收。下面给出完整实现，砍掉的话 NavChart 不变、详情页不加基准开关即可。

**Files:**
- Modify: `app/components/NavChart.tsx`（接受可选 `benchmark?: { date: string; close: number }[]`，叠加归一化基准线）
- Modify: `app/routes/funds.$code.tsx`（loader 拉 `fetchIndexNav(env, "1.000300", 400)`，传给 NavChart；拉不到传 undefined，基准线不画）

**Interfaces:**
- Consumes: `fetchIndexNav`（T5）、`NavChart`（改）
- Produces: NavChart 多一条沪深300归一化线（蓝/灰虚线），拉不到不画。

- [ ] **Step 1: `NavChart.tsx` 加 `benchmark` prop**

`NavChart` 的 props 加 `benchmark?: { date: string; close: number }[]`。在 `chartData` 的 `useMemo` 里，若有 benchmark，归一化：以**基金与基准共同的最早日期**为基点，两者都缩放到该日 = 净值起点值（基金用真实净值，基准缩放到同一起点便于对比涨跌而非绝对值）。简单做法：基准归一化到基金首日的净值——`bench[i].close / bench[0].close * fundFirstNav`。把基准数据并进 `chartData`，加一个 `type` 字段区分 `nav`/`bench`，`LineConfig` 用 `colorField: "type"` 画两条线。

```tsx
// NavChart.tsx 修改要点（不全列，实现者照既有结构补）：
export interface NavPoint { navDate: string; unitNav: number; growthRate: number; }
// 新增 benchmark 入参
export function NavChart({ data, benchmark }: { data: NavPoint[]; benchmark?: { date: string; close: number }[] }) {
  // ... 既有 range state
  const chartData = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range) ?? RANGES[1];
    const sliced = cfg.days === Number.MAX_SAFE_INTEGER ? data : data.slice(-cfg.days);
    const navRows = sliced.map(d => ({ date: d.navDate, type: "本基金", value: Number((d.unitNav / NAV_SCALE).toFixed(4)) }));
    if (benchmark && benchmark.length > 0) {
      // 基准与基金同窗口，归一化到基金窗口首日净值
      const benchSliced = cfg.days === Number.MAX_SAFE_INTEGER ? benchmark : benchmark.slice(-cfg.days);
      const fundFirst = sliced[0]?.unitNav ?? NAV_SCALE;
      const benchFirst = benchSliced[0]?.close ?? 1;
      const benchRows = benchSliced.map(b => ({
        date: b.date, type: "沪深300",
        value: Number(((b.close / benchFirst) * (fundFirst / NAV_SCALE)).toFixed(4)),
      }));
      return [...navRows, ...benchRows];
    }
    return navRows;
  }, [data, range, benchmark]);

  // config 改 yField: "value", colorField: "type"，xField: "date"
  const config: LineConfig = {
    data: chartData,
    xField: "date",
    yField: "value",
    colorField: "type",
    height: 320,
    smooth: true,
    autoFit: true,
    scale: { y: { nice: true, zero: false } },
    axis: {
      x: { labelAutoHide: true, labelAutoRotate: false },
      y: { labelFormatter: (v: number) => v.toFixed(4) },
    },
    style: { lineWidth: 2 },
    // 基准用虚线
  };
  // ... 既有渲染
}
```

**⚠️ 实现者注意**：把字段从 `nav` 改成 `value` + `colorField: "type"` 后，单条基金线时 `colorField` 仍能正常工作（只有一类）。tooltip/legend 会显示「本基金/沪深300」。若 `@ant-design/charts` 的 `Line` 不支持 `colorField`，改用 `seriesField: "type"`（v2 兼容）。改后跑 `pnpm typecheck` 确认 `LineConfig` 接受。

- [ ] **Step 2: `funds.$code.tsx` loader 拉基准并传入**

loader 的 `Promise.all` 加一项：
```tsx
  const [detail, position, indexNav] = await Promise.all([
    fetchFundDetail(env, code),
    fetchFundPosition(env, code),
    fetchIndexNav(env, "1.000300", 400),  // 沪深300，可砍
  ]);
```
return 加 `indexNav`。顶部 import `fetchIndexNav`。

组件里 `<NavChart data={series} />` 改 `<NavChart data={series} benchmark={loaderData.indexNav.length > 0 ? loaderData.indexNav : undefined} />`。拉不到（空数组）传 `undefined`，基准线不画——降级。

- [ ] **Step 3: typecheck + lint + 全量回归**

Run: `pnpm verify && pnpm test:workers`
Expected: 干净；全绿

- [ ] **Step 4: Commit**

```bash
git add app/components/NavChart.tsx app/routes/funds.$code.tsx
git commit -m "feat(chart): 沪深300基准叠加（详情页净值图，可砍彩蛋）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**（spec §10 期四 + §9 页面清单 + §6/§7/§8）：
- `watchlist` 表 + 迁移 → T1 ✓
- `ensureFund()` 抽取 + `watchlist-service` + `/me/watchlist` → T2 + T3 + T7 ✓
- `fetchFundRank` + `/funds` 发现页 → T5 + T6 + T8 ✓
- `tests/domain/performance.test.ts` 先写 + `performance.ts` → T4（TDD，测试在 Step1、实现在 Step3）✓
- 详情页阶段涨幅表 + 经理 + 重仓股；首访 120 → 400 → T9（`PeriodReturnTable` + `fetchFundDetail` + `fetchFundPosition` + 400）✓
- 沪深300基准叠加（彩蛋可砍）→ T10（明确标记可砍）✓
- §9 `/funds` 改（升级发现页）→ T8 ✓；`/funds/:code` 改（增强）→ T9 ✓；`/me/watchlist` 新增 → T7 ✓；`root.tsx` 导航加「自选」→ T7 ✓
- §8 降级：排行榜挂掉走本地（T6）✓；详情页缺经理/重仓股只是少卡片（T9 `detail &&` / `position.length > 0` 条件渲染）✓
- §6 `calcPeriodReturns` 万分之整数 + 前向填充 + YTD 跨年 + null → T4 测试覆盖 ✓
- §7 `watchlist` 复合主键防重复 + `ensureFund` 两处复用（详情页 loader + watchlist add）→ T2/T3 ✓

**2. 验收对照**（spec §10 期四验收）：
- 「排行榜接口挂掉时页面仍可用（走本地降级）」→ T6 `getFundRank` 本地降级 + 测试「东财挂掉时本地降级」✓
- 「详情页缺经理/重仓股数据时只是少一张卡片，不报错」→ T9 `{detail && ...}` / `{position.length > 0 && ...}`，fetcher 失败返回 null/[] ✓

**3. Placeholder 扫描**：
- T3 watchlist 测试里「级联删除」用了占位（`{}` where 子句 + 两行注释）——**已在测试代码块后紧跟「⚠️ 实现者注意」给出正确写法**（`eq(user.id, userId)` + import `eq`），不是悬空 TODO。
- T6 rank-service 顶部写了一段错误 import 路径演示，**紧跟「⚠️ 实现者注意」给出正确 import**——是教学性占位，有明确修正，不是 TODO。
- 其余各 Task 的代码块均为完整可跑内容，无 TBD/TODO/「add error handling」空话。`funds.$code` loader 的 `return { fund: { ... } }` 用了 `... } // 原样` ——实现者照该文件既有 return 块保留（T2 已读过该 loader 完整结构），不是新写占位。

**4. 类型一致性**：
- `FundRankItem`（T5 定义）字段 `code/name/navDate/unitNav/growthRate/periodRate` 与 T6 `getFundRank` 返回、T8 `rank` 渲染逐字对齐 ✓
- `WatchItem`（T3）字段 `fundCode/fundName/fundType/navDate/unitNav/growthRate` 与 T7 `me.watchlist` 渲染逐字对齐 ✓
- `FundDetail`（T5）字段 `manager/company/estabDate/scaleYuan/benchmark/mgmtFeeRate/trustFeeRate` 与 T9 详情页 `loaderData.detail.*` 逐字对齐 ✓
- `FundStock`（T5）字段 `code/name/ratio/industry/changeType` 与 T9 重仓股 Table `dataIndex` 逐字对齐 ✓
- `PeriodReturns`（T4）字段 `w1/m1/m3/m6/y1/ytd/all` 与 T6 `PERIOD.field`（`m1`/`m3`/`y1`）、`PeriodReturnTable` 的 `ROWS.key` 逐字对齐 ✓
- `getFundRank(db, env, type, period)` 签名（T6）与 T8 loader 调用 `getFundRank(db, env, type, period)` 一致 ✓
- `addWatch(db, env, userId, fundCode)`/`removeWatch(db, userId, fundCode)`/`isWatched(db, userId, fundCode)`（T3）与 T7 action、T9 loader 调用逐字对齐 ✓
- `FundType`/`RankPeriod`（T6 导出）与 T8 `parseType`/`parsePeriod` 的字面量联合 `["gp","hh","zs","zq"]`/`["1m","3m","1y"]` 一致 ✓

**5. 风险点**：
- T9 `funds.$code` loader 改动较大（加 isWatched/detail/position/periodReturns + 400 天 + return 扩展）——改前已读完整 loader（T2 步骤里读过），return 块结构清晰；实现者需保留原 `fund: { code, name, ... redeemTiers }` 块原样。
- T9 动态 import `isWatched` 在 Step2 文字里先写动态再改静态——**最终以静态 import 为准**（Step2 末尾明确：「把动态 import 改为顶部静态 import」）。
- T3 `latestNavMap` 追加 `growthRate` 是对 `portfolio-service` 的改动，`getPortfolio`/`getHoldingDetail` 读法不变（只取 navDate/unitNav），已确认两处解构不破。
- T1 迁移生成后必须 `pnpm db:migrate:local`，否则 T3 的 workers 测试 `watchlist` 表不存在（测试从 `drizzle/` 读迁移建表，`setup-d1.ts` 用 `TEST_MIGRATIONS`）。
- T8 删 `SUGGESTED` 后搜索引导文案改为排行榜，与 spec §9「干掉硬编码 5 只基金」一致。
- T7 `NAV_ITEMS` 顺序：`/me/watchlist` 必须在 `/me` 之前，否则 `selectedKey` 的 `startsWith` 会把自选页高亮成「我的」——已在 Step3 注明。
- T10 可砍：若跳过，`funds.$code` 不拉 `fetchIndexNav`、NavChart 不加 `benchmark` prop，其余 T9 内容不受影响。砍 T10 时**不要**把 T10 的 import/return 字段加进去。
