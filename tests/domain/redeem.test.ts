import { describe, expect, it } from "vitest";
import {
  calcRedeem,
  DEFAULT_REDEEM_TIERS,
  findRedeemRate,
} from "~/domain/redeem";

/**
 * FIFO 阶梯赎回费——全系统最复杂的算法。
 *
 * 真实规则：赎回按份额批次先进先出消耗，每一批按各自的「持有天数」
 * 查对应的费率档，分别计费，最后加总。
 * 所以同一笔赎回可能同时按 1.5% 和 0.5% 两档计费。
 */
describe("redeem FIFO 阶梯赎回费", () => {
  describe("findRedeemRate 费率档位查找", () => {
    it("持有 < 7 天：1.5%", () => {
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 0)).toBe(150);
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 6)).toBe(150);
    });

    it("第 7 天整：降到 0.5%（边界必须精确）", () => {
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 7)).toBe(50);
    });

    it("7 天 ~ 不满 1 年：0.5%", () => {
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 100)).toBe(50);
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 364)).toBe(50);
    });

    it("满 1 年 ~ 不满 2 年：0.25%", () => {
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 365)).toBe(25);
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 729)).toBe(25);
    });

    it("满 2 年：免费", () => {
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 730)).toBe(0);
      expect(findRedeemRate(DEFAULT_REDEEM_TIERS, 3650)).toBe(0);
    });
  });

  describe("calcRedeem 单批赎回", () => {
    it("持有 3 天全额赎回，按 1.5% 计费", () => {
      const r = calcRedeem({
        lots: [
          {
            id: 1,
            sharesScaled: 10_000_000, // 1000 份
            costCents: 150000, // 成本 1500 元
            confirmDate: "2026-08-17",
          },
        ],
        redeemSharesScaled: 10_000_000,
        navScaled: 16000, // 净值 1.6
        confirmDate: "2026-08-20", // 持有 3 天
        tiers: DEFAULT_REDEEM_TIERS,
      });

      expect(r.lotResults).toHaveLength(1);
      expect(r.lotResults[0].holdDays).toBe(3);
      expect(r.lotResults[0].rate).toBe(150);
      expect(r.totalGrossCents).toBe(160000); // 1000 × 1.6 = 1600 元
      expect(r.totalFeeCents).toBe(2400); // 1600 × 1.5%
      expect(r.totalNetCents).toBe(157600);
      expect(r.totalCostCents).toBe(150000);
      expect(r.realizedPnlCents).toBe(7600);
    });

    it("部分赎回只消耗部分批次，剩余份额保留", () => {
      const r = calcRedeem({
        lots: [
          {
            id: 1,
            sharesScaled: 10_000_000, // 持有 1000 份
            costCents: 150000,
            confirmDate: "2026-01-05",
          },
        ],
        redeemSharesScaled: 4_000_000, // 只赎 400 份
        navScaled: 16000,
        confirmDate: "2026-08-20",
        tiers: DEFAULT_REDEEM_TIERS,
      });

      expect(r.lotResults).toHaveLength(1);
      expect(r.lotResults[0].consumedSharesScaled).toBe(4_000_000);
      expect(r.totalGrossCents).toBe(64000); // 400 × 1.6 = 640 元
      // 成本按份额比例摊：1500 × (400/1000) = 600 元
      expect(r.totalCostCents).toBe(60000);
    });
  });

  describe("calcRedeem 跨批次 FIFO（核心场景）", () => {
    it("两批不同持有期，各按各自档位计费", () => {
      const r = calcRedeem({
        lots: [
          {
            id: 1,
            sharesScaled: 10_000_000, // 1000 份
            costCents: 150000, // 1500 元
            confirmDate: "2026-01-05", // 持有 227 天 → 0.5%
          },
          {
            id: 2,
            sharesScaled: 5_000_000, // 500 份
            costCents: 80000, // 800 元
            confirmDate: "2026-08-01", // 持有 19 天 → 0.5%
          },
        ],
        redeemSharesScaled: 12_000_000, // 赎 1200 份：吃光 lot1 + lot2 的 200 份
        navScaled: 16000,
        confirmDate: "2026-08-20",
        tiers: DEFAULT_REDEEM_TIERS,
      });

      expect(r.lotResults).toHaveLength(2);

      // 老批先耗光
      expect(r.lotResults[0].lotId).toBe(1);
      expect(r.lotResults[0].consumedSharesScaled).toBe(10_000_000);
      expect(r.lotResults[0].holdDays).toBe(227);
      expect(r.lotResults[0].grossCents).toBe(160000);
      expect(r.lotResults[0].feeCents).toBe(800);

      // 新批只耗 200 份
      expect(r.lotResults[1].lotId).toBe(2);
      expect(r.lotResults[1].consumedSharesScaled).toBe(2_000_000);
      expect(r.lotResults[1].holdDays).toBe(19);
      expect(r.lotResults[1].grossCents).toBe(32000);
      expect(r.lotResults[1].feeCents).toBe(160);
      expect(r.lotResults[1].costCents).toBe(32000); // 800 × (200/500)

      expect(r.totalGrossCents).toBe(192000);
      expect(r.totalFeeCents).toBe(960);
      expect(r.totalNetCents).toBe(191040);
      expect(r.totalCostCents).toBe(182000);
      expect(r.realizedPnlCents).toBe(9040);
    });

    it("跨费率档：老批免费、新批 1.5%，费用差异体现在结果里", () => {
      const r = calcRedeem({
        lots: [
          {
            id: 1,
            sharesScaled: 5_000_000, // 500 份，持有 2 年以上 → 0%
            costCents: 50000,
            confirmDate: "2024-01-01",
          },
          {
            id: 2,
            sharesScaled: 5_000_000, // 500 份，持有 3 天 → 1.5%
            costCents: 70000,
            confirmDate: "2026-08-17",
          },
        ],
        redeemSharesScaled: 10_000_000, // 全赎
        navScaled: 20000, // 净值 2.0
        confirmDate: "2026-08-20",
        tiers: DEFAULT_REDEEM_TIERS,
      });

      expect(r.lotResults[0].rate).toBe(0);
      expect(r.lotResults[0].feeCents).toBe(0);
      expect(r.lotResults[1].rate).toBe(150);
      expect(r.lotResults[1].grossCents).toBe(100000); // 500 × 2.0
      expect(r.lotResults[1].feeCents).toBe(1500); // 1000 × 1.5%
      expect(r.totalFeeCents).toBe(1500);
    });

    it("严格按 confirmDate 升序消耗（即使入参顺序是乱的）", () => {
      const r = calcRedeem({
        lots: [
          {
            id: 2,
            sharesScaled: 5_000_000,
            costCents: 80000,
            confirmDate: "2026-08-01", // 新
          },
          {
            id: 1,
            sharesScaled: 5_000_000,
            costCents: 60000,
            confirmDate: "2026-01-05", // 老
          },
        ],
        redeemSharesScaled: 5_000_000,
        navScaled: 16000,
        confirmDate: "2026-08-20",
        tiers: DEFAULT_REDEEM_TIERS,
      });

      // FIFO：应该先消耗老批（id=1）
      expect(r.lotResults).toHaveLength(1);
      expect(r.lotResults[0].lotId).toBe(1);
    });
  });

  describe("边界与异常", () => {
    it("赎回份额超过总持仓时抛错", () => {
      expect(() =>
        calcRedeem({
          lots: [
            {
              id: 1,
              sharesScaled: 1_000_000,
              costCents: 10000,
              confirmDate: "2026-08-01",
            },
          ],
          redeemSharesScaled: 2_000_000,
          navScaled: 16000,
          confirmDate: "2026-08-20",
          tiers: DEFAULT_REDEEM_TIERS,
        }),
      ).toThrow(/份额不足/);
    });

    it("赎回份额非正数时抛错", () => {
      expect(() =>
        calcRedeem({
          lots: [
            {
              id: 1,
              sharesScaled: 1_000_000,
              costCents: 10000,
              confirmDate: "2026-08-01",
            },
          ],
          redeemSharesScaled: 0,
          navScaled: 16000,
          confirmDate: "2026-08-20",
          tiers: DEFAULT_REDEEM_TIERS,
        }),
      ).toThrow();
    });

    it("空批次列表时抛错", () => {
      expect(() =>
        calcRedeem({
          lots: [],
          redeemSharesScaled: 1_000_000,
          navScaled: 16000,
          confirmDate: "2026-08-20",
          tiers: DEFAULT_REDEEM_TIERS,
        }),
      ).toThrow();
    });

    it("全额赎回后总消耗份额精确等于赎回份额（不丢碎渣）", () => {
      const r = calcRedeem({
        lots: [
          { id: 1, sharesScaled: 3_333_333, costCents: 50000, confirmDate: "2026-01-05" },
          { id: 2, sharesScaled: 3_333_333, costCents: 50000, confirmDate: "2026-02-05" },
          { id: 3, sharesScaled: 3_333_334, costCents: 50000, confirmDate: "2026-03-05" },
        ],
        redeemSharesScaled: 10_000_000,
        navScaled: 16000,
        confirmDate: "2026-08-20",
        tiers: DEFAULT_REDEEM_TIERS,
      });

      const consumed = r.lotResults.reduce(
        (s, l) => s + l.consumedSharesScaled,
        0,
      );
      expect(consumed).toBe(10_000_000);
      // 成本也应全部摊完
      expect(r.totalCostCents).toBe(150000);
    });
  });
});
