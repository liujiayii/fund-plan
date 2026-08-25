import { describe, expect, it } from "vitest";
import { calcPurchase } from "~/domain/purchase";

/**
 * 申购「内扣法」——真实中国公募基金的费用算法。
 *
 * 关键：费用是从申购金额里「扣出来」的，不是在金额之外另加。
 *   净申购金额 = 申购金额 ÷ (1 + 申购费率)
 *   申购费用   = 申购金额 − 净申购金额
 *   确认份额   = 净申购金额 ÷ 确认日单位净值
 *
 * 常见错误实现是 `费用 = 金额 × 费率`（外扣法），会算多收费。
 */
describe("purchase 申购内扣法", () => {
  it("标准场景：1000 元、费率 1.5%、净值 1.5000", () => {
    const r = calcPurchase({
      amountCents: 100000, // 1000 元
      navScaled: 15000, // 净值 1.5000
      purchaseRate: 150, // 1.5%
    });
    expect(r.netAmountCents).toBe(98522);
    expect(r.feeCents).toBe(1478);
    expect(r.sharesScaled).toBe(6568133); // 656.8133 份
  });

  it("一分不丢：净申购 + 费用 必须精确等于申购金额", () => {
    const cases = [
      { amountCents: 100000, navScaled: 15000, purchaseRate: 150 },
      { amountCents: 99999, navScaled: 12345, purchaseRate: 15 },
      { amountCents: 1, navScaled: 10000, purchaseRate: 150 },
      { amountCents: 10_000_000, navScaled: 32167, purchaseRate: 120 },
    ];
    for (const c of cases) {
      const r = calcPurchase(c);
      expect(r.netAmountCents + r.feeCents).toBe(c.amountCents);
    }
  });

  it("内扣法与外扣法不同：费用应小于「金额×费率」", () => {
    const r = calcPurchase({
      amountCents: 100000,
      navScaled: 10000,
      purchaseRate: 150,
    });
    // 外扣法会得 1500，内扣法是 1478
    expect(r.feeCents).toBeLessThan(1500);
    expect(r.feeCents).toBe(1478);
  });

  it("费率为 0 时无费用，份额 = 金额 ÷ 净值", () => {
    const r = calcPurchase({
      amountCents: 100000, // 1000 元
      navScaled: 20000, // 净值 2.0000
      purchaseRate: 0,
    });
    expect(r.feeCents).toBe(0);
    expect(r.netAmountCents).toBe(100000);
    expect(r.sharesScaled).toBe(5_000_000); // 500 份
  });

  it("净值为 1.0000 时份额与净申购金额等值（按各自缩放）", () => {
    const r = calcPurchase({
      amountCents: 100000,
      navScaled: 10000,
      purchaseRate: 0,
    });
    expect(r.sharesScaled).toBe(10_000_000); // 1000 份
  });

  it("份额保留 4 位小数精度（×10000 取整）", () => {
    const r = calcPurchase({
      amountCents: 100000,
      navScaled: 12345, // 1.2345，除不尽
      purchaseRate: 0,
    });
    // 1000 / 1.2345 = 810.0445524... → 8100445（4 位小数）
    expect(r.sharesScaled).toBe(8100446);
    expect(Number.isInteger(r.sharesScaled)).toBe(true);
  });

  it("金额非正数时抛错", () => {
    expect(() =>
      calcPurchase({ amountCents: 0, navScaled: 10000, purchaseRate: 0 }),
    ).toThrow();
    expect(() =>
      calcPurchase({ amountCents: -100, navScaled: 10000, purchaseRate: 0 }),
    ).toThrow();
  });

  it("净值非正数时抛错（防止除零）", () => {
    expect(() =>
      calcPurchase({ amountCents: 100000, navScaled: 0, purchaseRate: 0 }),
    ).toThrow();
  });
});
