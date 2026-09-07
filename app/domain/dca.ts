import dayjs from "dayjs";
import { isTradingDay, nextTradingDay } from "./trading-calendar";

/** 定投频率 */
export type Frequency = "daily" | "weekly" | "monthly";

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
 * 把候选执行日校准到交易日：非交易日（周末/节假日）顺延到下一交易日。
 * 三个频率共用——定投在休市日执行没有意义，订单只会堆积到开市日确认。
 */
function adjustToTradingDay(date: string): string {
  return isTradingDay(date) ? date : nextTradingDay(date);
}

/**
 * 计算下次定投执行日，返回值**严格晚于** from 且**是交易日**。
 *
 * 「严格晚于」很关键：定投扫描任务把 next_run <= 今天 的计划触发后，
 * 会用本函数推进 next_run。若返回值可能等于 from，同一期会被反复触发。
 *
 * 「是交易日」同样关键（2026-09-07 修复）：此前纯日历推进，daily 定投
 * 周末/节假日照常下单，订单堆积到开市日集中确认、成本口径错乱。
 */
export function nextRunDate(input: NextRunInput): string {
  const { frequency, dayOfWeek, dayOfMonth, from } = input;
  const base = dayjs(from);

  if (!base.isValid()) {
    throw new Error(`基准日期非法：${from}`);
  }

  switch (frequency) {
    case "daily":
      // 次日若非交易日（周末/节假日）顺延到下一交易日
      return adjustToTradingDay(base.add(1, "day").format("YYYY-MM-DD"));

    case "weekly": {
      if (dayOfWeek == null) {
        throw new Error("weekly 定投必须指定 dayOfWeek（1=周一 … 7=周日）");
      }
      if (dayOfWeek < 1 || dayOfWeek > 7) {
        throw new Error(`dayOfWeek 必须在 1-7 之间，收到 ${dayOfWeek}`);
      }
      // dayjs 的 day() 是 0=周日，这里把 7（周日）映射回 0
      const targetDow = dayOfWeek === 7 ? 0 : dayOfWeek;
      let cursor = base.add(1, "day");
      // 最多找 7 天必然命中；命中后仍要过交易日滤网（如目标日撞国庆）
      for (let i = 0; i < 7; i++) {
        if (cursor.day() === targetDow)
          return adjustToTradingDay(cursor.format("YYYY-MM-DD"));
        cursor = cursor.add(1, "day");
      }
      throw new Error("未能计算下次周定投日期");
    }

    case "monthly": {
      if (dayOfMonth == null) {
        throw new Error("monthly 定投必须指定 dayOfMonth（1-28）");
      }
      if (dayOfMonth < 1 || dayOfMonth > 28) {
        throw new Error(
          `dayOfMonth 必须在 1-28 之间（规避 2 月问题），收到 ${dayOfMonth}`,
        );
      }
      // 先试本月的目标日；若不晚于 from 则取下月；命中后过交易日滤网
      const thisMonth = base.date(dayOfMonth);
      const candidate = thisMonth.isAfter(base, "day")
        ? thisMonth
        : base.add(1, "month").date(dayOfMonth);
      return adjustToTradingDay(candidate.format("YYYY-MM-DD"));
    }

    default: {
      const never: never = frequency;
      throw new Error(`不支持的定投频率：${never}`);
    }
  }
}
