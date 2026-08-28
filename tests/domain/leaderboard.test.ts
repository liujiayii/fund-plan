// tests/domain/leaderboard.test.ts
import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  rankLeaderboard,
} from "~/domain/leaderboard";

/**
 * 排行榜口径 —— spec §2 的全部断言。
 * 造数约定：金额直接用分，一万元写 1_000_000，读起来跟元对应。
 */

/** 快捷构造：默认 10 万入金、无持仓、无签到，按需覆盖 */
function mk(over: Partial<Parameters<typeof computeLeaderboard>[0][number]>) {
  return {
    userId: 1,
    username: "alice",
    marketValueCents: 0,
    cashCents: 10_000_000,
    inFlightCashCents: 0,
    initialCashCents: 10_000_000,
    totalCheckinCents: 0,
    hasTrades: true,
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
    expect(out[0].totalPnlRate).toBeCloseTo(0.05, 10);
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
    expect(out[0].totalPnlRate).toBe(0);
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
    expect(out[0].totalPnlRate).toBeCloseTo(0.1, 10);
  });

  it("亏损用户：收益为负、率为负，照常上榜", () => {
    const out = computeLeaderboard([
      mk({ cashCents: 9_000_000 }),
    ]);
    expect(out[0].totalPnlCents).toBe(-1_000_000);
    expect(out[0].totalPnlRate).toBeCloseTo(-0.1, 10);
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

  it("除零守卫：累计入金为 0 时 rate 返回 0 而非 NaN/Infinity", () => {
    const out = computeLeaderboard([
      mk({
        cashCents: 0,
        initialCashCents: 0,
        totalCheckinCents: 0,
      }),
    ]);
    expect(out[0].totalPnlRate).toBe(0);
    expect(Number.isFinite(out[0].totalPnlRate)).toBe(true);
  });
});

describe("rankLeaderboard 排序", () => {
  // 简报原稿漏了 compute 前置步骤：rankLeaderboard 按签名吃算过口径的
  // LeaderboardEntry[]，造数注释里的 "pnl +5000, rate +5%" 也指的是算完的值，
  // 故各调用点先过 computeLeaderboard 再排序（断言与造数原样不动）。
  const base = [
    mk({ userId: 1, username: "a", cashCents: 10_500_000 }), // pnl +5000, rate +5%
    mk({ userId: 2, username: "b", cashCents: 9_000_000 }), // pnl -10000, rate -10%
    mk({ userId: 3, username: "c", marketValueCents: 20_000_000, cashCents: 0 }), // pnl +10000, rate +10%
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
      mk({ userId: 5, username: "x", cashCents: 10_500_000 }), // rate +5%
      mk({ userId: 4, username: "y", cashCents: 10_500_000 }), // rate +5%
      mk({ userId: 6, username: "z", cashCents: 11_000_000 }), // rate +10%
      mk({ userId: 7, username: "w", cashCents: 10_000_000 }), // rate 0%
    ];
    const ranked = rankLeaderboard(computeLeaderboard(tied), "rate");
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked.map(r => r.userId)).toEqual([6, 4, 5, 7]);
  });

  it("收益率榜与总收益榜顺序可以不同（判别性用例）", () => {
    // 甲：入金 10 万、当前总资产 10.1 万 → pnl +1000、rate +1%
    // 乙：入金 1 万、当前总资产 1.05 万 → pnl +500、rate +5%
    // 收益率榜乙第一（率更高），总收益榜甲第一（赚得更多）——两维不可互推
    const base = [
      mk({ userId: 1, username: "甲", cashCents: 10_100_000 }),
      mk({
        userId: 2,
        username: "乙",
        cashCents: 1_050_000,
        initialCashCents: 1_000_000,
      }),
    ];
    const byRate = rankLeaderboard(computeLeaderboard(base), "rate");
    const byPnl = rankLeaderboard(computeLeaderboard(base), "pnl");
    expect(byRate.map(r => r.userId)).toEqual([2, 1]);
    expect(byPnl.map(r => r.userId)).toEqual([1, 2]);
  });

  it("不修改入参数组（纯函数）", () => {
    const entries = computeLeaderboard(base);
    const snapshot = structuredClone(entries);
    rankLeaderboard(entries, "rate");
    expect(entries).toEqual(snapshot);
  });
});
