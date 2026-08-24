import { describe, expect, it } from 'vitest';
import {
  calcCheckinReward,
  calcStreak,
  CHECKIN_BASE_CENTS,
  CHECKIN_MAX_CENTS,
  CHECKIN_STEP_CENTS,
} from '~/domain/checkin';

/**
 * 每日签到领本金：基础 100 元，每多连签一天 +50 元，封顶 500 元，断签归零。
 */
describe('checkin 签到连签奖励', () => {
  it('常量符合设计文档：100 / 50 / 500 元', () => {
    expect(CHECKIN_BASE_CENTS).toBe(10000);
    expect(CHECKIN_STEP_CENTS).toBe(5000);
    expect(CHECKIN_MAX_CENTS).toBe(50000);
  });

  describe('calcCheckinReward 奖励金额', () => {
    it('第 1 天：100 元', () => {
      expect(calcCheckinReward(1)).toBe(10000);
    });

    it('第 2 天：150 元（递增 50）', () => {
      expect(calcCheckinReward(2)).toBe(15000);
    });

    it('第 3 天：200 元', () => {
      expect(calcCheckinReward(3)).toBe(20000);
    });

    it('第 9 天：正好触及 500 元封顶', () => {
      // 100 + 8×50 = 500
      expect(calcCheckinReward(9)).toBe(50000);
    });

    it('第 10 天及以后：恒定 500 元封顶', () => {
      expect(calcCheckinReward(10)).toBe(50000);
      expect(calcCheckinReward(100)).toBe(50000);
    });

    it('streak 非正数时按第 1 天处理', () => {
      expect(calcCheckinReward(0)).toBe(10000);
      expect(calcCheckinReward(-5)).toBe(10000);
    });
  });

  describe('calcStreak 连签天数推进', () => {
    it('从未签到过 → 第 1 天', () => {
      expect(calcStreak(null, 0, '2026-08-24')).toBe(1);
    });

    it('昨天签过 → 连签 +1', () => {
      expect(calcStreak('2026-08-23', 5, '2026-08-24')).toBe(6);
      expect(calcStreak('2026-08-23', 1, '2026-08-24')).toBe(2);
    });

    it('断签（隔了一天以上）→ 归零重新从 1 开始', () => {
      expect(calcStreak('2026-08-22', 5, '2026-08-24')).toBe(1);
      expect(calcStreak('2026-01-01', 99, '2026-08-24')).toBe(1);
    });

    it('跨月连签正确', () => {
      expect(calcStreak('2026-08-31', 3, '2026-09-01')).toBe(4);
    });

    it('跨年连签正确', () => {
      expect(calcStreak('2026-12-31', 7, '2027-01-01')).toBe(8);
    });

    it('今天已经签过 → 抛错（防重复签到）', () => {
      expect(() => calcStreak('2026-08-24', 3, '2026-08-24')).toThrow();
    });

    it('最后签到日在未来 → 抛错（数据异常）', () => {
      expect(() => calcStreak('2026-08-25', 3, '2026-08-24')).toThrow();
    });
  });

  describe('连签场景串联', () => {
    it('连签 9 天的奖励序列递增到封顶', () => {
      const rewards: number[] = [];
      let streak = 0;
      let last: string | null = null;
      const dates = [
        '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
        '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09',
      ];
      for (const d of dates) {
        streak = calcStreak(last, streak, d);
        rewards.push(calcCheckinReward(streak));
        last = d;
      }
      expect(rewards).toEqual([
        10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000,
      ]);
    });

    it('断签后奖励掉回 100 元', () => {
      // 连签 5 天后断了，再签只能拿基础奖励
      const streak = calcStreak('2026-08-05', 5, '2026-08-10');
      expect(streak).toBe(1);
      expect(calcCheckinReward(streak)).toBe(10000);
    });
  });
});
