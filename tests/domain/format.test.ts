import { describe, expect, it } from "vitest";
import { fmtRate, fmtSignedYuan, fmtYuan } from "~/components/ui/format";

/**
 * 被测模块住在 `app/components/ui/`，测试却放 `tests/domain/` ——
 * 因为 `vitest.config.ts` 只 include `tests/domain/**` 与 `tests/smoke.test.ts`，
 * 而 `fmtYuan` 是不碰 DOM 的纯字符串函数，node 环境跑得最快。
 */
describe("fmtYuan 千分位", () => {
  it("四位数以上插逗号", () => {
    expect(fmtYuan(1000000)).toBe("10,000.00");
    expect(fmtYuan(12845066)).toBe("128,450.66");
    expect(fmtYuan(100000000)).toBe("1,000,000.00");
  });

  it("三位数及以下不插", () => {
    expect(fmtYuan(0)).toBe("0.00");
    expect(fmtYuan(99999)).toBe("999.99");
  });

  it("负数的逗号插在数字里而不是符号后", () => {
    expect(fmtYuan(-12845066)).toBe("-128,450.66");
    expect(fmtYuan(-100)).toBe("-1.00");
  });

  it("恰好千位边界", () => {
    expect(fmtYuan(99999 + 1)).toBe("1,000.00");
  });
});

describe("fmtSignedYuan 带符号金额", () => {
  it("正数补 +，负数用自带的 -", () => {
    expect(fmtSignedYuan(12845066)).toBe("+128,450.66");
    expect(fmtSignedYuan(-12845066)).toBe("-128,450.66");
  });

  it("0 不加符号（既不 +0.00 也不 -0.00）", () => {
    expect(fmtSignedYuan(0)).toBe("0.00");
  });
});

/**
 * 收益率展示：修掉线上实测的两个症状——
 * 「赚了 3.48 元但收益率显示 0.00%」与「负数渲染成 -0.00%」。
 */
describe("fmtRate 收益率（不抹零、不产 -0.00%）", () => {
  it("常规正负值照常两位小数", () => {
    expect(fmtRate(0.0231)).toBe("+2.31%");
    expect(fmtRate(-0.0231)).toBe("-2.31%");
    expect(fmtRate(0.5)).toBe("+50.00%");
  });

  it("恰好 0 显示 0.00%（不是 <+0.01%）", () => {
    expect(fmtRate(0)).toBe("0.00%");
  });

  it("极小正收益用 <+0.01% 而不是 0.00%（线上那个 3.48 元 / 10 万本金）", () => {
    // 3.48 / 100000 = 0.0000348 → ×100 = 0.00348% → 会被 toFixed(2) 抹成 0.00
    expect(fmtRate(0.0000348)).toBe("<+0.01%");
    expect(fmtRate(0.00004)).toBe("<+0.01%");
  });

  it("极小负收益用 >-0.01%，绝不出现 -0.00%", () => {
    expect(fmtRate(-0.0000348)).toBe(">-0.01%");
    // 曾经的 bug：rate > 0 为假 → 不加 +，toFixed(2) 得 "0.00" → 拼成 "-0.00%"
    expect(fmtRate(-0.00004)).not.toBe("-0.00%");
  });

  it("刚好到 0.005% 的量级就给真数字，不再用不等号", () => {
    // 0.0001 → ×100 = 0.01% → "0.01"，已不是 0.00
    expect(fmtRate(0.0001)).toBe("+0.01%");
    expect(fmtRate(-0.0001)).toBe("-0.01%");
  });
});
