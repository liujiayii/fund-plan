import type { Db } from "~/db/client";
import type { OrderRow } from "~/db/schema";
import type { RedeemTier } from "~/domain/redeem";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { runBatch } from "~/db/client";
import {
  account,
  fund,
  fundNav,
  holding,

  orders,
  shareLot,
  transactions,
} from "~/db/schema";
import { calcPurchase } from "~/domain/purchase";
import { calcRedeem, DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { toBeijing } from "~/domain/trading-calendar";
import { fetchNavHistory } from "./fund-data";

/**
 * 撮合引擎：净值同步 + T+1 确认。
 *
 * 幂等是硬要求——Cron 会重试，同一订单被撮合两次就是重复成交。
 * 实现方式：只处理 status='pending' 的订单，确认后立刻置为 confirmed；
 * 所有写操作在同一个 db.batch() 里原子提交。
 *
 * 另一条铁律：拉不到净值时订单**保持 pending 顺延**，绝不判失败。
 * 网络抖动不该让用户的单子凭空消失。
 */

export interface SettleResult {
  /** 成功确认的订单数 */
  confirmed: number;
  /** 因缺净值而顺延的订单数 */
  skipped: number;
  /** 因业务原因失败的订单数 */
  failed: number;
}

/**
 * 同步基金净值到 fund_nav 表。
 * @param db Drizzle 实例
 * @param env Worker 环境（取 KV 与网络）
 * @param fundCodes 指定基金；不传则同步所有「有持仓或有待确认订单」的基金
 */
export async function syncNav(
  db: Db,
  env: Env,
  fundCodes?: string[],
): Promise<{ synced: number }> {
  let codes = fundCodes;

  if (!codes) {
    // 只同步真正用得上的基金，省接口调用与 D1 写次数
    const fromOrders = await db
      .selectDistinct({ code: orders.fundCode })
      .from(orders)
      .where(eq(orders.status, "pending"));
    const fromHoldings = await db
      .selectDistinct({ code: holding.fundCode })
      .from(holding);
    codes = [
      ...new Set([
        ...fromOrders.map(r => r.code),
        ...fromHoldings.map(r => r.code),
      ]),
    ];
  }

  let synced = 0;
  for (const code of codes) {
    const rows = await fetchNavHistory(env, code, 30);
    if (rows.length === 0) {
      console.warn(`[settle] 基金 ${code} 净值拉取为空，跳过`);
      continue;
    }
    // 逐条 upsert：已存在的日期覆盖，避免重复主键报错
    for (const r of rows) {
      await db
        .insert(fundNav)
        .values({
          fundCode: code,
          navDate: r.navDate,
          unitNav: r.unitNav,
          accNav: r.accNav,
          growthRate: r.growthRate,
        })
        .onConflictDoUpdate({
          target: [fundNav.fundCode, fundNav.navDate],
          set: {
            unitNav: r.unitNav,
            accNav: r.accNav,
            growthRate: r.growthRate,
          },
        });
    }
    synced += rows.length;
  }

  return { synced };
}

/**
 * 撮合所有到期的待确认订单。
 *
 * @param db Drizzle 实例
 * @param _env Worker 环境（当前未用到，保留以便后续扩展）
 * @param now 当前时刻（测试可注入）
 */
export async function settlePendingOrders(
  db: Db,
  _env: Env,
  now: Date = new Date(),
): Promise<SettleResult> {
  const today = toBeijing(now).format("YYYY-MM-DD");

  // 只捞确认日已到、且仍处于 pending 的订单——这是幂等的关键
  const pending = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, "pending"), lte(orders.confirmDate, today)))
    .orderBy(asc(orders.confirmDate), asc(orders.id));

  const result: SettleResult = { confirmed: 0, skipped: 0, failed: 0 };

  for (const order of pending) {
    try {
      // 取确认日净值；没有就顺延（不改状态）
      const nav = await db.query.fundNav.findFirst({
        where: and(
          eq(fundNav.fundCode, order.fundCode),
          eq(fundNav.navDate, order.confirmDate),
        ),
      });
      if (!nav) {
        result.skipped++;
        continue;
      }

      if (order.side === "buy") {
        const won = await settleBuyOrder(db, order, nav.unitNav, now);
        if (!won) {
          // 撮合读到 pending 之后订单被撤单/改动抢先翻转——跳过，不当成交
          result.skipped++;
          continue;
        }
      }
      else {
        const won = await settleSellOrder(db, order, nav.unitNav, now);
        if (!won) {
          result.skipped++;
          continue;
        }
      }
      result.confirmed++;
    }
    catch (err) {
      console.error(`[settle] 订单 ${order.id} 撮合失败：`, err);
      // 业务性失败：标记 failed 并退还冻结的现金（买单）
      await failOrder(db, order, err instanceof Error ? err.message : "撮合失败", now);
      result.failed++;
    }
  }

  return result;
}

/**
 * 确认买单：算份额、建批次、累加持仓。
 * 两段式：先带 pending 守卫翻转 confirmed（原子裁判，撤单与并发撮合
 * 抢不过这道 UPDATE），赢了才写批次与持仓——否则可能出现
 * 「已撤单还记份额 + 用户还拿到退款」的双花。
 * @returns false = 订单已被撤单/改动抢先，本次不成交
 */
async function settleBuyOrder(
  db: Db,
  order: OrderRow,
  navScaled: number,
  now: Date,
): Promise<boolean> {
  if (order.amount === null) {
    throw new Error("买单缺少申购金额");
  }

  const f = await db.query.fund.findFirst({
    where: eq(fund.code, order.fundCode),
  });
  const purchaseRate = f?.purchaseRate ?? 0;

  const calc = calcPurchase({
    amountCents: order.amount,
    navScaled,
    purchaseRate,
  });

  // 该批次成本 = 全部申购金额（含手续费）——这才是用户真金白银的投入
  const lotCost = order.amount;

  // 第一段：原子裁判——只有仍 pending 才能确认并回填成交信息
  const flipped = await db
    .update(orders)
    .set({
      status: "confirmed",
      dealNav: navScaled,
      dealShares: calc.sharesScaled,
      dealAmount: calc.netAmountCents,
      fee: calc.feeCents,
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    return false; // 被撤单/改动抢先
  }

  const existing = await db.query.holding.findFirst({
    where: and(
      eq(holding.userId, order.userId),
      eq(holding.fundCode, order.fundCode),
    ),
  });

  // 第二段：批次与持仓（赢得裁判后写入）
  const writes = [
    // 1. 新增份额批次（FIFO 赎回的依据）
    db.insert(shareLot).values({
      userId: order.userId,
      fundCode: order.fundCode,
      shares: calc.sharesScaled,
      cost: lotCost,
      confirmDate: order.confirmDate,
      orderId: order.id,
    }),
    // 2. 维护持仓汇总
    existing
      ? db
          .update(holding)
          .set({
            totalShares: existing.totalShares + calc.sharesScaled,
            totalCost: existing.totalCost + lotCost,
          })
          .where(
            and(
              eq(holding.userId, order.userId),
              eq(holding.fundCode, order.fundCode),
            ),
          )
      : db.insert(holding).values({
          userId: order.userId,
          fundCode: order.fundCode,
          totalShares: calc.sharesScaled,
          totalCost: lotCost,
        }),
  ];

  await runBatch(db, writes);
  void now;
  return true;
}

/** 确认卖单：FIFO 消耗批次、扣费、现金入账。两段式同 settleBuyOrder（见其注释） */
async function settleSellOrder(
  db: Db,
  order: OrderRow,
  navScaled: number,
  now: Date,
): Promise<boolean> {
  if (order.shares === null) {
    throw new Error("卖单缺少赎回份额");
  }

  const f = await db.query.fund.findFirst({
    where: eq(fund.code, order.fundCode),
  });
  const tiers: RedeemTier[]
    = (f?.redeemTiers as RedeemTier[] | undefined) ?? DEFAULT_REDEEM_TIERS;

  // 取该基金的全部批次，按 FIFO 顺序
  const lots = await db
    .select()
    .from(shareLot)
    .where(
      and(
        eq(shareLot.userId, order.userId),
        eq(shareLot.fundCode, order.fundCode),
      ),
    )
    .orderBy(asc(shareLot.confirmDate), asc(shareLot.id));

  const calc = calcRedeem({
    lots: lots.map(l => ({
      id: l.id,
      sharesScaled: l.shares,
      costCents: l.cost,
      confirmDate: l.confirmDate,
    })),
    redeemSharesScaled: order.shares,
    navScaled,
    confirmDate: order.confirmDate,
    tiers,
  });

  const acc = await db.query.account.findFirst({
    where: eq(account.userId, order.userId),
  });
  if (!acc)
    throw new Error("账户不存在");

  const newCash = acc.cash + calc.totalNetCents;

  const h = await db.query.holding.findFirst({
    where: and(
      eq(holding.userId, order.userId),
      eq(holding.fundCode, order.fundCode),
    ),
  });
  if (!h)
    throw new Error("持仓不存在");

  // 计算每个批次消耗后的剩余；耗尽的批次删除
  const exhaustedIds: number[] = [];
  const updates: unknown[] = [];
  for (const lr of calc.lotResults) {
    const lot = lots.find(l => l.id === lr.lotId)!;
    const remainShares = lot.shares - lr.consumedSharesScaled;
    const remainCost = lot.cost - lr.costCents;
    if (remainShares <= 0) {
      exhaustedIds.push(lot.id);
    }
    else {
      updates.push(
        db
          .update(shareLot)
          .set({ shares: remainShares, cost: remainCost })
          .where(eq(shareLot.id, lot.id)),
      );
    }
  }

  const ts = now.getTime();

  // 第一段：原子裁判——只有仍 pending 才能确认（防撤单/改动抢先）
  const flipped = await db
    .update(orders)
    .set({
      status: "confirmed",
      dealNav: navScaled,
      dealShares: order.shares,
      dealAmount: calc.totalNetCents,
      fee: calc.totalFeeCents,
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    return false; // 被撤单/改动抢先
  }

  const writes: unknown[] = [
    // 1. 批次增减
    ...updates,
    // 3. 持仓递减
    db
      .update(holding)
      .set({
        totalShares: h.totalShares - order.shares,
        totalCost: h.totalCost - calc.totalCostCents,
      })
      .where(
        and(
          eq(holding.userId, order.userId),
          eq(holding.fundCode, order.fundCode),
        ),
      ),
    // 4. 现金入账
    db.update(account).set({ cash: newCash }).where(eq(account.userId, order.userId)),
    // 5. 到账流水
    db.insert(transactions).values({
      userId: order.userId,
      type: "sell",
      amount: calc.totalNetCents,
      balance: newCash,
      orderId: order.id,
      note: `赎回 ${f?.name ?? order.fundCode} 到账`,
      createdAt: ts,
    }),
  ];

  // 6. 手续费单独记一条，便于统计总成本
  if (calc.totalFeeCents > 0) {
    writes.push(
      db.insert(transactions).values({
        userId: order.userId,
        type: "fee",
        amount: -calc.totalFeeCents,
        balance: newCash,
        orderId: order.id,
        note: `赎回手续费`,
        createdAt: ts,
      }),
    );
  }

  if (exhaustedIds.length > 0) {
    writes.push(db.delete(shareLot).where(inArray(shareLot.id, exhaustedIds)));
  }

  await runBatch(db, writes);
  return true;
}

/**
 * 标记订单失败。买单需退还此前冻结的现金，
 * 否则用户的钱会凭空消失。
 * 带_pending 守卫：订单已被撤单/撮合抢先处理时整体跳过，不重复退钱。
 */
async function failOrder(
  db: Db,
  order: OrderRow,
  reason: string,
  now: Date,
): Promise<void> {
  // 第一段：原子裁判——只有仍 pending 才能置 failed
  const flipped = await db
    .update(orders)
    .set({ status: "failed", failReason: reason })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    return; // 已被撤单/撮合抢先，不属于本次失败处置
  }

  if (order.side === "buy" && order.amount !== null) {
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, order.userId),
    });
    if (acc) {
      const refunded = acc.cash + order.amount;
      await runBatch(db, [
        db
          .update(account)
          .set({ cash: refunded })
          .where(eq(account.userId, order.userId)),
        db.insert(transactions).values({
          userId: order.userId,
          type: "buy",
          amount: order.amount, // 退款为正
          balance: refunded,
          orderId: order.id,
          note: `申购失败退款：${reason}`,
          createdAt: now.getTime(),
        }),
      ]);
    }
  }
}
