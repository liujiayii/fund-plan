import {
  CHECKIN_BASE_CENTS,
  CHECKIN_MAX_CENTS,
  CHECKIN_STEP_CENTS,
} from "./config";
import { countDays } from "./trading-calendar";

export { CHECKIN_BASE_CENTS, CHECKIN_MAX_CENTS, CHECKIN_STEP_CENTS };

/**
 * 根据连签天数计算本次签到奖励（分）。
 *
 * 规则：基础 100 元，每多连签一天 +50 元，封顶 500 元。
 * 连签第 9 天正好触及封顶（100 + 8×50 = 500），之后恒定 500。
 *
 * @param streak 本次是第几天连签（1 起）
 */
export function calcCheckinReward(streak: number): number {
  // 容错：非正数按第 1 天处理
  const n = streak >= 1 ? streak : 1;
  const reward = CHECKIN_BASE_CENTS + (n - 1) * CHECKIN_STEP_CENTS;
  return Math.min(reward, CHECKIN_MAX_CENTS);
}

/**
 * 推进连签天数。
 *
 * @param lastCheckinDate 上次签到日 YYYY-MM-DD，从未签到传 null
 * @param lastStreak 上次签到时的连签天数
 * @param today 今天 YYYY-MM-DD（北京时间）
 * @returns 本次签到后的连签天数
 *
 * 规则：昨天签过 → 连签 +1；间隔超过一天 → 断签归零重新从 1 开始。
 * 同日重复签到属于调用方逻辑错误（DB 唯一约束也会挡），这里直接抛错。
 */
export function calcStreak(
  lastCheckinDate: string | null,
  lastStreak: number,
  today: string,
): number {
  // 从未签到过：这是第 1 天
  if (lastCheckinDate === null)
    return 1;

  const gap = countDays(lastCheckinDate, today);

  if (gap === 0) {
    throw new Error(`今日（${today}）已签到过，不能重复签到`);
  }
  if (gap < 0) {
    throw new Error(
      `数据异常：最后签到日 ${lastCheckinDate} 晚于今天 ${today}`,
    );
  }
  // 恰好隔一天 → 连签延续
  if (gap === 1)
    return lastStreak + 1;
  // 断签 → 归零重来
  return 1;
}
