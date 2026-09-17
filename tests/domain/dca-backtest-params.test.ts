import { describe, expect, it } from "vitest";
import { DCA_BACKTEST_MIN_PERIODS } from "~/domain/dca-backtest";
import {
  DCA_PAGE_AMOUNT_MAX_CENTS,
  DCA_PAGE_AMOUNT_MIN_CENTS,
  DCA_PAGE_DEFAULT_AMOUNT_CENTS,
  DCA_PAGE_DEFAULT_PERIODS,
  DCA_PAGE_FREQUENCY_OPTIONS,
  DCA_PAGE_PERIOD_HARD_MAX,
  parseDcaBacktestQuery,
} from "~/domain/dca-backtest-params";

/**
 * `/tools/dca-backtest` 的 query 口径。
 *
 * 公开页的 URL 是用户（和爬虫）能直接改的输入：非法值一律**回落默认值**
 * 并留下一条提示，既不把页面打成 500，也不静默改口径——用户填了 50 元
 * 却看到按 1000 元算的数字，比报错更糟。
 */

/** URLSearchParams 就满足解析函数要的最小接口（只用到 get） */
function q(params: Record<string, string>) {
  return new URLSearchParams(params);
}

describe("parseDcaBacktestQuery", () => {
  it("没有参数时给默认口径（1000 元 × 按月 12 期 × 累计净值），且无提示", () => {
    expect(parseDcaBacktestQuery(q({}))).toEqual({
      code: "",
      amountCents: DCA_PAGE_DEFAULT_AMOUNT_CENTS,
      frequency: "month",
      periods: DCA_PAGE_DEFAULT_PERIODS.month,
      adjust: "acc",
      notices: [],
    });
  });

  it("合法参数原样解析：金额支持角分，期数可自定义，频率三档都认", () => {
    const r = parseDcaBacktestQuery(
      q({ code: "000001", amount: "2000.50", freq: "week", periods: "7", adjust: "unit" }),
    );
    expect(r.code).toBe("000001");
    expect(r.amountCents).toBe(200_050);
    expect(r.frequency).toBe("week");
    expect(r.periods).toBe(7);
    expect(r.adjust).toBe("unit");
    expect(r.notices).toEqual([]);
  });

  it("金额越界或非数字回落默认值，并留下提示（不静默改口径）", () => {
    const low = parseDcaBacktestQuery(q({ amount: "50" }));
    expect(low.amountCents).toBe(DCA_PAGE_DEFAULT_AMOUNT_CENTS);
    expect(low.notices.join()).toContain("100");

    const high = parseDcaBacktestQuery(q({ amount: "2000000" }));
    expect(high.amountCents).toBe(DCA_PAGE_DEFAULT_AMOUNT_CENTS);
    expect(high.notices.join()).toContain("1000000");

    // "NaN" / "Infinity" 是 decimal.js 会接受、但不抛的一段（CodeRabbit 评审 #1）：
    // 只判 null 挡不住，会带着非有限金额传进 calcPurchase 把公开页打成 500
    for (const bad of ["abc", "", "-1", "1.2.3", "NaN", "Infinity"]) {
      const r = parseDcaBacktestQuery(q({ amount: bad }));
      expect(r.amountCents, bad).toBe(DCA_PAGE_DEFAULT_AMOUNT_CENTS);
      expect(r.notices, bad).toHaveLength(1);
    }
  });

  it("频率只认 month / week / day，其它回落按月并提示", () => {
    expect(parseDcaBacktestQuery(q({ freq: "month" })).frequency).toBe("month");
    expect(parseDcaBacktestQuery(q({ freq: "week" })).frequency).toBe("week");
    expect(parseDcaBacktestQuery(q({ freq: "day" })).frequency).toBe("day");
    for (const bad of ["year", "1", ""]) {
      const r = parseDcaBacktestQuery(q({ freq: bad }));
      expect(r.frequency, bad).toBe("month");
      expect(r.notices, bad).toHaveLength(1);
    }
  });

  it("期数默认值随频率走（一年：月 12 / 周 52 / 天 250）", () => {
    expect(parseDcaBacktestQuery(q({})).periods).toBe(12);
    expect(parseDcaBacktestQuery(q({ freq: "week" })).periods).toBe(52);
    expect(parseDcaBacktestQuery(q({ freq: "day" })).periods).toBe(250);
  });

  it("期数可自定义：3 ~ 硬上限的整数都收（不再只有 3/6/12 三档）", () => {
    expect(parseDcaBacktestQuery(q({ periods: "7" })).periods).toBe(7);
    expect(parseDcaBacktestQuery(q({ periods: "120" })).periods).toBe(120);
    expect(parseDcaBacktestQuery(q({ freq: "week", periods: "999" })).periods).toBe(999);
    expect(parseDcaBacktestQuery(q({ periods: String(DCA_PAGE_PERIOD_HARD_MAX) })).periods)
      .toBe(DCA_PAGE_PERIOD_HARD_MAX);
  });

  it("期数越界或非整数回落**该频率**的默认期数，并提示", () => {
    for (const bad of ["2", "1001", "0", "-5", "abc", "6.5", ""]) {
      const r = parseDcaBacktestQuery(q({ freq: "week", periods: bad }));
      expect(r.periods, bad).toBe(52);
      expect(r.notices, bad).toHaveLength(1);
    }
    // 换成按天时回落的是 250，而不是写死的 12
    const dayBad = parseDcaBacktestQuery(q({ freq: "day", periods: "99999" }));
    expect(dayBad.periods).toBe(250);
    expect(dayBad.notices).toHaveLength(1);
  });

  it("口径只认 acc / unit，其它回落累计净值并提示", () => {
    expect(parseDcaBacktestQuery(q({ adjust: "acc" })).adjust).toBe("acc");
    expect(parseDcaBacktestQuery(q({ adjust: "unit" })).adjust).toBe("unit");
    for (const bad of ["unitnav", "1", ""]) {
      const r = parseDcaBacktestQuery(q({ adjust: bad }));
      expect(r.adjust, bad).toBe("acc");
      expect(r.notices, bad).toHaveLength(1);
    }
  });

  it("基金代码只认 6 位数字，其它当「没选基金」并提示", () => {
    expect(parseDcaBacktestQuery(q({ code: "000001" })).code).toBe("000001");
    for (const bad of ["abc", "00000", "0000001", "00000a"]) {
      const r = parseDcaBacktestQuery(q({ code: bad }));
      expect(r.code, bad).toBe("");
      expect(r.notices, bad).toHaveLength(1);
    }
    // 缺失就是「还没选基金」，不提示——首屏本来就要展示选择列表
    expect(parseDcaBacktestQuery(q({})).notices).toEqual([]);
  });

  it("多个参数同时非法时提示逐条给出（页面按行展示）", () => {
    // periods 用 99999（超过硬上限）——99 现在是合法期数了，不再触发提示
    const r = parseDcaBacktestQuery(
      q({ amount: "abc", freq: "x", periods: "99999", adjust: "x", code: "zzz" }),
    );
    expect(r.notices).toHaveLength(5);
    expect(r.periods).toBe(12);
    expect(r.frequency).toBe("month");
  });

  it("频率档与默认期数对得上（切频率就该给该频率的默认期数）", () => {
    expect(DCA_PAGE_FREQUENCY_OPTIONS.map(o => o.value)).toEqual(["month", "week", "day"]);
    for (const o of DCA_PAGE_FREQUENCY_OPTIONS) {
      expect(DCA_PAGE_DEFAULT_PERIODS[o.value]).toBeGreaterThanOrEqual(DCA_BACKTEST_MIN_PERIODS);
    }
    // 硬上限要大于任何频率的默认值，否则默认值本身就填不进去
    expect(DCA_PAGE_PERIOD_HARD_MAX).toBeGreaterThan(DCA_PAGE_DEFAULT_PERIODS.day);
    expect(DCA_PAGE_PERIOD_HARD_MAX).toBeGreaterThan(DCA_PAGE_DEFAULT_PERIODS.week);
    expect(DCA_PAGE_DEFAULT_PERIODS.week).toBeGreaterThan(DCA_PAGE_DEFAULT_PERIODS.month);
    expect(DCA_PAGE_AMOUNT_MIN_CENTS).toBeLessThan(DCA_PAGE_AMOUNT_MAX_CENTS);
    expect(DCA_PAGE_DEFAULT_AMOUNT_CENTS).toBeGreaterThanOrEqual(DCA_PAGE_AMOUNT_MIN_CENTS);
    expect(DCA_PAGE_DEFAULT_AMOUNT_CENTS).toBeLessThanOrEqual(DCA_PAGE_AMOUNT_MAX_CENTS);
  });
});
