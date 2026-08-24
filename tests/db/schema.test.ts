import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '~/db/client';
import { checkin, fund, fundNav, user } from '~/db/schema';

/**
 * schema 冒烟测试：用真实 D1 验证 10 张表建得对、
 * 精度字段能原样存取、关键唯一约束真的生效。
 */
describe('D1 schema', () => {
  it('fund 表能写入并原样读回（含 JSON 阶梯费率）', async () => {
    const db = getDb(env.DB);
    const tiers = [
      { minDays: 0, maxDays: 7, rate: 150 },
      { minDays: 7, maxDays: 365, rate: 50 },
      { minDays: 365, maxDays: null, rate: 0 },
    ];

    await db.insert(fund).values({
      code: '000001',
      name: '华夏成长混合',
      type: '混合型',
      purchaseRate: 15, // 0.15% → 万分之 15
      redeemTiers: tiers,
      minPurchase: 1000, // 10 元起购
      riskLevel: 4,
      status: '开放申购',
      updatedAt: 1_756_000_000_000,
    });

    const row = await db.query.fund.findFirst({
      where: eq(fund.code, '000001'),
    });

    expect(row).toBeDefined();
    expect(row!.name).toBe('华夏成长混合');
    expect(row!.purchaseRate).toBe(15);
    expect(row!.minPurchase).toBe(1000);
    // JSON 列往返后应完全一致
    expect(row!.redeemTiers).toEqual(tiers);
  });

  it('fund_nav 复合主键可存多日净值，整数精度不丢', async () => {
    const db = getDb(env.DB);
    await db.insert(fundNav).values([
      {
        fundCode: '000001',
        navDate: '2026-08-21',
        unitNav: 12345, // 1.2345
        accNav: 45678, // 4.5678
        growthRate: 53, // +0.53%
      },
      {
        fundCode: '000001',
        navDate: '2026-08-24',
        unitNav: 12400,
        accNav: 45733,
        growthRate: 45,
      },
    ]);

    const rows = await db
      .select()
      .from(fundNav)
      .where(eq(fundNav.fundCode, '000001'));

    expect(rows).toHaveLength(2);
    const d21 = rows.find((r) => r.navDate === '2026-08-21')!;
    expect(d21.unitNav).toBe(12345);
    expect(d21.growthRate).toBe(53);
  });

  it('user.username 唯一约束生效', async () => {
    const db = getDb(env.DB);
    await db.insert(user).values({
      username: 'alice',
      passwordHash: 'hash',
      salt: 'salt',
      role: 'user',
      createdAt: Date.now(),
    });

    // 同名再插一次应当被唯一约束拒绝
    await expect(
      db.insert(user).values({
        username: 'alice',
        passwordHash: 'hash2',
        salt: 'salt2',
        role: 'user',
        createdAt: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it('checkin 的 (user_id, checkin_date) 唯一约束能挡住同日重复签到', async () => {
    const db = getDb(env.DB);
    const [u] = await db
      .insert(user)
      .values({
        username: 'bob',
        passwordHash: 'h',
        salt: 's',
        role: 'user',
        createdAt: Date.now(),
      })
      .returning();

    await db.insert(checkin).values({
      userId: u.id,
      checkinDate: '2026-08-24',
      reward: 10000,
      streak: 1,
    });

    // 同一天再签一次 → 唯一约束报错，这是防重复签到的最后一道防线
    await expect(
      db.insert(checkin).values({
        userId: u.id,
        checkinDate: '2026-08-24',
        reward: 15000,
        streak: 2,
      }),
    ).rejects.toThrow();
  });
});
