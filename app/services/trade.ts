import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '~/db/client';
import { account, fund, holding, orders, transactions } from '~/db/schema';
import { centsToYuan, sharesToDisplay } from '~/domain/money';
import { resolveConfirmDate, toBeijing } from '~/domain/trading-calendar';

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
  source?: 'manual' | 'dca';
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
  const { userId, fundCode, amountCents, source = 'manual' } = input;
  const now = input.now ?? new Date();

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('申购金额必须为正整数（分）');
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
  if (!acc) throw new Error('账户不存在');
  if (acc.cash < amountCents) {
    throw new Error(
      `现金不足：可用 ${centsToYuan(acc.cash)} 元，需要 ${centsToYuan(amountCents)} 元`,
    );
  }

  const placeDate = toBeijing(now).format('YYYY-MM-DD');
  const confirmDate = resolveConfirmDate(now);
  const newCash = acc.cash - amountCents;

  // 先插订单拿 id，流水要引用它
  const [created] = await db
    .insert(orders)
    .values({
      userId,
      fundCode,
      side: 'buy',
      status: 'pending',
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
      type: 'buy',
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
    throw new Error('赎回份额必须为正整数');
  }

  const f = await db.query.fund.findFirst({ where: eq(fund.code, fundCode) });
  if (!f) throw new Error(`基金 ${fundCode} 不存在`);

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
        eq(orders.side, 'sell'),
        eq(orders.status, 'pending'),
      ),
    );
  const pendingShares = Number(pendingRows[0]?.total ?? 0);
  const available = h.totalShares - pendingShares;

  if (sharesScaled > available) {
    throw new Error(
      `份额不足：持有 ${sharesToDisplay(h.totalShares)} 份，` +
        `其中 ${sharesToDisplay(pendingShares)} 份待确认赎回，` +
        `可赎 ${sharesToDisplay(available)} 份`,
    );
  }

  const placeDate = toBeijing(now).format('YYYY-MM-DD');
  const confirmDate = resolveConfirmDate(now);

  const [created] = await db
    .insert(orders)
    .values({
      userId,
      fundCode,
      side: 'sell',
      status: 'pending',
      source: 'manual',
      amount: null,
      shares: sharesScaled,
      placeDate,
      confirmDate,
      createdAt: now.getTime(),
    })
    .returning();

  return { orderId: created.id };
}
