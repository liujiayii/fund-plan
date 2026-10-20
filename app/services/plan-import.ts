import type { Db } from "~/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { account, fund, orders, transactions } from "~/db/schema";
import { centsToYuan } from "~/domain/money";
import { lookupPlanFund } from "~/domain/plan-catalog";
import { resolveConfirmDate } from "~/domain/trading-calendar";
import { cashDelta, cashNow } from "./cash";
import { ensureFund } from "./fund-data";

/**
 * 计划导入的写侧编排：把解析出来的简称配上场外代码，再一期一次落单。
 *
 * 代码来源**只有一张表**：`domain/plan-catalog` 的品种池（螺丝钉估值表）。
 * 这里不做任何模糊搜索——东财搜「自由现金流」前六条全是场内 ETF，
 * 搜「消费龙头」前四条是主动混合型，猜一次就错一次。
 */

/** 基金档案行（`ensureFund` 的返回类型没有导出，这里按表结构推） */
type FundProfile = typeof fund.$inferSelect;

/** 预览表里的一行 */
export interface PlanImportRow {
  /** 原文品种名 */
  alias: string;
  /** 申购金额（分） */
  amountCents: number;
  /** 命中的场外代码；品种池里没有这一条时为 null（必须人工选） */
  selectedCode: string | null;
  /** 命中代码的基金全称（档案还没拉过时为 null，不影响下单） */
  selectedName: string | null;
  /** 行内提示：池外品种 / 本期已买 */
  notices: string[];
}

/** 只处理会成交的订单状态（failed / cancelled 不算「买过」） */
const LIVE_STATUS = ["pending", "confirmed"] as const;

/**
 * 把解析结果配上代码。
 *
 * 查询数：基金档案 1 + 本期已买 1 = 2 条，与品种数无关。
 * 零网络请求——命中的代码如果站内还没档案，留到 commit 时再 `ensureFund`，
 * 免得用户只是打开预览就触发 9 次东财请求。
 */
export async function resolvePlanImport(
  db: Db,
  userId: number,
  items: readonly { alias: string; amountCents: number }[],
  periodDate: string | null,
): Promise<PlanImportRow[]> {
  if (items.length === 0)
    return [];

  // 命中的代码一次取回档案：行里要显示全称，用户才知道选得对不对
  const codes = [
    ...new Set(
      items
        .map(i => lookupPlanFund(i.alias)?.otcCode)
        .filter((c): c is string => c !== undefined),
    ),
  ];
  const fundRows = codes.length > 0
    ? await db
        .select({ code: fund.code, name: fund.name })
        .from(fund)
        .where(inArray(fund.code, codes))
    : [];
  const nameMap = new Map(fundRows.map(f => [f.code, f.name]));

  // 本期已买的同一只：提示追加，而不是静默跳过（主理人确实会补单）
  const boughtThisPeriod = new Map<string, number>();
  if (periodDate !== null) {
    const rows = await db
      .select({ fundCode: orders.fundCode, amount: orders.amount })
      .from(orders)
      .where(and(
        eq(orders.userId, userId),
        eq(orders.side, "buy"),
        eq(orders.placeDate, periodDate),
        inArray(orders.status, [...LIVE_STATUS]),
      ));
    for (const r of rows)
      boughtThisPeriod.set(r.fundCode, (boughtThisPeriod.get(r.fundCode) ?? 0) + (r.amount ?? 0));
  }

  return items.map((item) => {
    const hit = lookupPlanFund(item.alias);
    const notices: string[] = [];

    if (hit === null) {
      notices.push("品种池里没有这一条，请手动选择或跳过");
    }
    else if (boughtThisPeriod.has(hit.otcCode)) {
      notices.push(
        `本期已买 ${centsToYuan(boughtThisPeriod.get(hit.otcCode)!)} 元，本次追加`,
      );
    }

    return {
      alias: item.alias,
      amountCents: item.amountCents,
      selectedCode: hit?.otcCode ?? null,
      selectedName: hit ? (nameMap.get(hit.otcCode) ?? null) : null,
      notices,
    };
  });
}

// ==================== 一期一次落单 ====================

/** 一次导入的品种上限：2N+1 条语句必须落在同一个 D1 batch 里（不分块） */
export const MAX_PLAN_ITEMS = 40;
/** 单只金额上限 1000 万元 = 1_000_000_000 分：挡住「是整数但超 2^53」的脏值 */
const MAX_AMOUNT_CENTS = 1_000_000_000;

/** 批量买入入参 */
export interface PlacePlanBuysInput {
  userId: number;
  /** 期次（原文日期 YYYY-MM-DD） */
  periodDate: string;
  items: readonly { fundCode: string; amountCents: number }[];
}

/**
 * 把一整期品种一次落成 pending 买单。
 *
 * 与 `placeBuyOrder` 的差别有三处：
 *   1. **期次来自原文**，不是「今天」——补录上周是正当用法；
 *   2. **N 笔一起原子提交**。逐笔的话第 5 笔失败会留下 4 笔已下单，
 *      资金和计划对不上，比整批失败难处理得多；
 *   3. **档案缺失时先补**（`ensureFund`）。品种池里的代码用户可能从没在站内
 *      看过，不补就会在「基金不存在」这一步整批失败。
 *
 * 下单时刻固定成期次当天 13:30（螺丝钉的发布时间）：15:00 前申购吃当日净值，
 * 与主理人过去手动录入的口径完全一致。
 *
 * ⚠️ `transactions.orderId` 这里**刻意留空**：D1 的 batch 不把前面语句的结果
 * 喂给后面的语句，拿不到刚插入的订单 id。替代方案（先插订单拿 id 再扣款）
 * 会在第二个 batch 失败时留下「订单在、钱没扣」，比少一个外键严重得多。
 * 对账信息写在 note 里：期次 + 第几笔 + 基金代码。
 *
 * ⚠️ **现金必须走 `cashDelta` / `cashNow`**（见 `services/cash.ts` 的消费纪律）：
 * 这里是 1 次账户更新 + N 条流水的混合写入。绝对不要写成
 * 「读 cash → JS 相减 → 写回绝对值」——2026-10-14 的定投重复派发事故
 * 就是并发写点各自基于过期余额计算、后提交者覆盖前者造成的。
 */
export async function placePlanBuys(
  db: Db,
  env: Env,
  input: PlacePlanBuysInput,
): Promise<{ placed: number; totalCents: number }> {
  const { userId, periodDate, items } = input;

  if (items.length === 0)
    throw new Error("没有可提交的品种");
  if (items.length > MAX_PLAN_ITEMS)
    throw new Error(`一次最多导入 ${MAX_PLAN_ITEMS} 只，请分批提交`);

  for (const it of items) {
    if (!/^\d{6}$/.test(it.fundCode))
      throw new Error(`基金代码「${it.fundCode}」不合法`);
    // 上界同时挡住 1e30 这种「整数但超 2^53」的脏值（JS 会进入浮点区）
    if (!Number.isInteger(it.amountCents) || it.amountCents <= 0
      || it.amountCents > MAX_AMOUNT_CENTS) {
      throw new Error(`「${it.fundCode}」的金额不合法`);
    }
  }

  const codes = [...new Set(items.map(i => i.fundCode))];

  // 档案一次取回：逐只查是 N+1
  const fundRows = await db.select().from(fund).where(inArray(fund.code, codes));
  const fundMap = new Map<string, FundProfile>(fundRows.map(f => [f.code, f]));

  // 缺失的先补档案（串行：免费版并发出站连接只有 6 个）
  for (const code of codes) {
    if (fundMap.has(code))
      continue;
    const f = await ensureFund(db, env, code);
    if (f)
      fundMap.set(code, f);
  }

  for (const it of items) {
    const f = fundMap.get(it.fundCode);
    if (!f)
      throw new Error(`基金 ${it.fundCode} 拉不到档案，请稍后重试或先去基金页查看`);
    if (it.amountCents < f.minPurchase) {
      throw new Error(
        `${f.name}（${it.fundCode}）低于起购：${centsToYuan(f.minPurchase)} 元起购`,
      );
    }
  }

  const totalCents = items.reduce((s, i) => s + i.amountCents, 0);

  const acc = await db.query.account.findFirst({
    where: eq(account.userId, userId),
  });
  if (!acc)
    throw new Error("账户不存在");
  if (acc.cash < totalCents) {
    throw new Error(
      `现金不足：可用 ${centsToYuan(acc.cash)} 元，本期需要 ${centsToYuan(totalCents)} 元`,
    );
  }

  // 周二 13:30 下单：15:00 前申购按当日净值，确认日 = 当天（休市则顺延）
  const placedAt = new Date(`${periodDate}T13:30:00+08:00`);
  if (Number.isNaN(placedAt.getTime()))
    throw new Error(`期次日期「${periodDate}」不合法`);
  const confirmDate = resolveConfirmDate(placedAt);
  const createdAt = placedAt.getTime();

  // 账户更新用相对量 `cash + Δ`（不是绝对值）：D1 单条语句内完成读改写，
  // 与并发写点（cron 撮合入账、签到、定投冻结）不会互相覆盖。
  // 上面的 acc.cash < totalCents 只是**友好提示**，不是并发防线。
  const writes: unknown[] = [
    db.update(account).set({ cash: cashDelta(-totalCents) }).where(eq(account.userId, userId)),
  ];

  let cumulative = 0;
  items.forEach((it, idx) => {
    cumulative += it.amountCents;
    const f = fundMap.get(it.fundCode)!;

    writes.push(db.insert(orders).values({
      userId,
      fundCode: it.fundCode,
      side: "buy" as const,
      status: "pending" as const,
      source: "manual" as const,
      amount: it.amountCents,
      shares: null,
      placeDate: periodDate,
      confirmDate,
      createdAt,
    }));

    writes.push(db.insert(transactions).values({
      userId,
      type: "buy" as const,
      amount: -it.amountCents,
      // 本批账户已扣满 totalCents，再补上「还没扣到的部分」= 这笔之后的余额。
      // 子查询读的是同一事务里 UPDATE 之后的真值，不是 JS 里推出来的快照。
      balance: cashNow(userId, totalCents - cumulative),
      orderId: null,
      note: `计划导入 ${periodDate} 第 ${idx + 1}/${items.length} 笔：`
        + `申购 ${f.name}（${it.fundCode}），待 ${confirmDate} 确认`,
      createdAt,
    }));
  });

  // 直调 batch 而不是 runBatch：后者超过 100 条会静默分块，
  // 而这里「整期一次原子提交」是功能正确性的一部分。
  await db.batch(writes as unknown as Parameters<Db["batch"]>[0]);

  return { placed: items.length, totalCents };
}
