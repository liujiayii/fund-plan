import dayjs from 'dayjs';

/** 定投频率 */
export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface NextRunInput {
  frequency: Frequency;
  /** 周几（weekly 用）：1=周一 … 7=周日 */
  dayOfWeek?: number | null;
  /** 每月几号（monthly 用）：限 1-28，规避 2 月只有 28 天的问题 */
  dayOfMonth?: number | null;
  /** 基准日 YYYY-MM-DD */
  from: string;
}

/**
 * 计算下次定投执行日，返回值**严格晚于** from。
 *
 * 「严格晚于」很关键：定投扫描任务把 next_run <= 今天 的计划触发后，
 * 会用本函数推进 next_run。若返回值可能等于 from，同一期会被反复触发。
 */
export function nextRunDate(input: NextRunInput): string {
  const { frequency, dayOfWeek, dayOfMonth, from } = input;
  const base = dayjs(from);

  if (!base.isValid()) {
    throw new Error(`基准日期非法：${from}`);
  }

  switch (frequency) {
    case 'daily':
      return base.add(1, 'day').format('YYYY-MM-DD');

    case 'weekly': {
      if (dayOfWeek == null) {
        throw new Error('weekly 定投必须指定 dayOfWeek（1=周一 … 7=周日）');
      }
      if (dayOfWeek < 1 || dayOfWeek > 7) {
        throw new Error(`dayOfWeek 必须在 1-7 之间，收到 ${dayOfWeek}`);
      }
      // dayjs 的 day() 是 0=周日，这里把 7（周日）映射回 0
      const targetDow = dayOfWeek === 7 ? 0 : dayOfWeek;
      let cursor = base.add(1, 'day');
      // 最多找 7 天必然命中
      for (let i = 0; i < 7; i++) {
        if (cursor.day() === targetDow) return cursor.format('YYYY-MM-DD');
        cursor = cursor.add(1, 'day');
      }
      throw new Error('未能计算下次周定投日期');
    }

    case 'monthly': {
      if (dayOfMonth == null) {
        throw new Error('monthly 定投必须指定 dayOfMonth（1-28）');
      }
      if (dayOfMonth < 1 || dayOfMonth > 28) {
        throw new Error(
          `dayOfMonth 必须在 1-28 之间（规避 2 月问题），收到 ${dayOfMonth}`,
        );
      }
      // 先试本月的目标日；若不晚于 from 则取下月
      const thisMonth = base.date(dayOfMonth);
      if (thisMonth.isAfter(base, 'day')) {
        return thisMonth.format('YYYY-MM-DD');
      }
      return base.add(1, 'month').date(dayOfMonth).format('YYYY-MM-DD');
    }

    default: {
      const never: never = frequency;
      throw new Error(`不支持的定投频率：${never}`);
    }
  }
}
