import { describe, expect, it } from "vitest";
import {
  centsToYuan,
  multiplyCents,
  NAV_SCALE,
  navFromText,
  navToDisplay,
  percentToRate,
  RATE_SCALE,
  rateToPercent,
  roundInt,
  safeRate,
  SHARE_SCALE,
  sharesToDisplay,
  YUAN,
  yuanToCents,
} from "~/domain/money";

/**
 * 精度是金融系统的命门。这组测试专门盯浮点陷阱：
 * 任何 0.1+0.2 之类的经典误差都必须被 decimal.js 吃掉。
 */
describe("money 精度换算", () => {
  it("缩放常量符合设计文档约定", () => {
    expect(YUAN).toBe(100);
    expect(SHARE_SCALE).toBe(10000);
    expect(NAV_SCALE).toBe(10000);
    expect(RATE_SCALE).toBe(10000);
  });

  describe("yuanToCents 元转分", () => {
    it("整数元正确转换", () => {
      expect(yuanToCents("100.00")).toBe(10000);
      expect(yuanToCents(100)).toBe(10000);
      expect(yuanToCents("1")).toBe(100);
    });

    it("吃掉浮点误差：0.1 + 0.2 应得 30 分而非 30.000000000000004", () => {
      expect(yuanToCents(0.1 + 0.2)).toBe(30);
    });

    it("两位小数精确保留", () => {
      expect(yuanToCents("99.99")).toBe(9999);
      expect(yuanToCents("0.01")).toBe(1);
    });

    it("超过两位小数按四舍五入到分", () => {
      expect(yuanToCents("1.005")).toBe(101); // 100.5 分 → 101
      expect(yuanToCents("1.004")).toBe(100);
    });

    it("10 万元初始本金转换正确", () => {
      expect(yuanToCents(100000)).toBe(10_000_000);
    });
  });

  describe("centsToYuan 分转元展示", () => {
    it("固定两位小数", () => {
      expect(centsToYuan(10000)).toBe("100.00");
      expect(centsToYuan(1)).toBe("0.01");
      expect(centsToYuan(0)).toBe("0.00");
    });

    it("负数（出账）正常展示", () => {
      expect(centsToYuan(-10000)).toBe("-100.00");
    });

    it("大额不使用科学计数法", () => {
      expect(centsToYuan(10_000_000)).toBe("100000.00");
    });
  });

  describe("navToDisplay 净值展示", () => {
    it("固定四位小数", () => {
      expect(navToDisplay(12345)).toBe("1.2345");
      expect(navToDisplay(10000)).toBe("1.0000");
      expect(navToDisplay(5)).toBe("0.0005");
    });
  });

  describe("sharesToDisplay 份额展示", () => {
    it("默认两位小数", () => {
      expect(sharesToDisplay(6568133)).toBe("656.81");
      expect(sharesToDisplay(10000)).toBe("1.00");
    });
  });

  describe("rateToPercent 费率展示", () => {
    it("万分之转百分比字符串", () => {
      expect(rateToPercent(150)).toBe("1.50%");
      expect(rateToPercent(15)).toBe("0.15%");
      expect(rateToPercent(0)).toBe("0.00%");
    });
  });

  describe("multiplyCents 金额乘比例", () => {
    it("按比例计算并四舍五入到分", () => {
      expect(multiplyCents(10000, "0.015")).toBe(150);
      expect(multiplyCents(100000, "0.005")).toBe(500);
    });

    it("结果有小数时四舍五入", () => {
      // 12345 分 × 0.5% = 61.725 分 → 62
      expect(multiplyCents(12345, "0.005")).toBe(62);
    });

    it("比例为 0 得 0", () => {
      expect(multiplyCents(10000, 0)).toBe(0);
    });
  });

  describe("roundInt 统一取整", () => {
    it("四舍五入（HALF_UP，不是 JS 默认的银行家舍入）", () => {
      expect(roundInt("1.5")).toBe(2);
      expect(roundInt("2.5")).toBe(3); // 若用银行家舍入会得 2，这里必须是 3
      expect(roundInt("1.4")).toBe(1);
      expect(roundInt("-1.5")).toBe(-2);
    });
  });

  describe("percentToRate / navFromText 把用户输入的文本缩放成整数", () => {
    it("百分比文本 ×100 取整：1.005% → 101 万分之（Number() 会错算成 100）", () => {
      expect(percentToRate("1.005")).toBe(101);
      expect(percentToRate("1.50")).toBe(150);
      expect(percentToRate("0")).toBe(0);
      expect(percentToRate(" 2.5 ")).toBe(250);
    });

    it("净值文本 ×10000 取整：1.2345 → 12345", () => {
      expect(navFromText("1.2345")).toBe(12345);
      expect(navFromText("1.0")).toBe(10000);
    });

    it("非法文本直接抛，由调用方兜住（页面给提示，而不是静默出 0）", () => {
      expect(() => percentToRate("abc")).toThrow();
      expect(() => navFromText("")).toThrow();
    });
  });

  /**
   * 收益率的唯一除法入口。「分母为零怎么办」此前在领域层与组件里各写一遍
   * （leaderboard 给 0、总览卡给 null、portfolio 给 0），同一个名字三种语义
   * 就是口径分裂的来源——现在统一成「返回 null，由调用方决定显示 — 还是 0」。
   */
  describe("safeRate 收益率收口", () => {
    it("正常除法走 Decimal，不引入浮点尾差", () => {
      expect(safeRate(348, 100_000)).toBeCloseTo(0.00348, 12);
      expect(safeRate(-77087, 10_000_000)).toBeCloseTo(-0.0077087, 12);
    });

    it("分母为 0 返回 null（而不是 0 或 Infinity）", () => {
      expect(safeRate(100, 0)).toBeNull();
      expect(safeRate(0, 0)).toBeNull();
    });

    it("分子为 0 分母非 0 是「真的 0%」，不是 null", () => {
      expect(safeRate(0, 10_000)).toBe(0);
    });

    it("负数分母也照常算（防御性：不该出现，但不能出 NaN）", () => {
      expect(safeRate(10, -100)).toBeCloseTo(-0.1, 12);
    });
  });
});
