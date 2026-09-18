import type { DailyPnlEntry, PnlDimension } from "~/domain/pnl-buckets";
import { describe, expect, it } from "vitest";
import {
  aggregateFundPnlRange,
  bucketDailyPnl,
  bucketKeyOfDate,
  compoundRate,
  mondayOf,
  pageOfDate,
  pageOfKey,
  shiftPage,
} from "~/domain/pnl-buckets";

/** 造一条逐日条目 */
function entry(date: string, pnlCents: number, rate = 0): DailyPnlEntry {
  return { date, dayPnlCents: pnlCents, dayPnlRate: rate };
}

/**
 * 跨 2026-08 / 2026-09 / 2027-01 三个月的样本（含周末与非交易日），
 * 用于「任意粒度总额不变」的不变量测试。
 */
const SERIES: DailyPnlEntry[] = [
  entry("2026-08-31", 1000, 0.01), // 周一
  entry("2026-09-01", -200, -0.002), // 周二
  entry("2026-09-04", 300, 0.003), // 周五（同周）
  entry("2026-09-07", 0, 0), // 下周一（同月）
  entry("2026-09-14", 500, 0.005), // 再下周（同月）
  entry("2027-01-01", 700, 0.007), // 跨年：周一落在 2026-12-28
];

const DIMENSIONS: PnlDimension[] = ["day", "week", "month", "year"];

describe("mondayOf 自然周", () => {
  it("周二/周六都归到当周周一", () => {
    expect(mondayOf("2026-09-01")).toBe("2026-08-31"); // 周二 → 8/31 周一
    expect(mondayOf("2026-09-05")).toBe("2026-08-31"); // 周六 → 同周
  });

  it("周一本就是自己", () => {
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
  });

  it("跨年的周归周一所属年份（2027-01-01 属 2026-12-28 那一周）", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("bucketKeyOfDate 桶键", () => {
  it("四种粒度的键形状", () => {
    expect(bucketKeyOfDate("2026-09-01", "day")).toBe("2026-09-01");
    expect(bucketKeyOfDate("2026-09-01", "week")).toBe("2026-08-31");
    expect(bucketKeyOfDate("2026-09-01", "month")).toBe("2026-09");
    expect(bucketKeyOfDate("2026-09-01", "year")).toBe("2026");
  });
});

describe("bucketDailyPnl 粒度分桶", () => {
  it("day 粒度透传：一天一桶，金额与收益率原样", () => {
    const buckets = bucketDailyPnl(SERIES, "day");
    expect(buckets).toHaveLength(SERIES.length);
    expect(buckets[1]).toEqual({
      key: "2026-09-01",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      days: 1,
      pnlCents: -200,
      pnlRate: -0.002,
    });
  });

  it("week 粒度：同周合并，键为周一，区间带实际首末日与天数", () => {
    const buckets = bucketDailyPnl(SERIES, "week");
    // 2026-08-31 与 2026-09-01、2026-09-04 同属 8/31 那一周
    const first = buckets[0]!;
    expect(first.key).toBe("2026-08-31");
    expect(first.startDate).toBe("2026-08-31");
    expect(first.endDate).toBe("2026-09-04");
    expect(first.days).toBe(3);
    expect(first.pnlCents).toBe(1000 - 200 + 300); // 1100
    // 连乘口径：1.01 × 0.998 × 1.003 − 1
    expect(first.pnlRate).toBeCloseTo(1.01 * 0.998 * 1.003 - 1, 10);
  });

  it("week 粒度：跨年的周不被拆到两年（整周归周一所在年）", () => {
    const buckets = bucketDailyPnl(SERIES, "week");
    const last = buckets[buckets.length - 1]!;
    expect(last.key).toBe("2026-12-28");
    expect(pageOfKey(last.key, "week")).toBe("2026");
  });

  it("month 粒度：同月合并，键为 YYYY-MM", () => {
    const buckets = bucketDailyPnl(SERIES, "month");
    expect(buckets.map(b => b.key)).toEqual(["2026-08", "2026-09", "2027-01"]);
    const sep = buckets[1]!;
    expect(sep.days).toBe(4); // 09-01 / 09-04 / 09-07 / 09-14
    expect(sep.pnlCents).toBe(-200 + 300 + 0 + 500);
    expect(sep.startDate).toBe("2026-09-01");
    expect(sep.endDate).toBe("2026-09-14");
  });

  it("year 粒度：同一年合并", () => {
    const buckets = bucketDailyPnl(SERIES, "year");
    expect(buckets.map(b => b.key)).toEqual(["2026", "2027"]);
    expect(buckets[0]!.days).toBe(5);
    expect(buckets[0]!.pnlCents).toBe(1000 - 200 + 300 + 0 + 500);
    expect(buckets[1]!.pnlCents).toBe(700);
  });

  it("不变量：任意粒度下 Σ桶金额 === Σ逐日金额", () => {
    const total = SERIES.reduce((s, e) => s + e.dayPnlCents, 0);
    for (const dim of DIMENSIONS) {
      const sum = bucketDailyPnl(SERIES, dim).reduce((s, b) => s + b.pnlCents, 0);
      expect(sum, `粒度 ${dim}`).toBe(total);
    }
  });

  it("不变量：任意粒度下 Σ桶天数 === 逐日条目数", () => {
    for (const dim of DIMENSIONS) {
      const days = bucketDailyPnl(SERIES, dim).reduce((s, b) => s + b.days, 0);
      expect(days, `粒度 ${dim}`).toBe(SERIES.length);
    }
  });

  it("空输入返回空数组", () => {
    for (const dim of DIMENSIONS) {
      expect(bucketDailyPnl([], dim)).toEqual([]);
    }
  });
});

describe("compoundRate 复利连乘", () => {
  it("单日即原值（日粒度与改造前逐位一致）", () => {
    expect(compoundRate([0.0123])).toBe(0.0123);
  });

  it("多日连乘而非相加", () => {
    expect(compoundRate([0.01, 0.02])).toBeCloseTo(0.0302, 10);
    // 算术相加是 0.03，连乘是 0.0302 —— 必须取连乘
    expect(compoundRate([0.01, 0.02])).not.toBeCloseTo(0.03, 10);
  });

  it("空数组为 0", () => {
    expect(compoundRate([])).toBe(0);
  });
});

describe("pageOfDate / shiftPage 页导航", () => {
  it("粒度决定页范围：日→月，周/月→年，年→单页", () => {
    expect(pageOfDate("2026-09-01", "day")).toBe("2026-09");
    expect(pageOfDate("2026-09-01", "week")).toBe("2026");
    expect(pageOfDate("2026-09-01", "month")).toBe("2026");
    expect(pageOfDate("2026-09-01", "year")).toBe("all");
  });

  it("跨年周的页按其周一所在年（与分桶键口径一致）", () => {
    expect(pageOfDate("2027-01-01", "week")).toBe("2026");
  });

  it("翻页：日按月、周/月按年、年无页可翻", () => {
    expect(shiftPage("2026-09", "day", 1)).toBe("2026-10");
    expect(shiftPage("2026-01", "day", -1)).toBe("2025-12");
    expect(shiftPage("2026", "month", -1)).toBe("2025");
    expect(shiftPage("2026", "week", 1)).toBe("2027");
    expect(shiftPage("all", "year", 1)).toBe("all");
  });
});

describe("aggregateFundPnlRange 区间归因汇总", () => {
  const byDate = {
    "2026-09-01": [
      { fundCode: "A", dayPnlCents: 100, dayNavRate: 0.01 },
      { fundCode: "B", dayPnlCents: -50, dayNavRate: -0.005 },
    ],
    "2026-09-02": [
      { fundCode: "A", dayPnlCents: 200, dayNavRate: 0.02 },
      { fundCode: "C", dayPnlCents: 30, dayNavRate: 0.001 },
    ],
    "2026-09-08": [{ fundCode: "A", dayPnlCents: 999, dayNavRate: 0.05 }],
  };

  it("单日区间 = 当日原样（日粒度零回归）", () => {
    expect(aggregateFundPnlRange(byDate, "2026-09-01", "2026-09-01")).toEqual(byDate["2026-09-01"]);
  });

  it("多日区间：金额求和、涨跌幅连乘、区间外的日期不参与", () => {
    const r = aggregateFundPnlRange(byDate, "2026-09-01", "2026-09-02");
    const a = r.find(e => e.fundCode === "A")!;
    expect(a.dayPnlCents).toBe(300);
    expect(a.dayNavRate).toBeCloseTo(1.01 * 1.02 - 1, 10);
    expect(r.find(e => e.fundCode === "B")!.dayPnlCents).toBe(-50);
    expect(r.find(e => e.fundCode === "C")!.dayPnlCents).toBe(30);
    expect(r).toHaveLength(3); // 09-08 的 999 不在区间内
  });

  it("无数据的区间返回空数组", () => {
    expect(aggregateFundPnlRange(byDate, "2026-10-01", "2026-10-31")).toEqual([]);
  });
});
