import { describe, expect, it } from "vitest";
import {
  DCA_BACKTEST_AMOUNT_CENTS,
  DCA_BACKTEST_DEFAULT_PERIODS,
  DCA_BACKTEST_MIN_PERIODS,
  dcaCurvePoints,
  runDcaBacktest,
  toBacktestSeries,
} from "~/domain/dca-backtest";

/**
 * 定投回测的钉子。这块是要给搜索引擎看的「本站独有内容」，
 * 数字必须能被手算复现——所以用例里的净值都挑整数，
 * 期望值全部人肉算过，不是从实现里抄回来的。
 *
 * 口径（改实现前先读，改了要同步这里）：
 *  - 每月首个**有净值的交易日**买一次（1 号逢休市自然顺延，不依赖节假日表）
 *  - 申购费走内扣法（复用撮合的 calcPurchase）：净额 = 金额 ÷ (1 + 费率)。
 *    写成 × (1 − 费率) 是外扣法，费用会多算——这里是唯一的口径出处，别再抄错
 *  - 用复权净值（累计净值）计价，等价于「分红再投」
 *  - 最大回撤取「已投份额市值」序列的峰谷，未投出的现金不算
 */

/** 造一个净值点：入参是显示值（元），内部换算成 ×10000 */
function p(navDate: string, nav: number) {
  return { navDate, nav: Math.round(nav * 10000) };
}

describe("runDcaBacktest", () => {
  it("每月首个交易日买入一次，市值、收益率、回撤、平均成本全部对得上", () => {
    // 净值 1.0 → 2.0 → 1.0 → 0.5 → 1.0 → 1.5，每期 1000 元、费率 0
    const series = [
      p("2026-01-02", 1),
      p("2026-01-15", 2),
      p("2026-02-02", 1),
      p("2026-02-15", 0.5),
      p("2026-03-02", 1),
      p("2026-03-31", 1.5),
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    // 三期各买 1000 份（1000 / 1.0）
    expect(r!.periods).toBe(3);
    expect(r!.investedCents).toBe(300_000);
    expect(r!.from).toBe("2026-01-02");
    expect(r!.to).toBe("2026-03-31");
    // 3000 份 × 1.5 = 4500 元
    expect(r!.finalValueCents).toBe(450_000);
    // (4500 - 3000) / 3000 = +50%
    expect(r!.returnRate).toBe(5000);
    // 峰值 2000（1 月 15 日）→ 谷底 1000（2 月 15 日）→ 回撤 50%
    expect(r!.maxDrawdown).toBe(5000);
    // 3000 元 / 3000 份 = 1.0000
    expect(r!.avgCostNav).toBe(10000);
    // 同期一次性买入：1.0 → 1.5 = +50%
    expect(r!.lumpSumRate).toBe(5000);
  });

  it("申购费按内扣法扣掉，投入记毛额", () => {
    // 费率 1.5%（150 万分之）→ 内扣法：净额 = 1000 ÷ (1+1.5%) = 985.22 元
    // ⚠️ 不是 1000 × (1−1.5%) = 985 元——那是外扣法，与站内真实撮合
    // （app/domain/purchase.ts 的 calcPurchase）对不上，费用会多算
    const series = [
      p("2026-01-02", 1),
      p("2026-02-02", 1.1),
      p("2026-03-02", 1.2),
      p("2026-03-31", 1.3),
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 150 });
    expect(r).not.toBeNull();
    expect(r!.periods).toBe(3);
    // 毛投入仍是 3 × 1000 元，费用体现在份额上
    expect(r!.investedCents).toBe(300_000);
    // 份额：985.22/1 + 985.22/1.1(895.6545) + 985.22/1.2(821.0167) = 2701.8912 份
    // 期末市值 2701.8912 × 1.3 = 3512.4586 元 → 351246 分
    expect(r!.finalValueCents).toBe(351_246);
    // (3512.4586 - 3000) / 3000 = +17.08%
    expect(r!.returnRate).toBe(1708);
    // 对照组是「同期一次性买入同一笔钱」，所以也必须扣同样的申购费：
    // 3000 元按 1.5% 内扣 → 净 2955.67 元 → 份额 2955.67 → ×1.3 = 3842.37 元
    // (3842.37 - 3000) / 3000 = +28.08%（不扣费会虚报成 +30%）
    expect(r!.lumpSumRate).toBe(2808);
  });

  it("超过 12 个月只取最近 12 期", () => {
    // 14 个自然月，每月 1 号一个点，净值恒为 1.0
    const series = Array.from({ length: 14 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return p(`2026-${month}-02`, 1);
    });

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    expect(r!.periods).toBe(DCA_BACKTEST_DEFAULT_PERIODS.month);
    // 起点从第 3 个月开始（14 - 12 + 1）
    expect(r!.from).toBe("2026-03-02");
    expect(r!.investedCents).toBe(DCA_BACKTEST_DEFAULT_PERIODS.month * 100_000);
  });

  it("periods 指定期数时取最近 N 期（页面用它做「最近 3/6/12 期」切换）", () => {
    const series = Array.from({ length: 14 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return p(`2026-${month}-02`, 1);
    });

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, periods: 6 });
    expect(r).not.toBeNull();
    expect(r!.periods).toBe(6);
    // 14 个月里取最近 6 期 → 从第 9 个月开始
    expect(r!.from).toBe("2026-09-02");
    expect(r!.investedCents).toBe(600_000);
  });

  it("periods 低于下限或非整数返回 null，不产出一两期的假回测", () => {
    const series = Array.from({ length: 4 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return p(`2026-${month}-02`, 1);
    });
    const input = { amountCents: 100_000, purchaseRate: 0 };
    expect(runDcaBacktest(series, { ...input, periods: 2 })).toBeNull();
    // 非整数同样拒——别让「6.5 期」静默变成 6 期（页面上还显示着 6.5）
    expect(runDcaBacktest(series, { ...input, periods: 3.5 })).toBeNull();
  });

  it("periods 超过可用月数时按可用月数算，不假装有更长的历史", () => {
    const series = [
      p("2026-01-02", 1),
      p("2026-02-02", 1),
      p("2026-03-02", 1),
      p("2026-04-02", 1),
    ];
    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, periods: 12 });
    expect(r!.periods).toBe(4);
  });

  it("期数不足下限返回 null（页面据此不渲染该卡）", () => {
    const series = [p("2026-01-02", 1), p("2026-02-02", 1.1)];
    expect(DCA_BACKTEST_MIN_PERIODS).toBeGreaterThan(series.length);
    expect(runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 })).toBeNull();
  });

  it("空序列或单点返回 null", () => {
    expect(runDcaBacktest([], { amountCents: 100_000, purchaseRate: 0 })).toBeNull();
    expect(runDcaBacktest([p("2026-01-02", 1)], { amountCents: 100_000, purchaseRate: 0 })).toBeNull();
  });

  it("非法净值（0 或负）整点丢弃，不参与买入与估值", () => {
    const series = [
      p("2026-01-02", 1),
      { navDate: "2026-01-10", nav: 0 },
      p("2026-02-02", 1),
      { navDate: "2026-02-10", nav: -5 },
      p("2026-03-02", 1),
      p("2026-03-31", 1.2),
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    expect(r!.periods).toBe(3);
    expect(r!.investedCents).toBe(300_000);
    // 3000 份 × 1.2 = 3600 元
    expect(r!.finalValueCents).toBe(360_000);
  });

  it("某月没有任何净值点就跳过该月，不拿邻月顶替", () => {
    // 2 月整月缺失（长假 / 数据缺口）
    const series = [
      p("2026-01-02", 1),
      p("2026-03-02", 1),
      p("2026-04-02", 1),
      p("2026-04-30", 1),
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    expect(r!.periods).toBe(3);
    expect(r!.investedCents).toBe(300_000);
  });

  it("入参非法（费率为负 / 金额为 0）返回 null，不把整页抛成 500", () => {
    const series = [
      p("2026-01-02", 1),
      p("2026-02-02", 1),
      p("2026-03-02", 1),
      p("2026-03-31", 1),
    ];
    expect(runDcaBacktest(series, { amountCents: 100_000, purchaseRate: -1 })).toBeNull();
    expect(runDcaBacktest(series, { amountCents: 0, purchaseRate: 150 })).toBeNull();
  });

  it("默认每期金额是 1000 元（页面文案与之一致）", () => {
    expect(DCA_BACKTEST_AMOUNT_CENTS).toBe(100_000);
  });
});

describe("toBacktestSeries", () => {
  it("取复权净值（累计净值）做回测口径", () => {
    const rows = [
      { navDate: "2026-01-02", unitNav: 10000, accNav: 15000 },
      { navDate: "2026-01-03", unitNav: 10100, accNav: 15100 },
    ];
    expect(toBacktestSeries(rows)).toEqual([
      { navDate: "2026-01-02", nav: 15000 },
      { navDate: "2026-01-03", nav: 15100 },
    ]);
  });

  it("累计净值缺失（0）时回落单位净值", () => {
    const rows = [{ navDate: "2026-01-02", unitNav: 12345, accNav: 0 }];
    expect(toBacktestSeries(rows)).toEqual([{ navDate: "2026-01-02", nav: 12345 }]);
  });

  it("口径可选：unit 用单位净值（不把分红当收益），acc 是默认", () => {
    // 单位净值 1.0、累计净值 1.5 的一行：那 0.5 元是分红，acc 口径把它当「再投」
    const rows = [{ navDate: "2026-01-02", unitNav: 10000, accNav: 15000 }];
    expect(toBacktestSeries(rows, "unit")).toEqual([{ navDate: "2026-01-02", nav: 10000 }]);
    expect(toBacktestSeries(rows, "acc")).toEqual([{ navDate: "2026-01-02", nav: 15000 }]);
    expect(toBacktestSeries(rows)).toEqual([{ navDate: "2026-01-02", nav: 15000 }]);
    // unit 口径下单位净值本身缺失（脏数据）时该点没有可用净值，
    // 原样给 0，由 runDcaBacktest 整点丢弃（不在这里静默顶替）
    const dirty = [{ navDate: "2026-01-03", unitNav: 0, accNav: 15000 }];
    expect(toBacktestSeries(dirty, "unit")).toEqual([{ navDate: "2026-01-03", nav: 0 }]);
  });
});

describe("逐期明细（schedule）", () => {
  it("每期给出买入日、买入净值、本期份额、累计投入、当期市值与累计收益率", () => {
    // 净值 1.0 → 0.5 → 2.0，每月首个交易日各买 1000 元（费率 0），末日回 1.0 估值：
    //   第 1 期：1000 份；累计投入 1000 元；当期市值 1000 元；累计 +0%
    //   第 2 期：再买 2000 份（1000 ÷ 0.5）→ 共 3000 份；市值 3000 × 0.5 = 1500 元；
    //            (1500 − 2000) ÷ 2000 = −25%
    //   第 3 期：再买 500 份（1000 ÷ 2.0）→ 共 3500 份；市值 3500 × 2 = 7000 元；
    //            (7000 − 3000) ÷ 3000 = +133.33% → 万分之取整 13333
    const series = [
      p("2026-01-02", 1),
      p("2026-02-02", 0.5),
      p("2026-03-02", 2),
      p("2026-03-31", 1),
    ];

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    expect(r!.schedule).toEqual([
      {
        navDate: "2026-01-02",
        nav: 10000,
        sharesScaled: 10_000_000,
        investedCents: 100_000,
        valueCents: 100_000,
        returnRate: 0,
      },
      {
        navDate: "2026-02-02",
        nav: 5000,
        sharesScaled: 20_000_000,
        investedCents: 200_000,
        valueCents: 150_000,
        returnRate: -2500,
      },
      {
        navDate: "2026-03-02",
        nav: 20000,
        sharesScaled: 5_000_000,
        investedCents: 300_000,
        valueCents: 700_000,
        returnRate: 13333,
      },
    ]);
    // 期末（末日净值 1.0）：3500 份 × 1.0 = 3500 元，与明细最后一期口径一致
    expect(r!.finalValueCents).toBe(350_000);
  });

  it("期数被截断时明细长度与 periods 一致（明细不会多出一期）", () => {
    const series = Array.from({ length: 5 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return p(`2026-${month}-02`, 1);
    });
    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0, periods: 3 });
    expect(r!.schedule).toHaveLength(3);
    expect(r!.schedule.map(s => s.navDate)).toEqual([
      "2026-03-02",
      "2026-04-02",
      "2026-05-02",
    ]);
    // 明细最后一期的累计投入 = 总投入（页面表格最后一行要与概览对得上）
    expect(r!.schedule.at(-1)!.investedCents).toBe(r!.investedCents);
  });
});

describe("dcaCurvePoints（图表数据）", () => {
  it("逐期点 + 期末估值点：图的终点就是概览里的期末市值", () => {
    // 1/2 月各买一次、3/2 再买一次（净值都是 1.0，共 3000 份），3/31 回 1.5 估值
    const series = [
      p("2026-01-02", 1),
      p("2026-02-02", 1),
      p("2026-03-02", 1),
      p("2026-03-31", 1.5),
    ];
    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 })!;

    const curve = dcaCurvePoints(r);
    // 3 期 + 期末（03-31 晚于最后一个买入日 03-02）
    expect(curve).toHaveLength(4);
    // 期末点：市值 = 概览的期末市值（3000 份 × 1.5 = 4500 元），投入保持最后一期的值
    expect(curve.at(-1)).toEqual({
      navDate: "2026-03-31",
      investedCents: 300_000,
      valueCents: r.finalValueCents,
    });
    expect(curve.at(-1)!.valueCents).toBe(450_000);
    expect(curve.at(-1)!.investedCents).toBe(curve.at(-2)!.investedCents);
  });

  it("末日与最后一个买入日同一天就不重复补点（按天定投常见）", () => {
    const series = [p("2026-01-05", 1), p("2026-01-06", 1), p("2026-01-07", 1)];
    const r = runDcaBacktest(series, {
      amountCents: 100_000,
      purchaseRate: 0,
      frequency: "day",
    })!;

    const curve = dcaCurvePoints(r);
    expect(curve).toHaveLength(3);
    expect(curve.at(-1)!.navDate).toBe("2026-01-07");
  });
});

describe("年化收益率（资金加权 XIRR）", () => {
  /**
   * 12 期、每月 1 号各买 1000 元、买入净值恒为 1.0（共 12000 份），
   * 末日按 lastNav 估值——区间 363 天，够半年门槛。
   */
  function twelvePeriods(lastNav: number) {
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return p(`2026-${month}-02`, 1);
    });
    return [...months, p("2026-12-31", lastNav)];
  }

  it("按现金流日期折算年化（金标准由独立牛顿法算出，不是从实现里抄的）", () => {
    // 现金流：2026-01-02 ~ 12-02 十二笔 −1000 元，2026-12-31（第 363 天）+13200 元
    // （12000 份 × 1.1）。解 Σ cf ÷ (1+r)^(天数÷365) = 0 → r ≈ 19.0882% → 1909
    const r = runDcaBacktest(twelvePeriods(1.1), { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    expect(r!.returnRate).toBe(1000);
    expect(r!.annualizedRate).toBe(1909);
  });

  it("亏损为负、赚得越多年化越高（方向与刻度都对）", () => {
    const input = { amountCents: 100_000, purchaseRate: 0 };
    expect(runDcaBacktest(twelvePeriods(0.9), input)!.annualizedRate).toBe(-1802);
    expect(runDcaBacktest(twelvePeriods(1.5), input)!.annualizedRate).toBe(10424);
  });

  it("净值恒定不涨不跌时年化是 0（不是 -0）", () => {
    const r = runDcaBacktest(twelvePeriods(1), { amountCents: 100_000, purchaseRate: 0 });
    expect(r!.returnRate).toBe(0);
    expect(r!.annualizedRate).toBe(0);
  });

  it("区间不足半年不给年化：3 期 88 天的 +50% 折出来是 1079%/年，会误导人", () => {
    const series = [
      p("2026-01-02", 1),
      p("2026-02-02", 1),
      p("2026-03-02", 1),
      p("2026-03-31", 1.5),
    ];
    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r!.returnRate).toBe(5000);
    expect(r!.annualizedRate).toBeNull();
  });
});
