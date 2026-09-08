import type { ReplayInput } from "~/domain/asset-timeline";
import type { FundPnlInput } from "~/domain/fund-pnl";
import { describe, expect, it } from "vitest";
import { replayDailyAssets } from "~/domain/asset-timeline";
import { attributeFundPnlByDate } from "~/domain/fund-pnl";

/** 归因输入骨架，测试只覆写关心的字段 */
function buildAttrInput(over: Partial<FundPnlInput> = {}): FundPnlInput {
  return {
    dateAxis: [],
    navSeries: new Map(),
    confirmedOrders: [],
    ...over,
  };
}

/** 重放输入骨架（与 asset-timeline.test.ts 同款），不变量测试用 */
function buildReplayInput(over: Partial<ReplayInput> = {}): ReplayInput {
  return {
    dateAxis: [],
    cashLedger: [],
    netDepositByDate: new Map(),
    confirmedOrders: [],
    navSeries: new Map(),
    transitEvents: [],
    ...over,
  };
}

describe("attributeFundPnlByDate 按基金归因", () => {
  it("持有日上涨：收益 = 份额 × 净值变动，dayNavRate 同步给出", () => {
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-01", "2026-08-02"],
      confirmedOrders: [
        // 08-01 买 100 元（费 0）@1.0 → 100 份
        { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 1_000_000, cashCents: 10_000 },
      ],
      navSeries: new Map([
        ["A", [
          { navDate: "2026-08-01", unitNav: 10000 },
          { navDate: "2026-08-02", unitNav: 12000 },
        ]],
      ]),
    }));
    // 08-01：市值 10000 − 买支出 10000 = 0（无费用、当日无净值差）
    expect(r.get("2026-08-01")).toEqual([
      { fundCode: "A", dayPnlCents: 0, dayNavRate: 0 },
    ]);
    // 08-02：100 份 × (1.2 − 1.0) = +20 元
    expect(r.get("2026-08-02")).toEqual([
      { fundCode: "A", dayPnlCents: 2000, dayNavRate: 0.2 },
    ]);
  });

  it("买入确认日：当日收益恰好 = −申购费（内扣法）", () => {
    // 买 500 元、费 15 元 @1.0 → 485 份
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-02"],
      confirmedOrders: [
        { fundCode: "A", side: "buy", confirmDate: "2026-08-02", dealShares: 4_850_000, cashCents: 50_000 },
      ],
      navSeries: new Map([
        ["A", [{ navDate: "2026-08-02", unitNav: 10000 }]],
      ]),
    }));
    // 市值 48500 − 支出 50000 = −1500（15 元申购费）
    expect(r.get("2026-08-02")).toEqual([
      { fundCode: "A", dayPnlCents: -1500, dayNavRate: 0 },
    ]);
  });

  it("首次买入日前已有净值：涨跌幅取前一交易日净值，而非记 0", () => {
    // 基金 07-31 起就有净值史；用户 08-05 才首次买入——净值游标惰性推进，
    // 当天才一口气吞掉全部历史，涨跌幅必须从被吞历史里找回 08-04 的净值当基准
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-05"],
      confirmedOrders: [
        // 08-05 买 121 元（费 0）@1.21 → 100 份
        { fundCode: "A", side: "buy", confirmDate: "2026-08-05", dealShares: 1_000_000, cashCents: 12_100 },
      ],
      navSeries: new Map([
        ["A", [
          { navDate: "2026-07-31", unitNav: 10000 },
          { navDate: "2026-08-04", unitNav: 11000 },
          { navDate: "2026-08-05", unitNav: 12100 },
        ]],
      ]),
    }));
    // dayPnlCents = 市值 12100 − 支出 12100 = 0；涨跌幅 = 1.21/1.1 − 1 = 10%
    expect(r.get("2026-08-05")).toEqual([
      { fundCode: "A", dayPnlCents: 0, dayNavRate: 0.1 },
    ]);
  });

  it("清仓后再买回：涨跌幅只算当日，不吃停持期累计涨幅", () => {
    // 08-01 买 @1.0，08-02 全赎；08-03/08-04 空仓（游标冻结在 1.0），
    // 08-05 再买回——涨跌幅应以 08-04 的 1.1 为基准，而不是冻结的 1.0
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-01", "2026-08-02", "2026-08-05"],
      confirmedOrders: [
        { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 1_000_000, cashCents: 10_000 },
        { fundCode: "A", side: "sell", confirmDate: "2026-08-02", dealShares: 1_000_000, cashCents: 10_000 },
        { fundCode: "A", side: "buy", confirmDate: "2026-08-05", dealShares: 1_000_000, cashCents: 12_100 },
      ],
      navSeries: new Map([
        ["A", [
          { navDate: "2026-08-01", unitNav: 10000 },
          { navDate: "2026-08-04", unitNav: 11000 },
          { navDate: "2026-08-05", unitNav: 12100 },
        ]],
      ]),
    }));
    // 再买回日：市值 12100 − 支出 12100 = 0；涨跌幅 = 10%（旧逻辑会算成累计 21%）
    expect(r.get("2026-08-05")).toEqual([
      { fundCode: "A", dayPnlCents: 0, dayNavRate: 0.1 },
    ]);
  });

  it("赎回确认日：当日收益恰好 = −赎回费（已实现盈亏已在持有期间逐日记过）", () => {
    // 前一日持 1000 份 @1.0（市值 100000）；当日全赎到账 985 元（费 15）
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-01", "2026-08-02"],
      confirmedOrders: [
        { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10_000_000, cashCents: 100_000 },
        { fundCode: "A", side: "sell", confirmDate: "2026-08-02", dealShares: 10_000_000, cashCents: 98_500 },
      ],
      navSeries: new Map([
        ["A", [
          { navDate: "2026-08-01", unitNav: 10000 },
          { navDate: "2026-08-02", unitNav: 10000 },
        ]],
      ]),
    }));
    // 08-02：市值 0 − 前日市值 100000 + 到账 98500 = −1500
    expect(r.get("2026-08-02")).toEqual([
      { fundCode: "A", dayPnlCents: -1500, dayNavRate: 0 },
    ]);
  });

  it("停牌日净值前向填充条目收益为 0；清仓后基金不再出条目", () => {
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"],
      confirmedOrders: [
        { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 1_000_000, cashCents: 10_000 },
        { fundCode: "A", side: "sell", confirmDate: "2026-08-03", dealShares: 1_000_000, cashCents: 11_000 },
      ],
      navSeries: new Map([
        ["A", [
          { navDate: "2026-08-01", unitNav: 10000 },
          // 08-02 停牌（无净值）
          { navDate: "2026-08-03", unitNav: 11000 },
        ]],
      ]),
    }));
    // 08-02：前向填充 1.0，无变动 → 0
    expect(r.get("2026-08-02")).toEqual([
      { fundCode: "A", dayPnlCents: 0, dayNavRate: 0 },
    ]);
    // 08-03：复牌 1.1，市值 11000；全赎到账 110 元（费 0）
    //   收益 = 0 − 10000 + 11000 = +1000（净值涨幅 10%）
    expect(r.get("2026-08-03")).toEqual([
      { fundCode: "A", dayPnlCents: 1000, dayNavRate: 0.1 },
    ]);
    // 08-04：已清仓，无条目
    expect(r.get("2026-08-04")).toBeUndefined();
  });

  it("多基金互不串扰", () => {
    const r = attributeFundPnlByDate(buildAttrInput({
      dateAxis: ["2026-08-01", "2026-08-02"],
      confirmedOrders: [
        { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 1_000_000, cashCents: 10_000 },
        { fundCode: "B", side: "buy", confirmDate: "2026-08-01", dealShares: 1_000_000, cashCents: 10_000 },
      ],
      navSeries: new Map([
        ["A", [
          { navDate: "2026-08-01", unitNav: 10000 },
          { navDate: "2026-08-02", unitNav: 12000 },
        ]],
        ["B", [
          { navDate: "2026-08-01", unitNav: 10000 },
          { navDate: "2026-08-02", unitNav: 9000 },
        ]],
      ]),
    }));
    const day2 = r.get("2026-08-02")!;
    expect(day2).toHaveLength(2);
    expect(day2.find(x => x.fundCode === "A")!.dayPnlCents).toBe(2000); // A 涨 20%
    expect(day2.find(x => x.fundCode === "B")!.dayPnlCents).toBe(-1000); // B 跌 10%
  });

  it("无订单无持仓的日期轴返回空 Map", () => {
    expect(attributeFundPnlByDate(buildAttrInput({ dateAxis: ["2026-08-01"] })).size).toBe(0);
  });
});

describe("归因不变量：Σ各基金当日收益 === replayDailyAssets 当日 dayPnlCents", () => {
  /** 同一份数据喂两个函数（重放多收现金/在途/净入金），逐日对账 */
  function assertInvariant(replay: ReplayInput, attr: FundPnlInput) {
    const daily = replayDailyAssets(replay);
    const byDate = attributeFundPnlByDate(attr);
    expect(daily.length).toBeGreaterThan(0);
    for (const d of daily) {
      const sum = (byDate.get(d.date) ?? []).reduce((s, f) => s + f.dayPnlCents, 0);
      expect(sum).toBe(d.dayPnlCents);
    }
  }

  it("完整交易剧情：申购费/赎回费/净值涨跌/签到入金/清仓退出", () => {
    // 08-01 init 2000 元，15:00 后买 A 1000 元（确认 08-02）
    // 08-02 又买 B 500 元（确认 08-03，费 15 元）；A 净值涨到 1.2
    // 08-04 签到 +500 元；08-05 A 全赎 @1.2（费 15 元）
    const orders: FundPnlInput["confirmedOrders"] = [
      { fundCode: "A", side: "buy", confirmDate: "2026-08-02", dealShares: 10_000_000, cashCents: 100_000 },
      { fundCode: "B", side: "buy", confirmDate: "2026-08-03", dealShares: 4_850_000, cashCents: 50_000 },
      { fundCode: "A", side: "sell", confirmDate: "2026-08-05", dealShares: 10_000_000, cashCents: 118_500 },
    ];
    const dateAxis = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
    const navSeries = new Map([
      ["A", [
        { navDate: "2026-08-02", unitNav: 10000 },
        { navDate: "2026-08-03", unitNav: 12000 },
      ]],
      ["B", [{ navDate: "2026-08-03", unitNav: 10000 }]],
    ]);
    assertInvariant(
      buildReplayInput({
        dateAxis,
        cashLedger: [
          { date: "2026-08-01", balance: 100_000 }, // 2000 − 1000 冻结
          { date: "2026-08-02", balance: 50_000 }, // − 500 冻结
          { date: "2026-08-03", balance: 50_000 },
          { date: "2026-08-04", balance: 100_000 }, // 签到 +500
          { date: "2026-08-05", balance: 218_500 }, // 赎回到账 1185
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 200_000],
          ["2026-08-04", 50_000],
        ]),
        // 重放的 confirmedOrders 不带现金流字段，剥掉 cashCents
        confirmedOrders: orders.map(({ cashCents: _cash, ...o }) => o),
        navSeries,
        transitEvents: [
          { date: "2026-08-01", deltaCents: 100_000 },
          { date: "2026-08-02", deltaCents: -100_000 },
          { date: "2026-08-02", deltaCents: 50_000 },
          { date: "2026-08-03", deltaCents: -50_000 },
        ],
      }),
      { dateAxis, navSeries, confirmedOrders: orders },
    );
  });

  it("撤单与改单：在途对冲不留残差（退款不是收益）", () => {
    // 08-01 init 1000 元并下单 973；08-02 改单到 936；08-03 撤单全额退回
    const dateAxis = ["2026-08-01", "2026-08-02", "2026-08-03"];
    assertInvariant(
      buildReplayInput({
        dateAxis,
        cashLedger: [
          { date: "2026-08-01", balance: 2700 }, // 100000 − 97300
          { date: "2026-08-02", balance: 6400 }, // 改单退 37
          { date: "2026-08-03", balance: 100_000 }, // 撤单退 936
        ],
        netDepositByDate: new Map([["2026-08-01", 100_000]]),
        confirmedOrders: [],
        navSeries: new Map(),
        transitEvents: [
          { date: "2026-08-01", deltaCents: 97300 },
          { date: "2026-08-02", deltaCents: -3700 },
          { date: "2026-08-03", deltaCents: -93600 },
        ],
      }),
      { dateAxis, navSeries: new Map(), confirmedOrders: [] },
    );
  });
});
