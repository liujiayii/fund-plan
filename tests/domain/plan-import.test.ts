import { describe, expect, it } from "vitest";
import { parsePlanText, planDateWarnings } from "~/domain/plan-import";

/**
 * 公众号原文的解析口径。
 *
 * 用例里的文本是 2026-10-20 的真实原文（含原文自带的空格错位），
 * 不是理想化重写的样本——解析器要扛的是真实粘贴结果。
 */

const SAMPLE = `时间：2026年10月20日

品种：
• 沪港深红利低波动，919元
• 优选300，919元
• 自由现金流，965元
• 中证医疗，998元
• 生物科技，990元
• 中证白酒 ，1239元
• 消费龙头 ，964元
• 恒生科技，1060元
• 港股科技，1064元`;

describe("parsePlanText", () => {
  it("解析真实原文：日期 + 9 行 + 合计", () => {
    const r = parsePlanText(SAMPLE);
    expect(r.periodDate).toBe("2026-10-20");
    expect(r.warnings).toEqual([]);
    expect(r.items).toHaveLength(9);
    expect(r.items[0]).toEqual({ alias: "沪港深红利低波动", amountCents: 91_900 });
    // 原文自带「中证白酒 ，1239元」这种名称后多一个空格的情况
    expect(r.items[5]).toEqual({ alias: "中证白酒", amountCents: 123_900 });
    expect(r.items.reduce((s, i) => s + i.amountCents, 0)).toBe(911_800);
  });

  it("容忍项目符号与逗号的变体，也收千分位与小数", () => {
    const r = parsePlanText(
      "时间:2026年1月5日\n- 中证白酒,1000元\n* 恒生科技，1,060元\n· 港股科技，99.5元",
    );
    expect(r.periodDate).toBe("2026-01-05");
    expect(r.items.map(i => i.alias)).toEqual(["中证白酒", "恒生科技", "港股科技"]);
    expect(r.items.map(i => i.amountCents)).toEqual([100_000, 106_000, 9950]);
  });

  it("日期不存在时置 null 并警告（dayjs 会静默顺延，必须回写比对）", () => {
    const r = parsePlanText("时间：2026年2月30日\n• 中证白酒，1000元");
    expect(r.periodDate).toBeNull();
    expect(r.warnings[0]).toContain("不是有效日期");
  });

  it("没有日期行也照常解析品种，只是没有期次", () => {
    const r = parsePlanText("• 中证白酒，1000元");
    expect(r.periodDate).toBeNull();
    expect(r.items).toHaveLength(1);
  });

  it("金额非正数与重复别名都跳过并警告", () => {
    const r = parsePlanText(
      "时间：2026年10月20日\n• 中证白酒，0元\n• 恒生科技，1000元\n• 恒生科技，500元",
    );
    expect(r.items.map(i => i.alias)).toEqual(["恒生科技"]);
    expect(r.warnings.some(w => w.includes("金额不是正数"))).toBe(true);
    expect(r.warnings.some(w => w.includes("重复出现"))).toBe(true);
  });

  it("带「元」却没解析出来的行会警告，不静默丢弃", () => {
    // 少一只基金比报错危险得多：导入的价值就是省掉人工比对
    const r = parsePlanText(
      "时间：2026年10月20日\n• 中证白酒，1239元\n• 恒生科技 1060元（场内）\n• 港股科技，1 064元",
    );
    expect(r.items).toHaveLength(1);
    expect(r.warnings.some(w => w.includes("恒生科技 1060元（场内）"))).toBe(true);
    // 空格当千分位会把「1」留在名称里、把「064」当 64 元——必须拒绝而不是猜
    expect(r.warnings.some(w => w.includes("港股科技，1 064元"))).toBe(true);
  });

  it("名称以数字结尾 + 半角逗号分隔：不能把名称尾数吞进金额", () => {
    // 反扫会跨过半角逗号：「沪深300,1000元」若不设防会变成「沪深 + 300 万元」
    const r = parsePlanText(
      "时间：2026年10月20日\n• 沪深300,1000元\n• 中证500,1,000元",
    );
    expect(r.items).toHaveLength(0);
    expect(r.warnings.filter(w => w.includes("没有识别出金额"))).toHaveLength(2);
  });

  it("全角逗号或空格分隔时，数字结尾的名称照常解析", () => {
    const r = parsePlanText(
      "时间：2026年10月20日\n• 沪深300，1000元\n• 中证500 ,1,000元",
    );
    expect(r.items).toEqual([
      { alias: "沪深300", amountCents: 100_000 },
      { alias: "中证500", amountCents: 100_000 },
    ]);
  });

  it("空文本给一条可读的警告，不抛", () => {
    const r = parsePlanText("");
    expect(r.items).toEqual([]);
    expect(r.warnings.some(w => w.includes("没有识别出品种行"))).toBe(true);
  });
});

describe("planDateWarnings", () => {
  it("周二且不晚于今天：无警告", () => {
    expect(planDateWarnings("2026-10-20", "2026-10-20")).toEqual([]);
  });

  it("非周二与未来日期各给一条提示（不阻断，补录场景要用）", () => {
    expect(planDateWarnings("2026-10-21", "2026-10-21")[0]).toContain("不是周二");
    expect(planDateWarnings("2026-10-27", "2026-10-20")[0]).toContain("在未来");
  });

  it("日期缺失时提示手动确认", () => {
    expect(planDateWarnings(null, "2026-10-20")).toHaveLength(1);
  });
});
