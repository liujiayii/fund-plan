import { describe, expect, it } from "vitest";
import { nextRunDate } from "~/domain/dca";

/**
 * 定投到期计算。返回的日期必须「严格晚于」from，
 * 否则 Cron 扫描时会把同一期重复触发。
 *
 * 参考日期（已核实）：
 *   2026-08-24 周一，2026-08-26 周三，2026-08-31 下周一
 */
describe("dca 定投到期计算", () => {
  describe("daily 每日", () => {
    it("返回次日", () => {
      expect(nextRunDate({ frequency: "daily", from: "2026-08-24" })).toBe(
        "2026-08-25",
      );
    });

    it("跨月正确", () => {
      expect(nextRunDate({ frequency: "daily", from: "2026-08-31" })).toBe(
        "2026-09-01",
      );
    });

    it("跨年正确", () => {
      expect(nextRunDate({ frequency: "daily", from: "2026-12-31" })).toBe(
        "2027-01-01",
      );
    });
  });

  describe("weekly 每周", () => {
    it("从周一算下个周三（本周内）", () => {
      expect(
        nextRunDate({ frequency: "weekly", dayOfWeek: 3, from: "2026-08-24" }),
      ).toBe("2026-08-26");
    });

    it("目标是当天时顺延到下周（严格晚于 from）", () => {
      expect(
        nextRunDate({ frequency: "weekly", dayOfWeek: 1, from: "2026-08-24" }),
      ).toBe("2026-08-31");
    });

    it("目标已过则跳到下周", () => {
      // 周三(26号)之后要周一(dayOfWeek=1) → 下周一 8/31
      expect(
        nextRunDate({ frequency: "weekly", dayOfWeek: 1, from: "2026-08-26" }),
      ).toBe("2026-08-31");
    });

    it("周日用 7 表示", () => {
      // 2026-08-24 周一 → 本周日是 8/30
      expect(
        nextRunDate({ frequency: "weekly", dayOfWeek: 7, from: "2026-08-24" }),
      ).toBe("2026-08-30");
    });
  });

  describe("monthly 每月", () => {
    it("目标日在本月未到 → 本月执行", () => {
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 28, from: "2026-08-24" }),
      ).toBe("2026-08-28");
    });

    it("目标日已过 → 下月执行", () => {
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 15, from: "2026-08-24" }),
      ).toBe("2026-09-15");
    });

    it("目标日正是当天 → 顺延到下月（严格晚于 from）", () => {
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 24, from: "2026-08-24" }),
      ).toBe("2026-09-24");
    });

    it("跨年：12 月之后是次年 1 月", () => {
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 5, from: "2026-12-20" }),
      ).toBe("2027-01-05");
    });

    it("28 号在 2 月也安全（不会溢出到 3 月）", () => {
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 28, from: "2026-01-30" }),
      ).toBe("2026-02-28");
    });
  });

  describe("参数校验", () => {
    it("weekly 缺 dayOfWeek 时抛错", () => {
      expect(() =>
        nextRunDate({ frequency: "weekly", from: "2026-08-24" }),
      ).toThrow();
    });

    it("monthly 缺 dayOfMonth 时抛错", () => {
      expect(() =>
        nextRunDate({ frequency: "monthly", from: "2026-08-24" }),
      ).toThrow();
    });

    it("dayOfMonth 超出 1-28 时抛错（规避 2 月问题）", () => {
      expect(() =>
        nextRunDate({ frequency: "monthly", dayOfMonth: 31, from: "2026-08-24" }),
      ).toThrow();
      expect(() =>
        nextRunDate({ frequency: "monthly", dayOfMonth: 0, from: "2026-08-24" }),
      ).toThrow();
    });

    it("dayOfWeek 超出 1-7 时抛错", () => {
      expect(() =>
        nextRunDate({ frequency: "weekly", dayOfWeek: 8, from: "2026-08-24" }),
      ).toThrow();
    });
  });
});
