import { desc, eq } from 'drizzle-orm';
import type { Db } from '~/db/client';
import { account, checkin, transactions } from '~/db/schema';
import { calcCheckinReward, calcStreak } from '~/domain/checkin';
import { toBeijing } from '~/domain/trading-calendar';

/**
 * 每日签到领本金。
 *
 * 防重复签到有两道防线：
 *  1. 业务层：查最近一条 checkin，同日则抛错
 *  2. 数据库：checkin 表 (user_id, checkin_date) 唯一约束
 * 双保险是必要的——并发请求可能同时通过第 1 道。
 */

export interface CheckinResult {
  /** 本次奖励（分） */
  reward: number;
  /** 本次连签天数 */
  streak: number;
  /** 签到后余额（分） */
  balance: number;
}

export interface CheckinStatus {
  /** 今天是否已签 */
  checkedToday: boolean;
  /** 当前连签天数 */
  streak: number;
  /** 下次可领金额（分）——已签则为明天的，未签则为今天的 */
  nextReward: number;
  /** 累计签到入金（分） */
  totalCheckin: number;
}

/** 取该用户最近一条签到记录 */
async function lastCheckin(db: Db, userId: number) {
  const rows = await db
    .select()
    .from(checkin)
    .where(eq(checkin.userId, userId))
    .orderBy(desc(checkin.checkinDate))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 执行签到。奖励入账并记流水，三张表在同一 batch 内原子提交。
 */
export async function doCheckin(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<CheckinResult> {
  const today = toBeijing(now).format('YYYY-MM-DD');

  const acc = await db.query.account.findFirst({
    where: eq(account.userId, userId),
  });
  if (!acc) throw new Error('账户不存在');

  const last = await lastCheckin(db, userId);
  // calcStreak 会在同日重复签到时抛错
  const streak = calcStreak(last?.checkinDate ?? null, last?.streak ?? 0, today);
  const reward = calcCheckinReward(streak);
  const newBalance = acc.cash + reward;

  await db.batch([
    db.insert(checkin).values({
      userId,
      checkinDate: today,
      reward,
      streak,
    }),
    db
      .update(account)
      .set({
        cash: newBalance,
        totalCheckin: acc.totalCheckin + reward,
      })
      .where(eq(account.userId, userId)),
    db.insert(transactions).values({
      userId,
      type: 'checkin',
      amount: reward,
      balance: newBalance,
      note: `第 ${streak} 天连续签到奖励`,
      createdAt: now.getTime(),
    }),
  ]);

  return { reward, streak, balance: newBalance };
}

/**
 * 查询签到状态，供仪表盘展示。
 * 不产生副作用，可安全在 loader 里调用。
 */
export async function getCheckinStatus(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<CheckinStatus> {
  const today = toBeijing(now).format('YYYY-MM-DD');

  const acc = await db.query.account.findFirst({
    where: eq(account.userId, userId),
  });
  const last = await lastCheckin(db, userId);

  const checkedToday = last?.checkinDate === today;

  // 已签：展示明天续签能拿多少；未签：展示今天能拿多少
  let streak: number;
  let nextReward: number;
  if (checkedToday) {
    streak = last!.streak;
    nextReward = calcCheckinReward(streak + 1);
  } else {
    streak = last?.streak ?? 0;
    // 用 calcStreak 推算今天签到后的连签数（会正确处理断签归零）
    let todayStreak: number;
    try {
      todayStreak = calcStreak(last?.checkinDate ?? null, last?.streak ?? 0, today);
    } catch {
      // 理论不会到这里（checkedToday 已排除同日），保守取 1
      todayStreak = 1;
    }
    nextReward = calcCheckinReward(todayStreak);
  }

  return {
    checkedToday,
    streak,
    nextReward,
    totalCheckin: acc?.totalCheckin ?? 0,
  };
}
