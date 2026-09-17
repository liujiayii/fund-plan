import { describe, expect, it } from "vitest";
import {
  DCA_BACKTEST_AMOUNT_CENTS,
  DCA_BACKTEST_MAX_PERIODS,
  DCA_BACKTEST_MIN_PERIODS,
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
 *  - 申购费走内扣法，与站内真实撮合一致：净额 = 金额 × (1 - 费率)
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
  });

  it("超过 12 个月只取最近 12 期", () => {
    // 14 个自然月，每月 1 号一个点，净值恒为 1.0
    const series = Array.from({ length: 14 }, (_, i) => {
      const month = String(i + 1).padStart(2, "0");
      return p(`2026-${month}-02`, 1);
    });

    const r = runDcaBacktest(series, { amountCents: 100_000, purchaseRate: 0 });
    expect(r).not.toBeNull();
    expect(r!.periods).toBe(DCA_BACKTEST_MAX_PERIODS);
    // 起点从第 3 个月开始（14 - 12 + 1）
    expect(r!.from).toBe("2026-03-02");
    expect(r!.investedCents).toBe(DCA_BACKTEST_MAX_PERIODS * 100_000);
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
});
