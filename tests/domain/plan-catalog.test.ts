import { describe, expect, it } from "vitest";
import { lookupPlanFund, PLAN_FUND_CATALOG } from "~/domain/plan-catalog";
import { parsePlanText } from "~/domain/plan-import";

/**
 * 品种池的完整性与查表口径。
 *
 * 这张表是「简称 → 场外代码」的唯一权威，所以两组性质都要钉住：
 *   1. 表本身健康：50 条、代码合法、没有重复（重复会让 lookup 二义）
 *   2. 查表宁缺毋滥：命中就一定是唯一正确的那条，模糊到不确定时返回 null
 *      ——错一只的代价比让人多点一次大得多
 */

describe("PLAN_FUND_CATALOG", () => {
  it("52 个品种（估值表 50 + 口述补充 2），代码全是 6 位数字", () => {
    expect(PLAN_FUND_CATALOG).toHaveLength(52);
    for (const item of PLAN_FUND_CATALOG)
      expect(item.otcCode).toMatch(/^\d{6}$/);
  });

  it("代码与简称都不重复（否则 lookup 的结果取决于数组顺序）", () => {
    const codes = PLAN_FUND_CATALOG.map(i => i.otcCode);
    const aliases = PLAN_FUND_CATALOG.map(i => i.alias);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("变异写法不能与别的条目撞车", () => {
    const seen = new Map<string, string>();
    for (const item of PLAN_FUND_CATALOG) {
      for (const name of [item.alias, ...(item.variants ?? [])]) {
        const prev = seen.get(name);
        expect(prev, `「${name}」同时出现在 ${prev} 与 ${item.alias}`).toBeUndefined();
        seen.set(name, item.alias);
      }
    }
  });
});

describe("lookupPlanFund", () => {
  it("精确命中：原文怎么写就怎么查", () => {
    expect(lookupPlanFund("中证白酒")?.otcCode).toBe("161725");
    expect(lookupPlanFund("沪深300")?.otcCode).toBe("110020");
    expect(lookupPlanFund("港股科技")?.otcCode).toBe("016495");
  });

  it("变体命中：原文「沪港深红利低波动」，表上是「沪港深红利低波」", () => {
    expect(lookupPlanFund("沪港深红利低波动")?.otcCode).toBe("007751");
    expect(lookupPlanFund("医疗")?.otcCode).toBe("162412");
    expect(lookupPlanFund("科创板")?.otcCode).toBe("021484");
  });

  it("口述补充的两条也能命中（估值表上没有，但原文里会出）", () => {
    expect(lookupPlanFund("恒生科技")?.otcCode).toBe("012348");
    expect(lookupPlanFund("生物科技")?.otcCode).toBe("501009");
  });

  it("容忍空格与全角括号", () => {
    expect(lookupPlanFund(" 中证 A50 ")?.otcCode).toBe("021212");
    expect(lookupPlanFund("MSCI（A50）")?.otcCode).toBe("015037");
  });

  it("表外品种返回 null，不猜", () => {
    expect(lookupPlanFund("半导体")).toBeNull();
    expect(lookupPlanFund("人工智能")).toBeNull();
    expect(lookupPlanFund("随便编的品种")).toBeNull();
    expect(lookupPlanFund("")).toBeNull();
  });

  it("双向包含命中多条时返回 null（歧义就让人选）", () => {
    // 「红利」同时出现在中证红利、中证红利低波动、上证红利、港股红利…里
    expect(lookupPlanFund("红利")).toBeNull();
    // 「300」同理
    expect(lookupPlanFund("300")).toBeNull();
  });
});

/**
 * 端到端回归：2026-10-20 那一期的真实原文，9 只必须全部命中。
 *
 * 这条用例是「这个功能到底成不成立」的唯一判据——只要有一只查不出来，
 * 用户就还得手动选，自动化的意义就打折了。
 */
describe("真实原文 → 代码", () => {
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

  it("9 只全部命中，一只不漏", () => {
    const { items, periodDate } = parsePlanText(SAMPLE);
    expect(periodDate).toBe("2026-10-20");
    expect(items).toHaveLength(9);

    const codes = items.map(i => lookupPlanFund(i.alias)?.otcCode ?? `未命中:${i.alias}`);
    expect(codes).toEqual([
      "007751", // 沪港深红利低波动 → 表上的「沪港深红利低波」
      "023711", // 优选300
      "024616", // 自由现金流
      "162412", // 中证医疗
      "501009", // 生物科技（口述补充）
      "161725", // 中证白酒
      "501090", // 消费龙头
      "012348", // 恒生科技（口述补充）
      "016495", // 港股科技
    ]);
  });
});
