import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { TRADE_CUTOFF_HOUR } from './config';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 北京时间相对 UTC 的偏移（小时） */
const BEIJING_OFFSET_HOURS = 8;

/**
 * 中国大陆 A 股/基金休市的法定节假日表（YYYY-MM-DD）。
 *
 * ⚠️ 需要每年人工更新一次：国务院节假日安排通常在前一年 11-12 月公布。
 * 兜底机制：撮合时会把 `fund_nav` 里沪深 300 的净值日期序列作为
 * knownTradingDays 传入——有净值的那天必然是交易日，可反向校正本表的遗漏。
 *
 * 下表为 2026 年安排（含调休导致的连续休市）。
 */
export const CN_HOLIDAYS = new Set<string>([
  // 元旦
  '2026-01-01',
  '2026-01-02',
  // 春节（2026 春节为 2 月 17 日）
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-23',
  // 清明
  '2026-04-06',
  // 劳动节
  '2026-05-01',
  '2026-05-04',
  '2026-05-05',
  // 端午
  '2026-06-19',
  // 中秋
  '2026-09-25',
  // 国庆
  '2026-10-01',
  '2026-10-02',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  // 2027 元旦（跨年顺延用）
  '2027-01-01',
]);

/** 把 UTC 时间转成北京时间的 dayjs 对象 */
export function toBeijing(utcDate: Date): dayjs.Dayjs {
  return dayjs(utcDate).utc().add(BEIJING_OFFSET_HOURS, 'hour');
}

/**
 * 判断某日是否为交易日。
 *
 * @param date YYYY-MM-DD
 * @param knownTradingDays 已知交易日集合（来自净值序列）。命中时直接判定为交易日，
 *   用于校正节假日表遗漏或调休开市的情况。
 */
export function isTradingDay(date: string, knownTradingDays?: Set<string>): boolean {
  // 有净值记录 → 铁证是交易日，优先级最高
  if (knownTradingDays?.has(date)) return true;

  const d = dayjs(date);
  const weekday = d.day(); // 0=周日, 6=周六
  if (weekday === 0 || weekday === 6) return false;
  if (CN_HOLIDAYS.has(date)) return false;
  return true;
}

/**
 * 返回严格晚于 date 的下一个交易日。
 * 最多向后找 30 天，避免节假日表异常导致死循环。
 */
export function nextTradingDay(date: string, knownTradingDays?: Set<string>): string {
  let cursor = dayjs(date).add(1, 'day');
  for (let i = 0; i < 30; i++) {
    const s = cursor.format('YYYY-MM-DD');
    if (isTradingDay(s, knownTradingDays)) return s;
    cursor = cursor.add(1, 'day');
  }
  // 理论不可达；真发生说明节假日表被写坏了
  throw new Error(`未能在 30 天内找到 ${date} 之后的交易日，请检查节假日表`);
}

/**
 * 计算订单的确认日（即成交所用净值的日期），落实真实 T+1 规则：
 *   - 交易日 15:00（北京）前下单 → 用当日净值
 *   - 交易日 15:00 及以后 / 周末 / 节假日下单 → 用下一交易日净值
 *
 * @param placedAtUtc 下单时刻（UTC）
 */
export function resolveConfirmDate(
  placedAtUtc: Date,
  knownTradingDays?: Set<string>,
): string {
  const bj = toBeijing(placedAtUtc);
  const today = bj.format('YYYY-MM-DD');

  // 当天是交易日且还没到 15:00 → 吃当日净值
  if (isTradingDay(today, knownTradingDays) && bj.hour() < TRADE_CUTOFF_HOUR) {
    return today;
  }
  // 其余情况（已过 15:00、或当天休市）→ 顺延到下一个交易日
  return nextTradingDay(today, knownTradingDays);
}

/**
 * 两个日期间的自然日差（用于算持有天数，决定赎回费率档位）。
 * 注意：阶梯费率按「自然日」而非交易日计算，符合真实基金规则。
 */
export function countDays(from: string, to: string): number {
  return dayjs(to).diff(dayjs(from), 'day');
}
