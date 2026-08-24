import { describe, expect, it } from 'vitest';
import { reconcile, valuateHolding, valuatePortfolio } from '~/domain/portfolio';

/**
 * 组合估值与持仓对账。
 * reconcile 是撮合后的自检闸门：Σshare_lot 必须与 holding 完全一致，
 * 差一分都说明撮合写错了。
 */
describe('portfolio 组合估值', () => {
  describe('valuateHolding 单只持仓估值', () => {
    it('市值 = 份额 × 净值；盈亏 = 市值 − 成本', () => {
      const v = valuateHolding({
        fundCode: '000001',
        totalSharesScaled: 10_000_000, // 1000 份
        totalCostCents: 150000, // 成本 1500 元
        navScaled: 16000, // 净值 1.6
      });
      expect(v.marketValueCents).toBe(160000); // 1600 元
      expect(v.pnlCents).toBe(10000); // 赚 100 元
      expect(v.costCents).toBe(150000);
      // 收益率 = 100 / 1500 ≈ 0.0667
      expect(v.pnlRate).toBeCloseTo(0.0667, 4);
    });

    it('亏损时盈亏为负', () => {
      const v = valuateHolding({
        fundCode: '000001',
        totalSharesScaled: 10_000_000,
        totalCostCents: 200000, // 成本 2000 元
        navScaled: 16000, // 市值 1600 元
      });
      expect(v.pnlCents).toBe(-40000);
      expect(v.pnlRate).toBeCloseTo(-0.2, 4);
    });

    it('成本为 0 时收益率为 0（不除零）', () => {
      const v = valuateHolding({
        fundCode: '000001',
        totalSharesScaled: 0,
        totalCostCents: 0,
        navScaled: 16000,
      });
      expect(v.marketValueCents).toBe(0);
      expect(v.pnlRate).toBe(0);
      expect(Number.isFinite(v.pnlRate)).toBe(true);
    });

    it('份额带小数时市值精确到分', () => {
      const v = valuateHolding({
        fundCode: '000001',
        totalSharesScaled: 6_568_133, // 656.8133 份
        totalCostCents: 98522,
        navScaled: 15000, // 1.5
      });
      // 656.8133 × 1.5 = 985.21995 元 → 98522 分
      expect(v.marketValueCents).toBe(98522);
    });
  });

  describe('valuatePortfolio 组合汇总', () => {
    it('总资产 = 持仓市值合计 + 现金', () => {
      const holdings = [
        valuateHolding({
          fundCode: 'A',
          totalSharesScaled: 10_000_000,
          totalCostCents: 150000,
          navScaled: 16000,
        }),
        valuateHolding({
          fundCode: 'B',
          totalSharesScaled: 5_000_000,
          totalCostCents: 90000,
          navScaled: 20000,
        }),
      ];
      const p = valuatePortfolio(holdings, 500000); // 现金 5000 元

      expect(p.marketValueCents).toBe(160000 + 100000);
      expect(p.cashCents).toBe(500000);
      expect(p.totalAssetCents).toBe(260000 + 500000);
      expect(p.totalPnlCents).toBe(10000 + 10000);
      // 总收益率 = 总盈亏 / 总成本 = 20000 / 240000
      expect(p.totalPnlRate).toBeCloseTo(0.0833, 4);
    });

    it('空持仓时只剩现金，收益率为 0', () => {
      const p = valuatePortfolio([], 10_000_000);
      expect(p.marketValueCents).toBe(0);
      expect(p.totalAssetCents).toBe(10_000_000);
      expect(p.totalPnlCents).toBe(0);
      expect(p.totalPnlRate).toBe(0);
    });
  });

  describe('reconcile 持仓对账', () => {
    it('Σ批次 与 holding 一致时通过', () => {
      const ok = reconcile(
        [
          { sharesScaled: 6_000_000, costCents: 90000 },
          { sharesScaled: 4_000_000, costCents: 60000 },
        ],
        { totalSharesScaled: 10_000_000, totalCostCents: 150000 },
      );
      expect(ok).toBe(true);
    });

    it('份额差一点就不通过', () => {
      const ok = reconcile(
        [{ sharesScaled: 9_999_999, costCents: 150000 }],
        { totalSharesScaled: 10_000_000, totalCostCents: 150000 },
      );
      expect(ok).toBe(false);
    });

    it('成本差一分就不通过', () => {
      const ok = reconcile(
        [{ sharesScaled: 10_000_000, costCents: 149999 }],
        { totalSharesScaled: 10_000_000, totalCostCents: 150000 },
      );
      expect(ok).toBe(false);
    });

    it('空批次对应零持仓时通过', () => {
      expect(
        reconcile([], { totalSharesScaled: 0, totalCostCents: 0 }),
      ).toBe(true);
    });
  });
});
