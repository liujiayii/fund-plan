import { and, eq, lte } from 'drizzle-orm';
import type { Db } from '~/db/client';
import { dcaPlan, fund } from '~/db/schema';
import { nextRunDate, type Frequency } from '~/domain/dca';
import { toBeijing } from '~/domain/trading-calendar';
import { assertOwnership } from './guard';
import { placeBuyOrder } from './trade';

/**
 * 定投计划管理与扫描。
 *
 * 扫描由 Cron 每日北京 10:00 触发：找出所有 next_run <= 今天 且 active 的计划，
 * 逐个下申购单，然后把 next_run 推进到下一期。
 *
 * 关键：单个计划失败（比如现金不够）不能阻塞其他计划——
 * 每个计划独立 try/catch，失败只计数并推进日期，避免第二天重复失败堆积。
 */

export interface ScanResult {
  /** 成功触发的计划数 */
  triggered: number;
  /** 未到期而跳过的计划数 */
  skipped: number;
  /** 触发失败的计划数（如现金不足） */
  failed: number;
}

export interface CreateDcaInput {
  userId: number;
  fundCode: string;
  /** 每期金额（分） */
  amountCents: number;
  frequency: Frequency;
  /** 周几（weekly 用，1-7） */
  dayOfWeek?: number | null;
  /** 每月几号（monthly 用，1-28） */
  dayOfMonth?: number | null;
  /** 创建时刻，默认现在 */
  now?: Date;
}

/** 创建定投计划。next_run 由领域函数算出，保证严格晚于今天 */
export async function createDcaPlan(
  db: Db,
  input: CreateDcaInput,
): Promise<{ id: number }> {
  const { userId, fundCode, amountCents, frequency, dayOfWeek, dayOfMonth } = input;
  const now = input.now ?? new Date();

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('每期金额必须为正整数（分）');
  }

  const f = await db.query.fund.findFirst({ where: eq(fund.code, fundCode) });
  if (!f) throw new Error(`基金 ${fundCode} 不存在，请先在基金页查看一次`);
  if (amountCents < f.minPurchase) {
    throw new Error(`每期金额低于该基金起购金额`);
  }

  const today = toBeijing(now).format('YYYY-MM-DD');
  // nextRunDate 会校验 dayOfWeek / dayOfMonth 的合法性
  const nextRun = nextRunDate({
    frequency,
    dayOfWeek: dayOfWeek ?? null,
    dayOfMonth: dayOfMonth ?? null,
    from: today,
  });

  const [created] = await db
    .insert(dcaPlan)
    .values({
      userId,
      fundCode,
      amount: amountCents,
      frequency,
      dayOfWeek: dayOfWeek ?? null,
      dayOfMonth: dayOfMonth ?? null,
      status: 'active',
      nextRun,
      runCount: 0,
      totalInvested: 0,
      createdAt: now.getTime(),
    })
    .returning();

  return { id: created.id };
}

/** 暂停 / 启用计划。只能操作自己的计划 */
export async function toggleDcaPlan(
  db: Db,
  userId: number,
  planId: number,
  status: 'active' | 'paused',
): Promise<void> {
  const plan = await db.query.dcaPlan.findFirst({
    where: eq(dcaPlan.id, planId),
  });
  if (!plan) throw new Error('定投计划不存在');
  assertOwnership(userId, plan.userId);

  await db.update(dcaPlan).set({ status }).where(eq(dcaPlan.id, planId));
}

/** 删除计划。只能删自己的 */
export async function deleteDcaPlan(
  db: Db,
  userId: number,
  planId: number,
): Promise<void> {
  const plan = await db.query.dcaPlan.findFirst({
    where: eq(dcaPlan.id, planId),
  });
  if (!plan) throw new Error('定投计划不存在');
  assertOwnership(userId, plan.userId);

  await db.delete(dcaPlan).where(eq(dcaPlan.id, planId));
}

/**
 * 扫描并触发到期的定投计划。由 Cron 每日调用。
 *
 * 幂等性来自 next_run 的推进：计划触发后 next_run 变成未来日期，
 * 同日重复扫描不会再命中。
 */
export async function scanDcaPlans(
  db: Db,
  env: Env,
  now: Date = new Date(),
): Promise<ScanResult> {
  const today = toBeijing(now).format('YYYY-MM-DD');

  const due = await db
    .select()
    .from(dcaPlan)
    .where(and(eq(dcaPlan.status, 'active'), lte(dcaPlan.nextRun, today)));

  const result: ScanResult = { triggered: 0, skipped: 0, failed: 0 };

  for (const plan of due) {
    // 计算下一期日期。以 today 为基准而非 plan.nextRun，
    // 避免服务长时间停机后一次性补投很多期。
    const next = nextRunDate({
      frequency: plan.frequency,
      dayOfWeek: plan.dayOfWeek,
      dayOfMonth: plan.dayOfMonth,
      from: today,
    });

    try {
      await placeBuyOrder(db, env, {
        userId: plan.userId,
        fundCode: plan.fundCode,
        amountCents: plan.amount,
        source: 'dca',
        now,
      });

      await db
        .update(dcaPlan)
        .set({
          nextRun: next,
          runCount: plan.runCount + 1,
          totalInvested: plan.totalInvested + plan.amount,
        })
        .where(eq(dcaPlan.id, plan.id));

      result.triggered++;
    } catch (err) {
      console.error(`[dca] 计划 ${plan.id} 触发失败：`, err);
      // 失败也要推进日期，否则明天会连着今天的一起失败，日志刷屏
      await db
        .update(dcaPlan)
        .set({ nextRun: next })
        .where(eq(dcaPlan.id, plan.id));
      result.failed++;
    }
  }

  return result;
}
