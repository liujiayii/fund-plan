import type { Db } from "~/db/client";
import { and, eq, ne, sql } from "drizzle-orm";
import { runBatch } from "~/db/client";
import { account, fund, holding, orders, transactions } from "~/db/schema";
import { centsToYuan, sharesToDisplay } from "~/domain/money";
import { planAmendBuy, planAmendSell, planCancel } from "~/domain/order-lifecycle";
import { resolveConfirmDate, toBeijing } from "~/domain/trading-calendar";

/**
 * 下单服务。
 *
 * 两条关键设计：
 *  1. **买入立即扣现金**（冻结）。若等确认时才扣，用户可以用同一笔钱
 *     连下十单，确认时集体失败——体验差且难对账。
 *  2. **赎回占用份额**。已挂单未确认的赎回份额要算进占用，
 *     否则 1000 份可以被赎两次 800 份。
 */

export interface PlaceBuyInput {
  userId: number;
  fundCode: string;
  /** 申购金额（分） */
  amountCents: number;
  /** 来源，默认手动 */
  source?: "manual" | "dca";
  /** 下单时刻，默认现在（测试可注入固定时间） */
  now?: Date;
}

export interface PlaceSellInput {
  userId: number;
  fundCode: string;
  /** 赎回份额 ×10000 */
  sharesScaled: number;
  now?: Date;
}

/**
 * 申购下单。生成 pending 订单并立即冻结现金，
 * 实际成交份额在 T+1 撮合时按确认日净值算出。
 */
export async function placeBuyOrder(
  db: Db,
  _env: Env,
  input: PlaceBuyInput,
): Promise<{ orderId: number }> {
  const { userId, fundCode, amountCents, source = "manual" } = input;
  const now = input.now ?? new Date();

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("申购金额必须为正整数（分）");
  }

  // 基金必须存在且开放申购
  const f = await db.query.fund.findFirst({ where: eq(fund.code, fundCode) });
  if (!f) {
    throw new Error(`基金 ${fundCode} 不存在，请先在基金页搜索并查看一次`);
  }
  if (amountCents < f.minPurchase) {
    throw new Error(
      `低于起购金额：该基金 ${centsToYuan(f.minPurchase)} 元起购`,
    );
  }

  // 现金必须够
  const acc = await db.query.account.findFirst({
    where: eq(account.userId, userId),
  });
  if (!acc)
    throw new Error("账户不存在");
  if (acc.cash < amountCents) {
    throw new Error(
      `现金不足：可用 ${centsToYuan(acc.cash)} 元，需要 ${centsToYuan(amountCents)} 元`,
    );
  }

  const placeDate = toBeijing(now).format("YYYY-MM-DD");
  const confirmDate = resolveConfirmDate(now);
  const newCash = acc.cash - amountCents;

  // 先插订单拿 id，流水要引用它
  const [created] = await db
    .insert(orders)
    .values({
      userId,
      fundCode,
      side: "buy",
      status: "pending",
      source,
      amount: amountCents,
      shares: null,
      placeDate,
      confirmDate,
      createdAt: now.getTime(),
    })
    .returning();

  // 扣现金 + 记流水，必须同生共死
  await db.batch([
    db
      .update(account)
      .set({ cash: newCash })
      .where(eq(account.userId, userId)),
    db.insert(transactions).values({
      userId,
      type: "buy",
      amount: -amountCents, // 出账为负
      balance: newCash,
      orderId: created.id,
      note: `申购 ${f.name}（${fundCode}），待 ${confirmDate} 确认`,
      createdAt: now.getTime(),
    }),
  ]);

  return { orderId: created.id };
}

/**
 * 赎回下单。生成 pending 订单，**不预先入账**——
 * 到账金额取决于确认日净值和 FIFO 阶梯费，现在算不出来。
 */
export async function placeSellOrder(
  db: Db,
  _env: Env,
  input: PlaceSellInput,
): Promise<{ orderId: number }> {
  const { userId, fundCode, sharesScaled } = input;
  const now = input.now ?? new Date();

  if (!Number.isInteger(sharesScaled) || sharesScaled <= 0) {
    throw new Error("赎回份额必须为正整数");
  }

  const f = await db.query.fund.findFirst({ where: eq(fund.code, fundCode) });
  if (!f)
    throw new Error(`基金 ${fundCode} 不存在`);

  // 当前持仓
  const h = await db.query.holding.findFirst({
    where: and(eq(holding.userId, userId), eq(holding.fundCode, fundCode)),
  });
  if (!h || h.totalShares <= 0) {
    throw new Error(`没有 ${f.name} 的持仓，无法赎回`);
  }

  // 已挂单未确认的赎回份额也要算占用，否则同一批份额能被重复赎回
  const pendingRows = await db
    .select({
      total: sql<number>`coalesce(sum(${orders.shares}), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.fundCode, fundCode),
        eq(orders.side, "sell"),
        eq(orders.status, "pending"),
      ),
    );
  const pendingShares = Number(pendingRows[0]?.total ?? 0);
  const available = h.totalShares - pendingShares;

  if (sharesScaled > available) {
    throw new Error(
      `份额不足：持有 ${sharesToDisplay(h.totalShares)} 份，`
      + `其中 ${sharesToDisplay(pendingShares)} 份待确认赎回，`
      + `可赎 ${sharesToDisplay(available)} 份`,
    );
  }

  const placeDate = toBeijing(now).format("YYYY-MM-DD");
  const confirmDate = resolveConfirmDate(now);

  const [created] = await db
    .insert(orders)
    .values({
      userId,
      fundCode,
      side: "sell",
      status: "pending",
      source: "manual",
      amount: null,
      shares: sharesScaled,
      placeDate,
      confirmDate,
      createdAt: now.getTime(),
    })
    .returning();

  return { orderId: created.id };
}

// ==================== 撤单 / 改单 ====================

/** 改单入参：买单改金额（分）或赎回单改份额（×10000），二选一 */
export type AmendChange = { amountCents: number } | { sharesScaled: number };

/**
 * 取本人订单（不存在或非本人统一报「订单不存在」，不泄露他人订单的存在性）。
 * 撤单/改单的入口共用的第一步。
 */
async function getOwnOrder(db: Db, userId: number, orderId: number) {
  const o = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
  });
  if (!o)
    throw new Error("订单不存在");
  return o;
}

/**
 * 撤单。只有 pending 可撤（领域层校验）：
 *  - 买单：退回冻结现金 + 追加 type='cancel' 冲正流水（账本只增不改）
 *  - 赎回单：不动钱，份额占用随状态变化自动释放
 *
 * 两段式提交，第一段是「原子裁判」：
 *   1. 带 pending 守卫的状态翻转 + returning——翻转成功即独占该订单的
 *      后续处置权（撮合 cron、重复请求都赢不了这道 UPDATE）
 *   2. 赢了才动钱：退款与冲正流水同 batch 原子提交
 * 撮合侧同款守卫（settle.ts 先翻转再写份额），两侧互斥，
 * 不会出现「已确认还退钱」或「已撤销还记份额」。
 */
export async function cancelOrder(
  db: Db,
  userId: number,
  orderId: number,
  now: Date = new Date(),
): Promise<void> {
  const o = await getOwnOrder(db, userId, orderId);
  const { refundCents } = planCancel(o); // 非 pending 在此被拒

  // 第一段：原子裁判。0 行 = 被撮合抢先确认（或并发重复撤单）
  const flipped = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.userId, userId),
        eq(orders.status, "pending"),
      ),
    )
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    throw new Error("订单已被撮合确认或已撤销，请刷新后查看");
  }

  // 赎回单不动钱：翻转完成即结束，份额占用自动释放
  if (o.side !== "buy" || refundCents === 0)
    return;

  // 第二段：退款 + 冲正流水，同生共死
  const acc = await db.query.account.findFirst({
    where: eq(account.userId, userId),
  });
  const f = await db.query.fund.findFirst({ where: eq(fund.code, o.fundCode) });
  const newCash = (acc?.cash ?? 0) + refundCents;

  await runBatch(db, [
    db
      .update(account)
      .set({ cash: newCash })
      .where(eq(account.userId, userId)),
    db.insert(transactions).values({
      userId,
      type: "cancel",
      amount: refundCents, // 冲正入账为正
      balance: newCash,
      orderId,
      note: `撤单退款：申购 ${f?.name ?? o.fundCode}（${o.fundCode}）`,
      createdAt: now.getTime(),
    }),
  ]);
}

/**
 * 改单（原单直改，保订单号与下单时间）：
 *  - 买单改金额：按差额多补少退现金，追加 type='amend' 差额流水；
 *    新金额同样过起购额与现金校验（改单不豁免下单规则）
 *  - 赎回单改份额：不动钱；可改上限 = 持有 − 其他挂单占用（本单原份额
 *    不占自己的额度——改单是替换，不是追加）
 *
 * 与撤单同款两段式：第一段带乐观锁（amount/shares 必须还是读到的旧值）
 * 的翻转 + returning，赢了才在第二段动钱。被撮合或并发改单抢先时
 * 第一段 0 行，直接报错，资金分文不动。
 */
export async function amendOrder(
  db: Db,
  userId: number,
  orderId: number,
  change: AmendChange,
  now: Date = new Date(),
): Promise<void> {
  const o = await getOwnOrder(db, userId, orderId);

  if ("amountCents" in change) {
    const f = await db.query.fund.findFirst({
      where: eq(fund.code, o.fundCode),
    });
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    const { deltaCents } = planAmendBuy(o, change.amountCents, {
      cashCents: acc?.cash ?? 0,
      minPurchaseCents: f?.minPurchase ?? 0,
    });

    const oldAmount = o.amount!;
    const newAmount = change.amountCents;

    // 第一段：乐观锁翻转（金额必须还是读到的旧值）
    const flipped = await db
      .update(orders)
      .set({ amount: newAmount })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.userId, userId),
          eq(orders.status, "pending"),
          eq(orders.amount, oldAmount),
        ),
      )
      .returning({ id: orders.id });
    if (flipped.length === 0) {
      throw new Error("订单已被撮合确认或已被修改，请刷新后重试");
    }

    // 第二段：差额动钱 + 流水，同生共死。
    // cash - delta：加仓（delta>0）出账、减仓（delta<0）自动变入账
    const newCash = (acc?.cash ?? 0) - deltaCents;
    await runBatch(db, [
      db
        .update(account)
        .set({ cash: newCash })
        .where(eq(account.userId, userId)),
      db.insert(transactions).values({
        userId,
        type: "amend",
        amount: -deltaCents, // 出账为负（加仓负、减仓正）
        balance: newCash,
        orderId,
        note: `改单：申购 ${f?.name ?? o.fundCode}（${o.fundCode}） ${centsToYuan(oldAmount)} 元 → ${centsToYuan(newAmount)} 元`,
        createdAt: now.getTime(),
      }),
    ]);
    return;
  }

  // 改赎回份额：可改上限 = 持有 − 其他挂单赎回占用（排除本单）
  const h = await db.query.holding.findFirst({
    where: and(eq(holding.userId, userId), eq(holding.fundCode, o.fundCode)),
  });
  const pendingRows = await db
    .select({ total: sql<number>`coalesce(sum(${orders.shares}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.fundCode, o.fundCode),
        eq(orders.side, "sell"),
        eq(orders.status, "pending"),
        ne(orders.id, orderId),
      ),
    );
  const otherPendingShares = Number(pendingRows[0]?.total ?? 0);

  const { newSharesScaled } = planAmendSell(o, change.sharesScaled, {
    availableSharesScaled: (h?.totalShares ?? 0) - otherPendingShares,
  });

  // 份额翻转带乐观锁；不动钱，一段完成
  const flipped = await db
    .update(orders)
    .set({ shares: newSharesScaled })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.userId, userId),
        eq(orders.status, "pending"),
        eq(orders.shares, o.shares!),
      ),
    )
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    throw new Error("订单已被撮合确认或已被修改，请刷新后重试");
  }
}
