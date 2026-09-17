import { describe, expect, it } from "vitest";
import {
  countDcaPeriods,
  DCA_BACKTEST_DEFAULT_PERIODS,
  dcaPeriodKey,
  runDcaBacktest,
} from "~/domain/dca-backtest";

/**
 * 定投频率（按天 / 按周 / 按月）与「期」的定义。
 *
 * 口径（改实现前先读，改了要同步这里与页面文案）：
 *  - 按月：每个自然月首个有净值的交易日
 *  - 按周：每个**自然周**（周一~周日）首个有净值的交易日——不是「每 7 天」，
 *    否则跨年那一周会被切成两期（2025-12-29 与 2026-01-02 是同一周）
 *  - 按天：每个有净值的交易日
 *
 * 每个频道的默认期数都是「一年」的量：月 12 / 周 52 / 天 250（交易日）。
 */

/** 造一个净值点：入参是显示值（元），内部换算成 ×10000 */
function p(navDate: string, nav: number) {
  return { navDate, nav: Math.round(nav * 10000) };
}

/** 2026-01 的连续交易日（01-05 是周一，01-12 是下周一，中间隔周末） */
function januaryDays(days: string[]) {
  return days.map(d => p(`2026-01-${d}`, 1));
}

describe("dcaPeriodKey", () => {
  it("按月：同年同月归为一期", () => {
    expect(dcaPeriodKey("2026-03-02", "month")).toBe("2026-03");
    expect(dcaPeriodKey("2026-03-31", "month")).toBe("2026-03");
    expect(dcaPeriodKey("2026-04-01", "month")).toBe("2026-04");
  });

  it("按周：按自然周（周一起算）归期，不是「每 7 天」", () => {
    // 2026-01-05 是周一：它那一周是 01-05 ~ 01-11
    expect(dcaPeriodKey("2026-01-05", "week")).toBe("2026-01-05");
    expect(dcaPeriodKey("2026-01-09", "week")).toBe("2026-01-05");
    expect(dcaPeriodKey("2026-01-11", "week")).toBe("2026-01-05");
    expect(dcaPeriodKey("2026-01-12", "week")).toBe("2026-01-12");
  });

  it("按周：跨年那一周归一（2026-01-02 属于 2025-12-29 起的那一周）", () => {
    // 2026-01-01 是周四 → 2025-12-29 是周一
    expect(dcaPeriodKey("2025-12-29", "week")).toBe("2025-12-29");
    expect(dcaPeriodKey("2026-01-02", "week")).toBe("2025-12-29");
    expect(dcaPeriodKey("2026-01-05", "week")).toBe("2026-01-05");
  });

  it("按天：每个交易日各自一期", () => {
    expect(dcaPeriodKey("2026-01-05", "day")).toBe("2026-01-05");
    expect(dcaPeriodKey("2026-01-06", "day")).toBe("2026-01-06");
  });
});

describe("runDcaBacktest 的频率", () => {
  it("按周：每周首个交易日买一次，跨年那周不重复买", () => {
    const series = [
      p("2025-12-29", 1), // 周一（当周首个交易日）
      p("2025-12-31", 1), // 周三——同一周，不该再买
      p("2026-01-02", 1), // 周五——同一周，不该再买
      p("2026-01-05", 1), // 下周一
      p("2026-01-09", 1), // 周五——同一周
      p("2026-01-12", 1), // 再下周一
      p("2026-01-16", 1.5), // 期末估值
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, frequency: "week" });
    expect(r).not.toBeNull();
    expect(r!.frequency).toBe("week");
    expect(r!.periods).toBe(3);
    expect(r!.schedule.map(s => s.navDate)).toEqual([
      "2025-12-29",
      "2026-01-05",
      "2026-01-12",
    ]);
    expect(r!.investedCents).toBe(300_000);
  });

  it("按天：每个有净值的交易日都买一次", () => {
    const series = [
      p("2026-01-05", 1),
      p("2026-01-06", 1),
      p("2026-01-07", 1),
      p("2026-01-08", 2),
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, frequency: "day" });
    expect(r!.frequency).toBe("day");
    expect(r!.periods).toBe(4);
    expect(r!.schedule.map(s => s.navDate)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ]);
    // 前三期各 1000 份、末一期 500 份（1000 ÷ 2.0）→ 3500 份 × 2.0 = 7000 元
    expect(r!.finalValueCents).toBe(700_000);
    // 投入 4000 元 → +75%
    expect(r!.returnRate).toBe(7500);
  });

  it("不传频率时按月（基金页那张固定卡的口径不能变）", () => {
    const series = [
      p("2026-01-05", 1), // 1 月首个交易日
      p("2026-01-20", 1), // 同月，不再买
      p("2026-02-02", 1),
      p("2026-02-27", 1),
      p("2026-03-02", 1),
      p("2026-03-31", 1),
    ];
    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r!.frequency).toBe("month");
    expect(r!.periods).toBe(3);
    expect(r!.schedule.map(s => s.navDate)).toEqual(["2026-01-05", "2026-02-02", "2026-03-02"]);
  });

  it("默认期数都是「一年」的量：月 12 / 周 52 / 天 250", () => {
    expect(DCA_BACKTEST_DEFAULT_PERIODS).toEqual({ day: 250, week: 52, month: 12 });
  });

  it("默认期数超过可用期数时按可用期数算（库里有多少期就回测多少期）", () => {
    const series = januaryDays(["05", "06", "07", "08"]);
    // 日频默认 250 期，但库里只有 4 个交易日
    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, frequency: "day" });
    expect(r!.periods).toBe(4);
  });

  it("自定义期数照旧生效，只是「期」的含义随频率变", () => {
    const series = [
      ...januaryDays(["05", "06", "07", "08", "09"]),
      p("2026-01-12", 1),
      p("2026-01-13", 1),
      p("2026-01-19", 1),
      p("2026-01-20", 1),
    ];
    // 同样是「最近 3 期」，按天是最近 3 个交易日、按周是最近 3 周
    const day = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, frequency: "day", periods: 3 });
    expect(day!.schedule.map(s => s.navDate)).toEqual(["2026-01-13", "2026-01-19", "2026-01-20"]);

    const week = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, frequency: "week", periods: 3 });
    expect(week!.schedule.map(s => s.navDate)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });
});

describe("countDcaPeriods", () => {
  it("同一份序列在不同频率下的可用期数（页面据此提示上限、领域据此截断）", () => {
    // 2026-01-05 ~ 01-16 的十个交易日：2 个自然周、1 个自然月
    const series = januaryDays(["05", "06", "07", "08", "09", "12", "13", "14", "15", "16"]);
    expect(countDcaPeriods(series, "day")).toBe(10);
    expect(countDcaPeriods(series, "week")).toBe(2);
    expect(countDcaPeriods(series, "month")).toBe(1);
  });

  it("脏净值（0）与乱序都不该影响计数", () => {
    const dirty = [
      { navDate: "2026-01-20", nav: 0 },
      ...januaryDays(["05", "06", "07", "08"]).reverse(),
    ];
    expect(countDcaPeriods(dirty, "day")).toBe(4);
  });

  it("空序列是 0（页面据此走空态，不显示上限 0）", () => {
    expect(countDcaPeriods([], "day")).toBe(0);
    expect(countDcaPeriods([], "month")).toBe(0);
  });
});
