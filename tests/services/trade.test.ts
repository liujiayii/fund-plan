import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '~/db/client';
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
} from '~/db/schema';
import { DEFAULT_REDEEM_TIERS } from '~/domain/redeem';
import { registerUser } from '~/services/auth';
import { placeBuyOrder, placeSellOrder } from '~/services/trade';

/**
 * 下单服务。核心约束：
 *  - 买入立即扣现金（冻结），避免同一笔钱重复下单
 *  - 赎回不动现金，只在确认时入账
 *  - 校验不过必须拒单，且不留脏数据
 */

/** 清空所有表 */
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

/** 建一只测试基金 */
async function seedFund(code = '000001', minPurchase = 1000) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: '测试成长混合',
    type: '混合型',
    purchaseRate: 150, // 1.5%
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase, // 默认 10 元起购
    riskLevel: 4,
    status: '开放申购',
    updatedAt: Date.now(),
  });
}

/** 注册一个用户并返回 id */
async function seedUser(name = 'alice') {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, 'hunter2');
  return r.id;
}

beforeEach(resetAll);

describe('placeBuyOrder 申购下单', () => {
  it('成功下单：生成 pending 单、立即扣现金、记流水', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 2026-08-24 周一 北京 14:00（15:00 前）→ 确认日应为当日
    const now = new Date('2026-08-24T06:00:00Z');
    const r = await placeBuyOrder(db, env, {
      userId,
      fundCode: '000001',
      amountCents: 100000, // 1000 元
      now,
    });

    expect(r.orderId).toBeGreaterThan(0);

    const o = await db.query.orders.findFirst({
      where: eq(orders.id, r.orderId),
    });
    expect(o!.status).toBe('pending');
    expect(o!.side).toBe('buy');
    expect(o!.amount).toBe(100000);
    expect(o!.confirmDate).toBe('2026-08-24');
    expect(o!.placeDate).toBe('2026-08-24');
    expect(o!.source).toBe('manual');
    // 未确认前不应有成交信息
    expect(o!.dealNav).toBeNull();
    expect(o!.dealShares).toBeNull();

    // 现金应立即扣减（冻结）
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 100000);

    // 应有一条 buy 流水
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.type, 'buy'));
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(-100000); // 出账为负
    expect(txs[0].balance).toBe(10_000_000 - 100000);
    expect(txs[0].orderId).toBe(r.orderId);
  });

  it('15:00 后下单，确认日顺延到下一交易日', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 2026-08-24 周一 北京 15:30
    const now = new Date('2026-08-24T07:30:00Z');
    const r = await placeBuyOrder(db, env, {
      userId,
      fundCode: '000001',
      amountCents: 100000,
      now,
    });

    const o = await db.query.orders.findFirst({
      where: eq(orders.id, r.orderId),
    });
    expect(o!.placeDate).toBe('2026-08-24');
    expect(o!.confirmDate).toBe('2026-08-25');
  });

  it('周五 15:00 后下单，确认日跳到下周一', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    // 2026-08-21 周五 北京 16:00
    const now = new Date('2026-08-21T08:00:00Z');
    const r = await placeBuyOrder(db, env, {
      userId,
      fundCode: '000001',
      amountCents: 100000,
      now,
    });

    const o = await db.query.orders.findFirst({
      where: eq(orders.id, r.orderId),
    });
    expect(o!.confirmDate).toBe('2026-08-24');
  });

  it('现金不足时拒单，且不留任何脏数据', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await expect(
      placeBuyOrder(db, env, {
        userId,
        fundCode: '000001',
        amountCents: 20_000_000, // 20 万，超过 10 万本金
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow(/现金不足|余额不足/);

    // 不应有订单、现金不变
    const all = await db.select().from(orders);
    expect(all).toHaveLength(0);
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);
  });

  it('低于起购金额时拒单', async () => {
    const db = getDb(env.DB);
    await seedFund('000001', 10000); // 起购 100 元
    const userId = await seedUser();

    await expect(
      placeBuyOrder(db, env, {
        userId,
        fundCode: '000001',
        amountCents: 5000, // 只买 50 元
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow(/起购/);
  });

  it('基金不存在时拒单', async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    await expect(
      placeBuyOrder(db, env, {
        userId,
        fundCode: '999999',
        amountCents: 100000,
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow(/基金/);
  });

  it('金额非正数时拒单', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await expect(
      placeBuyOrder(db, env, {
        userId,
        fundCode: '000001',
        amountCents: 0,
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow();
  });

  it('source 可标记为 dca（定投触发）', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const r = await placeBuyOrder(db, env, {
      userId,
      fundCode: '000001',
      amountCents: 100000,
      source: 'dca',
      now: new Date('2026-08-24T06:00:00Z'),
    });

    const o = await db.query.orders.findFirst({
      where: eq(orders.id, r.orderId),
    });
    expect(o!.source).toBe('dca');
  });

  it('连续两次下单现金累计扣减', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const now = new Date('2026-08-24T06:00:00Z');

    await placeBuyOrder(db, env, {
      userId,
      fundCode: '000001',
      amountCents: 100000,
      now,
    });
    await placeBuyOrder(db, env, {
      userId,
      fundCode: '000001',
      amountCents: 200000,
      now,
    });

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000 - 300000);
  });
});

describe('placeSellOrder 赎回下单', () => {
  /** 给用户造一笔持仓 */
  async function seedHolding(userId: number, sharesScaled = 10_000_000) {
    const db = getDb(env.DB);
    await db.batch([
      db.insert(holding).values({
        userId,
        fundCode: '000001',
        totalShares: sharesScaled,
        totalCost: 150000,
      }),
      db.insert(shareLot).values({
        userId,
        fundCode: '000001',
        shares: sharesScaled,
        cost: 150000,
        confirmDate: '2026-01-05',
      }),
    ]);
  }

  it('成功下单：生成 pending 赎回单，不动现金', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId);

    const r = await placeSellOrder(db, env, {
      userId,
      fundCode: '000001',
      sharesScaled: 5_000_000, // 赎 500 份
      now: new Date('2026-08-24T06:00:00Z'),
    });

    const o = await db.query.orders.findFirst({
      where: eq(orders.id, r.orderId),
    });
    expect(o!.status).toBe('pending');
    expect(o!.side).toBe('sell');
    expect(o!.shares).toBe(5_000_000);
    expect(o!.amount).toBeNull(); // 赎回单没有申购金额
    expect(o!.confirmDate).toBe('2026-08-24');

    // 赎回不预先入账，现金不变
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_000_000);
  });

  it('赎回份额超过持仓时拒单', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId, 5_000_000); // 只有 500 份

    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: '000001',
        sharesScaled: 10_000_000, // 想赎 1000 份
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow(/份额不足|持仓/);
  });

  it('没有持仓时拒单', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: '000001',
        sharesScaled: 1_000_000,
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow(/持仓|份额不足/);
  });

  it('已挂单待确认的赎回份额会被计入占用，防止重复赎回同一批份额', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId, 10_000_000); // 1000 份

    // 先赎 800 份
    await placeSellOrder(db, env, {
      userId,
      fundCode: '000001',
      sharesScaled: 8_000_000,
      now: new Date('2026-08-24T06:00:00Z'),
    });

    // 再想赎 500 份 —— 加起来 1300 份超过持仓，应被拒
    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: '000001',
        sharesScaled: 5_000_000,
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow(/份额不足|待确认/);
  });

  it('份额非正数时拒单', async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await seedHolding(userId);

    await expect(
      placeSellOrder(db, env, {
        userId,
        fundCode: '000001',
        sharesScaled: 0,
        now: new Date('2026-08-24T06:00:00Z'),
      }),
    ).rejects.toThrow();
  });
});
