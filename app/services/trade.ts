import type { Db } from "~/db/client";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { account, fund, holding, orders, transactions } from "~/db/schema";
import { centsToYuan, sharesToDisplay } from "~/domain/money";
import { planAmendBuy, planAmendSell, planCancel } from "~/domain/order-lifecycle";
import { resolveConfirmDate, toBeijing } from "~/domain/trading-calendar";
import { cashDelta, hasBuyFreezeSql } from "./cash";

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

  // 现金必须够——这里是给用户看的友好预检；真正的不透支由下方守卫
  // UPDATE 在语句内原子保证（读到这里够、写时被并发扣光也扣不动）
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

  // 冻结现金：相对量更新（cash = cash − Δ，单语句内完成读改写，并发下
  // 不存在丢失更新）+ 双守卫（不透支 / 订单仍 pending）+ returning 判赢。
  // 2026-10-14 事故：本处原实现「读 cash → JS 减 → 无条件写回绝对值」，
  // 定投扫描被重复派发时两笔并发扣款互相覆盖，丢了一笔 2 万元的冻结。
  // 0 行 = 现金不足（并发扣减后）或订单被并发撤销，分文未动。
  const frozen = await db
    .update(account)
    .set({ cash: cashDelta(-amountCents) })
    .where(
      and(
        eq(account.userId, userId),
        gte(account.cash, amountCents),
        sql`EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${created.id} AND ${orders.status} = 'pending')`,
      ),
    )
    .returning({ cash: account.cash });

  if (frozen.length === 0) {
    // 守卫保证资金分文未动，删掉刚插的孤儿订单收尾。
    // 只删仍 pending 的：若已被并发撤单翻转成 cancelled 则不命中，
    // 留给撤单路径处置——其退款带冻结守卫，资金不会凭空多出。
    await db
      .delete(orders)
      .where(and(eq(orders.id, created.id), eq(orders.status, "pending")));
    throw new Error(
      `现金不足：可用 ${centsToYuan(acc.cash)} 元，需要 ${centsToYuan(amountCents)} 元`,
    );
  }

  // 冻结流水。balance 用冻结语句返回的瞬时值：这两步间若有并发入账，
  // 快照代表冻结那一刻的余额，流水链按 id（提交序）读仍单调自洽
  await db.insert(transactions).values({
    userId,
    type: "buy",
    amount: -amountCents, // 出账为负
    balance: frozen[0]!.cash,
    orderId: created.id,
    note: `申购 ${f.name}（${fundCode}），待 ${confirmDate} 确认`,
    createdAt: now.getTime(),
  });

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

  const f = await db.query.fund.findFirst({ where: eq(fund.code, o.fundCode) });

  // 第二段：退款。相对量更新（cash = cash + Δ）+ 冻结流水存在守卫 +
  // returning 判赢——退款必须对应一笔真实冻结，防历史脏数据把退款
  // 凭空入账（并发场景：冻结被守卫落空的同时撤单抢先翻转）。
  // 0 行 = 分文未动，流水也绝不插（因此不与流水同批）。
  const refunded = await db
    .update(account)
    .set({ cash: cashDelta(refundCents) })
    .where(
      and(
        eq(account.userId, userId),
        hasBuyFreezeSql(orderId),
      ),
    )
    .returning({ cash: account.cash });

  if (refunded.length === 0) {
    // 理论不可达：订单创建时必冻结，能走到这里说明账本有脏数据。
    // 订单已翻转 cancelled，但资金分文未动——大声报警留人工核查
    console.error(`[cancel] 订单 ${orderId} 退款中止：未找到冻结流水（资金未动，需人工核查）`);
    throw new Error("退款异常：未找到原始冻结记录，资金未动，请联系管理员");
  }

  await db.insert(transactions).values({
    userId,
    type: "cancel",
    amount: refundCents, // 冲正入账为正
    balance: refunded[0]!.cash,
    orderId,
    note: `撤单退款：申购 ${f?.name ?? o.fundCode}（${o.fundCode}）`,
    createdAt: now.getTime(),
  });
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
    // 差额即 planAmendBuy 返回的 deltaCents：正 = 加仓要补钱，负 = 减仓可退款

    // 第一段：先动钱（相对量 + 现金充足守卫 + 订单守卫 + returning 判赢）。
    // 顺序刻意为「先钱后单」：先动钱的失败 = 零副作用直接报错；若沿用旧的
    // 「先翻转金额再动钱」，动钱一旦失败就要回滚订单金额，回滚再失败还得
    // 资金冲正，三态处理得不偿失。
    // 2026-10-14 事故同款风险点：原实现按 JS 预计算的绝对值无条件写回，
    // 并发下会覆盖别的资金变动（或被覆盖）。
    let adjustedCash: number | null = null;
    if (deltaCents !== 0) {
      const adjusted = await db
        .update(account)
        .set({ cash: cashDelta(-deltaCents) })
        .where(
          and(
            eq(account.userId, userId),
            // 加仓补钱不透支；减仓退款无透支风险，不加守卫
            ...(deltaCents > 0 ? [gte(account.cash, deltaCents)] : []),
            sql`EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderId} AND ${orders.status} = 'pending' AND ${orders.amount} = ${oldAmount})`,
          ),
        )
        .returning({ cash: account.cash });
      if (adjusted.length === 0) {
        throw new Error("现金不足或订单已被修改/撮合，请刷新后重试");
      }
      adjustedCash = adjusted[0]!.cash;
    }

    // 第二段：翻转订单金额（乐观锁，与原实现同款守卫）
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
      // 订单被撮合/并发改单抢先：立即原路冲正资金（入账恒成功），
      // 保持资金与订单一致后再报错，绝不留下「钱动了单没改」的态
      if (deltaCents !== 0) {
        const reverted = await db
          .update(account)
          .set({ cash: cashDelta(deltaCents) })
          .where(eq(account.userId, userId))
          .returning({ cash: account.cash });
        await db.insert(transactions).values({
          userId,
          type: "amend",
          amount: deltaCents, // 原路退回：加仓退回补款、减仓收回退款
          balance: reverted[0]!.cash,
          orderId,
          note: `改单冲突冲正：订单 ${orderId} 竞态失败，差额原路退回`,
          createdAt: now.getTime(),
        });
      }
      throw new Error("订单已被撮合确认或已被修改，请刷新后重试");
    }

    // 第三段：差额流水。balance 用动钱语句返回的瞬时值
    if (deltaCents !== 0 && adjustedCash !== null) {
      await db.insert(transactions).values({
        userId,
        type: "amend",
        amount: -deltaCents, // 出账为负（加仓负、减仓正）
        balance: adjustedCash,
        orderId,
        note: `改单：申购 ${f?.name ?? o.fundCode}（${o.fundCode}） ${centsToYuan(oldAmount)} 元 → ${centsToYuan(newAmount)} 元`,
        createdAt: now.getTime(),
      });
    }
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
