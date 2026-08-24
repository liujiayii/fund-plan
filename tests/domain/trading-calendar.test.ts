import { describe, expect, it } from 'vitest';
import {
  CN_HOLIDAYS,
  countDays,
  isTradingDay,
  nextTradingDay,
  resolveConfirmDate,
  toBeijing,
} from '~/domain/trading-calendar';

/**
 * 交易日历与 T+1 确认日。这是撮合正确性的时间基准：
 * 算错一天，所有持有天数、阶梯费率、定投节奏全盘皆错。
 *
 * 关键事实（用于校验测试自身）：
 *   2026-08-24 是周一，2026-08-22 周六，2026-08-23 周日，2026-08-21 周五
 */
describe('trading-calendar 交易日历', () => {
  describe('isTradingDay 交易日判定', () => {
    it('工作日是交易日', () => {
      expect(isTradingDay('2026-08-24')).toBe(true); // 周一
      expect(isTradingDay('2026-08-21')).toBe(true); // 周五
    });

    it('周末不是交易日', () => {
      expect(isTradingDay('2026-08-22')).toBe(false); // 周六
      expect(isTradingDay('2026-08-23')).toBe(false); // 周日
    });

    it('法定节假日不是交易日', () => {
      expect(isTradingDay('2026-01-01')).toBe(false); // 元旦
    });

    it('节假日表非空（每年需人工更新）', () => {
      expect(CN_HOLIDAYS.size).toBeGreaterThan(0);
    });

    it('传入 knownTradingDays 时以其为准（沪深300 净值日反向校正）', () => {
      // 假设某个周六因调休开市，只要净值序列里有这天，就认它是交易日
      const known = new Set(['2026-08-22']);
      expect(isTradingDay('2026-08-22', known)).toBe(true);
      // 反之，known 里没有的工作日仍按常规规则判定
      expect(isTradingDay('2026-08-24', known)).toBe(true);
    });
  });

  describe('nextTradingDay 下一交易日', () => {
    it('周五的下一交易日是下周一（跳过周末）', () => {
      expect(nextTradingDay('2026-08-21')).toBe('2026-08-24');
    });

    it('周一的下一交易日是周二', () => {
      expect(nextTradingDay('2026-08-24')).toBe('2026-08-25');
    });

    it('周六的下一交易日是下周一', () => {
      expect(nextTradingDay('2026-08-22')).toBe('2026-08-24');
    });

    it('严格返回「之后」的日期，不返回当天', () => {
      expect(nextTradingDay('2026-08-24')).not.toBe('2026-08-24');
    });
  });

  describe('resolveConfirmDate T+1 确认日', () => {
    it('交易日 15:00 前下单 → 用当日净值', () => {
      // 2026-08-24 周一 北京 14:00 = UTC 06:00
      const placed = new Date('2026-08-24T06:00:00Z');
      expect(resolveConfirmDate(placed)).toBe('2026-08-24');
    });

    it('交易日 15:00 后下单 → 顺延到下一交易日', () => {
      // 2026-08-24 周一 北京 15:30 = UTC 07:30
      const placed = new Date('2026-08-24T07:30:00Z');
      expect(resolveConfirmDate(placed)).toBe('2026-08-25');
    });

    it('恰好 15:00 整算「之后」，顺延', () => {
      // 北京 15:00:00 = UTC 07:00:00
      const placed = new Date('2026-08-24T07:00:00Z');
      expect(resolveConfirmDate(placed)).toBe('2026-08-25');
    });

    it('周五 15:00 后下单 → 顺延到下周一', () => {
      // 2026-08-21 周五 北京 16:00 = UTC 08:00
      const placed = new Date('2026-08-21T08:00:00Z');
      expect(resolveConfirmDate(placed)).toBe('2026-08-24');
    });

    it('周末下单 → 顺延到下周一', () => {
      // 2026-08-22 周六 北京 10:00 = UTC 02:00
      const placed = new Date('2026-08-22T02:00:00Z');
      expect(resolveConfirmDate(placed)).toBe('2026-08-24');
    });

    it('跨日边界：北京时间比 UTC 早 8 小时，UTC 前一天晚间可能是北京次日', () => {
      // UTC 2026-08-23 17:00 = 北京 2026-08-24 01:00（周一凌晨，15:00 前）
      const placed = new Date('2026-08-23T17:00:00Z');
      expect(resolveConfirmDate(placed)).toBe('2026-08-24');
    });
  });

  describe('countDays 自然日差（持有天数）', () => {
    it('相隔天数正确', () => {
      expect(countDays('2026-01-01', '2026-01-08')).toBe(7);
      expect(countDays('2026-08-23', '2026-08-24')).toBe(1);
    });

    it('同一天为 0 天', () => {
      expect(countDays('2026-08-24', '2026-08-24')).toBe(0);
    });

    it('跨月跨年正确', () => {
      expect(countDays('2026-08-01', '2026-08-20')).toBe(19);
      // 2026 不是闰年，1/5 → 8/20 共 227 天
      expect(countDays('2026-01-05', '2026-08-20')).toBe(227);
      expect(countDays('2025-12-31', '2026-01-01')).toBe(1);
    });
  });

  describe('toBeijing UTC 转北京时间', () => {
    it('UTC 加 8 小时', () => {
      const b = toBeijing(new Date('2026-08-24T06:00:00Z'));
      expect(b.format('YYYY-MM-DD HH:mm')).toBe('2026-08-24 14:00');
    });
  });
});
