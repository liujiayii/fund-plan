import { describe, expect, it } from "vitest";
import { calcPeriodReturns } from "~/domain/performance";

/** 造一条净值序列（升序），unitNav 传真实净值如 1.2345 的 ×10000=12345 */
function s(...rows: [string, number][]) {
  return rows.map(([navDate, unitNav]) => ({ navDate, unitNav }));
}

describe("calcPeriodReturns", () => {
  it("空序列或单点：全部 null", () => {
    expect(calcPeriodReturns([])).toEqual({
      w1: null,
      m1: null,
      m3: null,
      m6: null,
      y1: null,
      ytd: null,
      all: null,
    });
    expect(calcPeriodReturns(s(["2026-08-25", 12345])).all).toBeNull();
  });

  it("成立来 = (末值 − 首值)/首值，万分之整数", () => {
    const r = calcPeriodReturns(s(["2026-01-01", 10000], ["2026-08-25", 12345]));
    // (12345-10000)/10000 ×10000 = 2345
    expect(r.all).toBe(2345);
  });

  it("近1月：目标日落在非交易日（周末）时前向填充到最近的交易日", () => {
    // 末值 2026-08-25（周二），近1月目标 = 2026-07-25（周六，无净值）
    // 库里 7-24（周五）有净值 12000，7-27（周一）有净值 12100
    // 前向填充取 navDate ≤ 2026-07-25 的最后一条 = 7-24
    const r = calcPeriodReturns(
      s(["2026-07-24", 12000], ["2026-07-27", 12100], ["2026-08-25", 12345]),
    );
    // (12345-12000)/12000 ×10000 = 287.5 → HALF_UP → 288
    expect(r.m1).toBe(288);
  });

  it("数据不足的周期返回 null（近1年需要跨年数据）", () => {
    // 只有 3 个月数据，近1年目标日早于首条 → null
    const r = calcPeriodReturns(
      s(["2026-06-01", 10000], ["2026-08-25", 12345]),
    );
    expect(r.y1).toBeNull();
    expect(r.m3).toBeNull(); // 近3月目标 2026-05-25 也早于首条 6-01
    expect(r.m1).not.toBeNull(); // 近1月目标 7-25，但首条是 6-01 → 前向填充取 6-01
  });

  it("YTD 跨年：取上一年最后一个交易日的净值作起点", () => {
    // 末值 2026-08-26，YTD 目标 = 2025-12-31（上一年最后一日）
    // 库里 2025-12-30 有净值 11000（≤ 12-31 的最后一条）
    const r = calcPeriodReturns(
      s(
        ["2025-12-30", 11000],
        ["2026-02-01", 11500],
        ["2026-08-26", 13200],
      ),
    );
    // (13200-11000)/11000 ×10000 = 2000
    expect(r.ytd).toBe(2000);
  });

  it("YTD 当年才成立的基金（无上年数据）返回 null", () => {
    const r = calcPeriodReturns(
      s(["2026-02-01", 10000], ["2026-08-26", 12000]),
    );
    expect(r.ytd).toBeNull();
  });

  it("首尾净值相等的区间返回 0（真实 0%，不是 null）", () => {
    const r = calcPeriodReturns(
      s(["2026-07-25", 12345], ["2026-08-25", 12345]),
    );
    expect(r.m1).toBe(0);
  });
});
