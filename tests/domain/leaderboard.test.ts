// tests/domain/leaderboard.test.ts
import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  isOlympicPodium,
  rankLeaderboard,
  splitPodium,
} from "~/domain/leaderboard";

/**
 * 排行榜口径 —— spec §2 的全部断言。
 * 造数约定：金额直接用分，一万元写 1_000_000，读起来跟元对应。
 */

/** 快捷构造：默认 10 万入金、无持仓、无签到、未买过，按需覆盖 */
function mk(over: Partial<Parameters<typeof computeLeaderboard>[0][number]>) {
  return {
    userId: 1,
    username: "alice",
    marketValueCents: 0,
    cashCents: 10_000_000,
    inFlightCashCents: 0,
    initialCashCents: 10_000_000,
    totalCheckinCents: 0,
    investedCents: 0,
    hasTrades: true,
    portfolioPublic: false,
    ...over,
  };
}

describe("computeLeaderboard 口径", () => {
  it("纯现金无成交的用户被门槛过滤", () => {
    const out = computeLeaderboard([mk({ hasTrades: false })]);
    expect(out).toHaveLength(0);
  });

  it("有成交但空仓：总资产 = 现金，清仓利润保留在收益里", () => {
    // 入金 10 万，买入后清仓落袋 5000：现金 10.5 万
    const out = computeLeaderboard([
      mk({ cashCents: 10_500_000 }),
    ]);
    expect(out[0].totalAssetCents).toBe(10_500_000);
    expect(out[0].totalPnlCents).toBe(500_000);
    // 这例没给 investedCents，选基收益率无分母
    expect(out[0].investedPnlRate).toBeNull();
  });

  it("只签到不买（有历史成交）：签到是入金不是收益，rate 仍 0", () => {
    // 注册 10 万 + 签到 1000，没买过但历史上成交过（已清仓）
    const out = computeLeaderboard([
      mk({
        cashCents: 10_010_000,
        totalCheckinCents: 10_000,
        hasTrades: true,
      }),
    ]);
    expect(out[0].totalPnlCents).toBe(0);
    expect(out[0].investedPnlRate).toBeNull();
  });

  it("持仓 + 现金：总资产 = 市值 + 现金，盈亏 = 总资产 − 累计入金", () => {
    // 入金 10 万，花 5 万买基金（成本 5 万），市值涨到 6 万
    const out = computeLeaderboard([
      mk({
        marketValueCents: 6_000_000,
        cashCents: 5_000_000,
      }),
    ]);
    expect(out[0].totalAssetCents).toBe(11_000_000);
    expect(out[0].totalPnlCents).toBe(1_000_000);
  });

  it("亏损且从未买入：收益为负，选基收益率无分母（不进收益率榜）", () => {
    const out = computeLeaderboard([
      mk({ cashCents: 9_000_000 }),
    ]);
    expect(out[0].totalPnlCents).toBe(-1_000_000);
    expect(out[0].investedPnlRate).toBeNull();
  });

  it("pending 买单在途资金计入总资产：pending 窗口内不凭空缩水", () => {
    // 两人都入金 10 万：甲买了 5000 元基金但还在 pending（现金已扣），
    // 乙什么都没动。甲的在途资金必须补回总资产——两人总资产应相等、收益都为 0
    const out = computeLeaderboard([
      mk({ userId: 1, username: "甲", cashCents: 9_500_000, inFlightCashCents: 500_000 }),
      mk({ userId: 2, username: "乙", cashCents: 10_000_000 }),
    ]);
    expect(out[0].totalAssetCents).toBe(10_000_000);
    expect(out[1].totalAssetCents).toBe(10_000_000);
    expect(out[0].totalAssetCents).toBe(out[1].totalAssetCents);
    expect(out[0].totalPnlCents).toBe(0);
  });

  it("累计入金为 0 时收益照算，选基收益率仍看买入额", () => {
    const out = computeLeaderboard([
      mk({
        cashCents: 0,
        initialCashCents: 0,
        totalCheckinCents: 0,
      }),
    ]);
    expect(out[0].totalPnlCents).toBe(0);
    expect(out[0].investedPnlRate).toBeNull();
  });
});

/**
 * 选基收益率 ——修「赚了 3.48 元、收益率显示 0.00%」那个线上问题。
 * 分母只算真投进基金的钱；含闲钱的账户收益率已于 2026-09-22 全站撤掉，
 * 因为它和这个数并排时用户分不清哪个才是自己的成绩。
 */
describe("computeLeaderboard 选基收益率", () => {
  it("轻仓用户：选基收益率还原真实幅度，不被闲置现金稀释", () => {
    // 10 万本金里只买了 1000 元，赚 3.48 元（线上实测的那个号）
    const out = computeLeaderboard([
      mk({
        marketValueCents: 100_348,
        cashCents: 9_900_000,
        investedCents: 100_000,
      }),
    ]);
    expect(out[0].totalPnlCents).toBe(348);
    // 348 / 100_000 = 0.348%——以前的账户口径是 348 / 10_000_000 = 0.00348%
    expect(out[0].investedPnlRate).toBeCloseTo(0.00348, 10);
  });

  it("从未买过（分母为 0）返回 null，不是 0——「无数据」不能冒充「0%」", () => {
    const out = computeLeaderboard([mk({ investedCents: 0 })]);
    expect(out[0].investedPnlRate).toBeNull();
  });

  it("清仓落袋：选基收益率按累计买入额算，收益金额仍全部保留", () => {
    // 买 2000 元 → 清仓落袋赚 100 元，现金 100100 元，无持仓
    const out = computeLeaderboard([
      mk({ cashCents: 10_010_000, investedCents: 200_000 }),
    ]);
    expect(out[0].totalPnlCents).toBe(10_000);
    expect(out[0].investedPnlRate).toBeCloseTo(0.05, 10);
  });

  it("亏损用户的投入收益率为负，符号与总收益一致", () => {
    const out = computeLeaderboard([
      mk({
        marketValueCents: 90_000,
        cashCents: 9_900_000,
        investedCents: 100_000,
      }),
    ]);
    expect(out[0].totalPnlCents).toBe(-10_000);
    expect(out[0].investedPnlRate).toBeCloseTo(-0.1, 10);
  });
});

describe("rankLeaderboard 排序", () => {
  // 简报原稿漏了 compute 前置步骤：rankLeaderboard 按签名吃算过口径的
  // LeaderboardEntry[]，造数注释里的 "pnl +5000, rate +5%" 也指的是算完的值，
  // 故各调用点先过 computeLeaderboard 再排序（断言与造数原样不动）。
  const base = [
    mk({ userId: 1, username: "a", cashCents: 10_500_000, investedCents: 1_000_000 }), // pnl +5000, 选基 +50%
    mk({ userId: 2, username: "b", cashCents: 9_000_000, investedCents: 1_000_000 }), // pnl -10000, 选基 -100%
    mk({ userId: 3, username: "c", marketValueCents: 20_000_000, cashCents: 0, investedCents: 10_000_000 }), // pnl +100000, 选基 +100%
  ];

  it("按收益率降序排名", () => {
    const ranked = rankLeaderboard(computeLeaderboard(base), "rate");
    expect(ranked.map(r => r.userId)).toEqual([3, 1, 2]);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it("按总收益降序排名", () => {
    const ranked = rankLeaderboard(computeLeaderboard(base), "pnl");
    expect(ranked.map(r => r.userId)).toEqual([3, 1, 2]);
  });

  it("同分同名次（1,2,2,4 型），破平按 userId 升序", () => {
    const tied = [
      mk({ userId: 5, username: "x", cashCents: 10_500_000, investedCents: 1_000_000 }), // 选基 +50%
      mk({ userId: 4, username: "y", cashCents: 10_500_000, investedCents: 1_000_000 }), // 选基 +50%
      mk({ userId: 6, username: "z", cashCents: 11_000_000, investedCents: 1_000_000 }), // 选基 +100%
      mk({ userId: 7, username: "w", cashCents: 10_000_000, investedCents: 1_000_000 }), // 选基 0%
    ];
    const ranked = rankLeaderboard(computeLeaderboard(tied), "rate");
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked.map(r => r.userId)).toEqual([6, 4, 5, 7]);
  });

  it("收益率榜与总收益榜顺序可以不同（判别性用例）", () => {
    // 甲：入金 100 万，市值 90 万 + 现金 15 万 = 总资产 105 万 → 赚 5 万；
    //     累计买入 90 万 → 选基收益率 5/90 ≈ 5.6%
    // 乙：入金 10 万，现金 100400 → 赚 400；累计买入 1000 → 选基收益率 40%
    // 收益率榜乙第一（率更高），总收益榜甲第一（赚得更多）——两维不可互推
    const rows = [
      mk({ userId: 1, username: "甲", initialCashCents: 100_000_000, marketValueCents: 90_000_000, cashCents: 15_000_000, investedCents: 90_000_000 }),
      mk({ userId: 2, username: "乙", initialCashCents: 10_000_000, cashCents: 10_040_000, investedCents: 100_000 }),
    ];
    const byRate = rankLeaderboard(computeLeaderboard(rows), "rate");
    const byPnl = rankLeaderboard(computeLeaderboard(rows), "pnl");
    expect(byRate.map(r => r.userId)).toEqual([2, 1]);
    expect(byPnl.map(r => r.userId)).toEqual([1, 2]);
  });

  it("收益率榜排除从未买过的人，总收益榜仍保留", () => {
    const rows = computeLeaderboard([
      mk({ userId: 1, username: "买过", cashCents: 10_100_000, investedCents: 100_000 }),
      mk({ userId: 2, username: "没买过", cashCents: 10_500_000, investedCents: 0 }),
    ]);
    expect(rankLeaderboard(rows, "rate").map(r => r.userId)).toEqual([1]);
    // 总收益榜按金额排：没买过的人收益更高，照样第一
    expect(rankLeaderboard(rows, "pnl").map(r => r.userId)).toEqual([2, 1]);
  });

  it("不修改入参数组（纯函数）", () => {
    const entries = computeLeaderboard(base);
    const snapshot = structuredClone(entries);
    rankLeaderboard(entries, "rate");
    expect(entries).toEqual(snapshot);
  });
});

describe("splitPodium 切终榜条带", () => {
  it("四人并列第一全部进领先档，不漏进名单带", () => {
    const ranked = rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 11_000_000 }),
      mk({ userId: 2, cashCents: 11_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
      mk({ userId: 4, cashCents: 11_000_000 }),
      mk({ userId: 5, cashCents: 10_000_000 }),
    ]), "pnl");
    const { leads, rest, tape } = splitPodium(ranked);
    expect(leads.map(e => e.userId)).toEqual([1, 2, 3, 4]);
    expect(leads.every(e => e.rank === 1)).toBe(true);
    expect(rest).toHaveLength(0);
    expect(tape.map(e => e.userId)).toEqual([5]);
  });

  it("两人并列第一 + 第三人：领先档两人，rest 一人，名单带从第 4 名起", () => {
    const ranked = rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 12_000_000 }),
      mk({ userId: 2, cashCents: 12_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
      mk({ userId: 4, cashCents: 10_500_000 }),
    ]), "pnl");
    const { leads, rest, tape } = splitPodium(ranked);
    expect(leads.map(e => e.userId)).toEqual([1, 2]);
    expect(rest.map(e => e.userId)).toEqual([3]);
    expect(tape.map(e => e.userId)).toEqual([4]);
  });

  it("无并列：1/2/3 进条带，第 4 名起进名单带", () => {
    const ranked = rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 13_000_000 }),
      mk({ userId: 2, cashCents: 12_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
      mk({ userId: 4, cashCents: 10_500_000 }),
    ]), "pnl");
    const { leads, rest, tape } = splitPodium(ranked);
    expect(leads.map(e => e.userId)).toEqual([1]);
    expect(rest.map(e => e.userId)).toEqual([2, 3]);
    expect(tape.map(e => e.userId)).toEqual([4]);
  });

  it("空榜三组全空", () => {
    expect(splitPodium([])).toEqual({ leads: [], rest: [], tape: [] });
  });
});

/**
 * 奥林匹克三柱装得下才走领奖台：rank ≤ 3 合计 ≤ 3。
 * 三柱最多站 3 人——四人并列第一、1/2/3/3、1/2/2/2 都装不下，
 * 整台跌回终榜条带（不能 slice(0,3)，否则并列的人会从台上消失）。
 * splitPodium 的切分口径不动，UI 只拿这个布尔决定渲染哪套。
 */
describe("isOlympicPodium 三柱门槛", () => {
  it("无并列 1/2/3：走三柱", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 13_000_000 }),
      mk({ userId: 2, cashCents: 12_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
      mk({ userId: 4, cashCents: 10_500_000 }),
    ]), "pnl"));
    expect(isOlympicPodium(leads, rest)).toBe(true);
  });

  it("两人并列第一 + 第三人：走三柱（两金一台）", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 12_000_000 }),
      mk({ userId: 2, cashCents: 12_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
    ]), "pnl"));
    expect(isOlympicPodium(leads, rest)).toBe(true);
  });

  it("三人并列第一：走三柱（三金）", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 11_000_000 }),
      mk({ userId: 2, cashCents: 11_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
    ]), "pnl"));
    expect(isOlympicPodium(leads, rest)).toBe(true);
  });

  it("四人并列第一：跌回终榜条带", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 11_000_000 }),
      mk({ userId: 2, cashCents: 11_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
      mk({ userId: 4, cashCents: 11_000_000 }),
    ]), "pnl"));
    expect(leads).toHaveLength(4);
    expect(isOlympicPodium(leads, rest)).toBe(false);
  });

  it("1/2/3/3 两人并列第三：合计 4 人装不下，跌回条带", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 13_000_000 }),
      mk({ userId: 2, cashCents: 12_000_000 }),
      mk({ userId: 3, cashCents: 11_000_000 }),
      mk({ userId: 4, cashCents: 11_000_000 }),
    ]), "pnl"));
    expect(leads).toHaveLength(1);
    expect(rest).toHaveLength(3);
    expect(isOlympicPodium(leads, rest)).toBe(false);
  });

  it("1/2/2/2 三人并列第二：合计 4 人装不下，跌回条带", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 13_000_000 }),
      mk({ userId: 2, cashCents: 12_000_000 }),
      mk({ userId: 3, cashCents: 12_000_000 }),
      mk({ userId: 4, cashCents: 12_000_000 }),
    ]), "pnl"));
    expect(leads).toHaveLength(1);
    expect(rest).toHaveLength(3);
    expect(isOlympicPodium(leads, rest)).toBe(false);
  });

  it("榜上只有一人：走三柱（单金）", () => {
    const { leads, rest } = splitPodium(rankLeaderboard(computeLeaderboard([
      mk({ userId: 1, cashCents: 11_000_000 }),
    ]), "pnl"));
    expect(isOlympicPodium(leads, rest)).toBe(true);
  });

  it("空榜：false", () => {
    expect(isOlympicPodium([], [])).toBe(false);
  });
});
