import { describe, expect, it } from "vitest";
import { fmtYuan } from "~/components/ui/format";

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
