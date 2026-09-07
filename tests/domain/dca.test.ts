import { describe, expect, it } from "vitest";
import { nextRunDate } from "~/domain/dca";

/**
 * 定投到期计算。返回的日期必须「严格晚于」from 且**是交易日**，
 * 否则 Cron 扫描时会把同一期重复触发、或在休市日生成订单。
 *
 * 参考日期（已核实）：
 *   2026-08-24 周一，2026-08-26 周三，2026-08-31 下周一
 *   2026-08-29 周六，2026-08-30 周日
 *   2026-09-25 中秋节休市（周五），2026-10-01 国庆休市
 */
describe("dca 定投到期计算", () => {
  describe("daily 每日", () => {
    it("返回次日（交易日）", () => {
      expect(nextRunDate({ frequency: "daily", from: "2026-08-24" })).toBe(
        "2026-08-25",
      );
    });

    it("跨月正确", () => {
      expect(nextRunDate({ frequency: "daily", from: "2026-08-31" })).toBe(
        "2026-09-01",
      );
    });

    it("跨年跳过元旦休市（2027-01-01 → 顺延到 01-04 周一）", () => {
      // 旧预期 2027-01-01 是元旦休市日，定投不该在休市日执行
      expect(nextRunDate({ frequency: "daily", from: "2026-12-31" })).toBe(
        "2027-01-04",
      );
    });

    it("周五的下一期是下周一（跳过周末）", () => {
      // 2026-08-28 周五 → 跳过 8/29 周六、8/30 周日 → 8/31 周一
      expect(nextRunDate({ frequency: "daily", from: "2026-08-28" })).toBe(
        "2026-08-31",
      );
    });

    it("节假日前跳到节后首个交易日", () => {
      // 2026-09-24 周四是交易日；次日 9/25 中秋休市 → 跳到 9/28 周一
      // （中秋是 9/25 周五，无需调休，9/26-27 是正常周末）
      expect(nextRunDate({ frequency: "daily", from: "2026-09-24" })).toBe(
        "2026-09-28",
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

    it("周日用 7 表示（撞休市日则顺延）", () => {
      // 2026-08-24 周一 → 本周日 8/30 是休市日 → 顺延到 8/31 周一执行
      expect(
        nextRunDate({ frequency: "weekly", dayOfWeek: 7, from: "2026-08-24" }),
      ).toBe("2026-08-31");
    });

    it("目标日撞上节假日时顺延到下一交易日", () => {
      // weekly 目标 10-01（周四，国庆休市）→ 顺延到 10-09（国庆长假后首个周五交易日）
      expect(
        nextRunDate({ frequency: "weekly", dayOfWeek: 4, from: "2026-09-30" }),
      ).toBe("2026-10-09");
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

    it("28 号撞 2 月末周末时顺延到 3 月首个交易日", () => {
      // 2026-02-28 恰是周六 → 顺延到 3/2 周一（3/1 是周日）。
      // 旧预期「2 月内安全」在新语义下不再成立：休市日必须跳过
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 28, from: "2026-01-30" }),
      ).toBe("2026-03-02");
    });

    it("目标日撞上国庆长假时顺延到节后", () => {
      // monthly 目标 10-01（国庆休市首日）→ 顺延到 10-09
      expect(
        nextRunDate({ frequency: "monthly", dayOfMonth: 1, from: "2026-09-15" }),
      ).toBe("2026-10-09");
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
