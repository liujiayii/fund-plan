import type { Db } from "~/db/client";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { fund, orders } from "~/db/schema";
import { fundShortLabel } from "~/domain/fund-name";
import { latestPlanPeriod } from "~/domain/undervalued-plan";

/**
 * 「低估指数定投计划」页（`/plan`）的读侧编排。
 *
 * 本期品种**完全由主理人的真实买单决定**——页面不维护一份写死的基金名单，
 * 主理人换了品种，页面跟着变。所以这里做三件事：捞出主理人的买单、
 * 用领域层挑出「本期是哪个周二」、把该期的单按基金合并成品种。
 *
 * 查询数是常数（2 条：订单 + 基金名），与期数、品种数无关——
 * ⚠️ 别改成「先查本期有哪些基金，再逐只查名字」，那是 N+1，
 * 公开页在 D1 免费版 50 条/请求的硬顶下会被打穿。
 */

/** 本期的一只品种 */
export interface PlanBuyView {
  fundCode: string;
  fundName: string;
  /** 列表第一行的大字：从全称自动缩出来的简称（`domain/fund-name`），如「标普500」 */
  shortName: string;
  fundType: string;
  /** 主理人本期买入金额（分）；同基金的多笔已合并成一个品种 */
  amountCents: number;
  /** 该基金起购金额（分），用于「换算后低于起购」的提示 */
  minPurchaseCents: number;
}

export interface PlanPeriodView {
  /** 本期日期（周二 YYYY-MM-DD）；主理人一期都没发过车时为 null */
  period: string | null;
  /** 本期品种，按主理人下单先后排列 */
  buys: PlanBuyView[];
  /** 本期主理人买入总额（分） */
  totalCents: number;
}

/**
 * 扫描主理人买单的条数上限。
 * 一期约 9 只、一周一期，300 条 ≈ 33 周——足够回溯到「主理人还没开始发车」为止，
 * 而一条单行查询在 D1 上是白菜价。刻意不按日期开窗：开窗就得先知道窗口边界，
 * 而窗口边界正是这里要算的东西。
 */
const SCAN_LIMIT = 300;

/**
 * 读主理人的「本期」实盘明细。
 *
 * `today` 是北京时间今天（YYYY-MM-DD），由调用方传入而不是这里取当前时间——
 * 时间源从外面进来，这一层才能在测试里固定日期。
 */
export async function getPlanPeriod(
  db: Db,
  adminId: number,
  today: string,
): Promise<PlanPeriodView> {
  // 只取**会成交的**买单：failed / cancelled 不算「主理人买了」。
  // pending 要算——页面在主人落单那一刻就该更新（T+1 说的是份额到账，
  // 不是「买入」这个动作本身）。
  const rows = await db
    .select({
      id: orders.id,
      fundCode: orders.fundCode,
      amount: orders.amount,
      placeDate: orders.placeDate,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, adminId),
        eq(orders.side, "buy"),
        inArray(orders.status, ["pending", "confirmed"]),
      ),
    )
    // 同一期内按 id 升序：页面照主理人下单的先后展示，读起来像一张原始委托
    .orderBy(desc(orders.placeDate), asc(orders.id))
    .limit(SCAN_LIMIT);

  const period = latestPlanPeriod(rows.map(r => r.placeDate), today);
  if (period === null)
    return { period: null, buys: [], totalCents: 0 };

  // 同一只基金在周二被补过单 → 合并成一个品种（否则明细里会出现两行同款）
  const amountMap = new Map<string, number>();
  for (const r of rows) {
    if (r.placeDate !== period)
      continue;
    amountMap.set(r.fundCode, (amountMap.get(r.fundCode) ?? 0) + (r.amount ?? 0));
  }

  const codes = [...amountMap.keys()];
  const funds = codes.length > 0
    ? await db.select().from(fund).where(inArray(fund.code, codes))
    : [];
  const fundMap = new Map(funds.map(f => [f.code, f]));

  const buys: PlanBuyView[] = codes.map((code) => {
    const f = fundMap.get(code);
    return {
      fundCode: code,
      // 档案缺席（订单里有、fund 表里没有）时退化成代码本身，页面照样能显示金额
      fundName: f?.name ?? code,
      // 第一行的大字：全称剥掉公司名与载体后缀（博时标普500ETF联接A → 标普500）
      shortName: f ? fundShortLabel(code, f.name) : code,
      fundType: f?.type ?? "",
      amountCents: amountMap.get(code)!,
      minPurchaseCents: f?.minPurchase ?? 0,
    };
  });

  return {
    period,
    buys,
    totalCents: buys.reduce((s, b) => s + b.amountCents, 0),
  };
}
