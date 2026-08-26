import type { ReplayInput } from "~/domain/asset-timeline";
import { describe, expect, it } from "vitest";
import { replayDailyAssets } from "~/domain/asset-timeline";

/** 造一个空输入，测试里只覆写关心的字段 */
function buildInput(over: Partial<ReplayInput> = {}): ReplayInput {
  return {
    dateAxis: [],
    cashLedger: [],
    netDepositByDate: new Map(),
    confirmedOrders: [],
    navSeries: new Map(),
    ...over,
  };
}

describe("replayDailyAssets 账本重放", () => {
  describe("净入金不计入日收益（核心）", () => {
    it("签到日净入金被扣除，dayPnl 为 0（而非 +500 元假收益）", () => {
      // 净值走平 1.0000，确保市值不变，dayPnl 只受净入金影响
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02"],
        // 08-01 初始入金 1000 元；08-02 签到 +500 元
        cashLedger: [
          { date: "2026-08-01", balance: 100000 }, // 1000 元
          { date: "2026-08-02", balance: 150000 }, // +500 元签到 → 1500 元
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 100000], // init 1000 元
          ["2026-08-02", 50000], // checkin 500 元
        ]),
        confirmedOrders: [
          // 08-01 确认买入 1 份，市值 = 1 × 1.0 = 1 元 = 100 分
          { fundCode: "000001", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 },
        ],
        navSeries: new Map([
          ["000001", [
            { navDate: "2026-08-01", unitNav: 10000 }, // 1.0000
            { navDate: "2026-08-02", unitNav: 10000 }, // 1.0000（走平）
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：现金 100000 + 市值 100 = 100100，首日 dayPnl=0
      expect(r[0].totalAssetCents).toBe(100100);
      expect(r[0].dayPnlCents).toBe(0);
      // 08-02：现金 150000 + 市值 100 = 150100；扣净入金 50000 后 dayPnl=0
      //   若忘了扣净入金，dayPnl 会是 50000（假收益）
      expect(r[1].totalAssetCents).toBe(150100);
      expect(r[1].dayPnlCents).toBe(0);
    });

    it("非交易日的签到日也并入日期轴并扣除，不漏到下一交易日", () => {
      // 08-01(周五) 有 nav；08-02(周六) 无 nav 但有签到 → 08-02 必须在 dateAxis 里
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03"],
        cashLedger: [
          { date: "2026-08-01", balance: 100000 },
          { date: "2026-08-02", balance: 150000 }, // 周六签到 +500
          { date: "2026-08-03", balance: 150000 }, // 无变化
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 100000],
          ["2026-08-02", 50000],
        ]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 },
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-03", unitNav: 10000 }, // 08-02 无净值（周末）
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：100000 + 100 = 100100
      expect(r[0].totalAssetCents).toBe(100100);
      // 08-02（周六）：签到 +500 扣净入金后 dayPnl=0；市值前向填充 1.0 → 100
      expect(r[1].totalAssetCents).toBe(150100);
      expect(r[1].dayPnlCents).toBe(0);
      // 08-03：无变化，前一日已扣过签到 → dayPnl=0（不会把签到再算一次）
      expect(r[2].dayPnlCents).toBe(0);
    });
  });

  describe("净值前向填充", () => {
    it("基金停牌日（nav 缺失）用前一交易日净值前向填充，不归零", () => {
      // A 在 08-02 停牌；B 走平。dateAxis 含 08-02（B 有净值）
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03"],
        cashLedger: [{ date: "2026-08-01", balance: 200000 }], // 2000 元 init
        netDepositByDate: new Map([["2026-08-01", 200000]]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 }, // 1 份
          { fundCode: "B", side: "buy", confirmDate: "2026-08-01", dealShares: 10000 }, // 1 份
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 }, // 1.0
            // 08-02 停牌
            { navDate: "2026-08-03", unitNav: 12000 }, // 1.2
          ]],
          ["B", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
            { navDate: "2026-08-03", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：A=100 + B=100 = 200，现金 200000 → 200200
      expect(r[0].totalAssetCents).toBe(200200);
      // 08-02：A 停牌前向填充 1.0 → 100；B 1.0 → 100；现金 200000 → 200200
      //   若前向填充坏了（A 归零），总资产会掉到 200100
      expect(r[1].totalAssetCents).toBe(200200);
      expect(r[1].dayPnlCents).toBe(0);
      // 08-03：A 复牌 1.2 → 120；B 1.0 → 100；现金 200000 → 200220
      expect(r[2].totalAssetCents).toBe(200220);
      expect(r[2].dayPnlCents).toBe(20);
    });
  });

  describe("赎回手续费自然体现为当日亏损", () => {
    it("赎回手续费不做特殊处理，dayPnl 恰好等于手续费（负数）", () => {
      // 08-01 买 1000 份 @1.0；08-02 全赎 @1.0，扣手续费 15 元
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02"],
        // 08-01 init 2000 元，买入花 1000 → 余额 1000；
        // 08-02 赎回到账 985 元（毛 1000 − 手续费 15）→ 1985 元
        cashLedger: [
          { date: "2026-08-01", balance: 100000 }, // 1000 元
          { date: "2026-08-02", balance: 198500 }, // +985 元
        ],
        netDepositByDate: new Map([
          ["2026-08-01", 200000], // 只有 init 是净入金；买/赎/费都不算
        ]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000000 }, // 1000 份
          { fundCode: "A", side: "sell", confirmDate: "2026-08-02", dealShares: 10000000 }, // 全赎
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：1000 份 × 1.0 = 100000 市值 + 现金 100000 = 200000
      expect(r[0].totalAssetCents).toBe(200000);
      // 08-02：份额 0，现金 198500 → 总资产 198500
      //   dayPnl = 198500 − 200000 − 0 = −1500，恰好等于 15 元手续费
      expect(r[1].totalAssetCents).toBe(198500);
      expect(r[1].dayPnlCents).toBe(-1500);
    });
  });

  describe("清仓后曲线变纯现金水平线", () => {
    it("全部清仓后无持仓无操作，总资产持平、dayPnl=0", () => {
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02", "2026-08-03"],
        cashLedger: [
          { date: "2026-08-01", balance: 100000 },
          { date: "2026-08-02", balance: 198500 },
          // 08-03 无新流水，前向填充取 08-02 的 198500
        ],
        netDepositByDate: new Map([["2026-08-01", 200000]]),
        confirmedOrders: [
          { fundCode: "A", side: "buy", confirmDate: "2026-08-01", dealShares: 10000000 },
          { fundCode: "A", side: "sell", confirmDate: "2026-08-02", dealShares: 10000000 },
        ],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
            { navDate: "2026-08-03", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-02 与 08-03 总资产相等（纯现金水平线），08-03 dayPnl=0
      expect(r[1].totalAssetCents).toBe(198500);
      expect(r[2].totalAssetCents).toBe(198500);
      expect(r[2].dayPnlCents).toBe(0);
    });
  });

  describe("空账户 / 单日 / 除零保护", () => {
    it("空账户返回空数组", () => {
      const r = replayDailyAssets(buildInput({}));
      expect(r).toEqual([]);
    });

    it("单日场景：只有一天时 dayPnl 与 rate 均为 0", () => {
      const input = buildInput({
        dateAxis: ["2026-08-01"],
        cashLedger: [{ date: "2026-08-01", balance: 100000 }],
        netDepositByDate: new Map([["2026-08-01", 100000]]),
        confirmedOrders: [],
        navSeries: new Map(),
      });
      const r = replayDailyAssets(input);
      expect(r).toHaveLength(1);
      expect(r[0].totalAssetCents).toBe(100000);
      expect(r[0].dayPnlCents).toBe(0);
      expect(r[0].dayPnlRate).toBe(0);
    });

    it("前一日总资产为 0 时 dayPnlRate 归零，不产生 NaN/Infinity", () => {
      // 08-01 一无所有；08-02 才 init 入金 500 元（仍无持仓）
      const input = buildInput({
        dateAxis: ["2026-08-01", "2026-08-02"],
        cashLedger: [{ date: "2026-08-02", balance: 50000 }],
        netDepositByDate: new Map([["2026-08-02", 50000]]),
        confirmedOrders: [],
        navSeries: new Map([
          ["A", [
            { navDate: "2026-08-01", unitNav: 10000 },
            { navDate: "2026-08-02", unitNav: 10000 },
          ]],
        ]),
      });
      const r = replayDailyAssets(input);
      // 08-01：全 0，首日 rate=0
      expect(r[0].totalAssetCents).toBe(0);
      expect(r[0].dayPnlCents).toBe(0);
      expect(r[0].dayPnlRate).toBe(0);
      // 08-02：现金 50000，无持仓 → 50000；前一日总资产 0 → rate 必须为 0（非 NaN）
      expect(r[1].totalAssetCents).toBe(50000);
      expect(r[1].dayPnlCents).toBe(0); // 50000 − 0 − 净入金 50000 = 0
      expect(r[1].dayPnlRate).toBe(0);
      expect(Number.isFinite(r[1].dayPnlRate)).toBe(true);
    });
  });
});
