import { describe, expect, it } from "vitest";
import { costBasisNavScaled } from "~/domain/portfolio";

/**
 * 成本价兜底净值 —— getPortfolio / getHoldingDetail 无净值时的估值口径。
 *
 * 背景：此前两处在 service 内联了 `Math.round((cost / shares) * 10000 * 100) / 100`
 * 的兜底公式，缺一个 ×100 缩放（算出的 navScaled 差百倍，兜底市值被低估为
 * 成本的 1/100）。抽成本 domain 纯函数统一收口，本测试钉住正确公式。
 *
 * 正确推导：成本价（元/份）= 成本（分）/100 ÷ 份额；
 * navScaled（×10000）= 成本价 × 10000 = costCents × 10000 × 100 / sharesScaled。
 */
describe("costBasisNavScaled", () => {
  it("2000 份成本 2000 元：兜底净值恰为 1.0000", () => {
    // costCents=200000、sharesScaled=20000000（2000 份）
    // 200000 × 1000000 / 20000000 = 10000（×10000 即 1.0000）
    expect(costBasisNavScaled(200000, 20000000)).toBe(10000);
  });

  it("市值 = 成本：份额乘回去不亏不赚（兜底语义的回归验证）", () => {
    // 任意一组数据，兜底净值 × 份额 = 成本（允许 HALF_UP 到分的舍入）
    const cost = 345678;
    const shares = 12345678;
    const nav = costBasisNavScaled(cost, shares);
    // 市值 = shares/10000 × nav/10000 × 100（分）
    const mv = Math.round((shares / 10000) * (nav / 10000) * 100);
    expect(Math.abs(mv - cost)).toBeLessThanOrEqual(1);
  });

  it("份额为 0 时返回默认净值 10000（避免除零）", () => {
    expect(costBasisNavScaled(0, 0)).toBe(10000);
  });

  it("四舍五入 HALF_UP 到 ×10000 整数", () => {
    // 3 份（×10000=30000）成本 1000.01 元（=100001 分）：
    // 每份 333.336666… 元 → 3333366.67 → HALF_UP → 3333367
    expect(costBasisNavScaled(100001, 30000)).toBe(3333367);
  });
});
