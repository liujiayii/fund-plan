import { describe, expect, it } from "vitest";
import {
  allocateByWeight,
  bpsToInputText,
  currentPlanDay,
  isPlanDay,
  latestPlanPeriod,
  parsePlanQuery,
  PLAN_DEFAULT_RATIO_BPS,
  PLAN_RATIO_MAX_BPS,
  planTargetCents,
} from "~/domain/undervalued-plan";

/**
 * 「低估指数定投计划」页的口径与换算。
 *
 * 这里最该钉死的是 `allocateByWeight` 的**和不变式**：页面上九个数字加起来
 * 必须恰好等于用户自己填的总额。差一分不是审美问题，是金融页面上的信任问题。
 */

/** 图 1 那期主理人的九笔买入金额（分），真实感比随手编的数字更能压出余数边界 */
const MASTER_AMOUNTS = [98500, 100000, 98700, 130600, 92400, 96300, 96600, 91600, 94100];

/** 简易 QueryGetter，省得每个用例都 new URLSearchParams */
function q(map: Record<string, string>) {
  return { get: (name: string) => map[name] ?? null };
}

describe("isPlanDay", () => {
  it("周二为真、其余为假", () => {
    // 2026-09-22 是周二（本期示例日期），前后一天分别是周一 / 周三
    expect(isPlanDay("2026-09-22")).toBe(true);
    expect(isPlanDay("2026-09-15")).toBe(true);
    expect(isPlanDay("2026-09-21")).toBe(false);
    expect(isPlanDay("2026-09-23")).toBe(false);
    // 周末
    expect(isPlanDay("2026-09-20")).toBe(false);
    expect(isPlanDay("2026-09-19")).toBe(false);
  });

  it("格式不对的日期一律为假（脏日期不进字符串比较）", () => {
    expect(isPlanDay("")).toBe(false);
    expect(isPlanDay("2026-9-22")).toBe(false);
    expect(isPlanDay("2026/09/22")).toBe(false);
    expect(isPlanDay("abc")).toBe(false);
    expect(isPlanDay("2026-09-22T10:00:00")).toBe(false);
  });
});

describe("latestPlanPeriod", () => {
  it("取不晚于今天、最近一个有买入的周二", () => {
    expect(
      latestPlanPeriod(["2026-09-08", "2026-09-15", "2026-09-21"], "2026-09-22"),
    ).toBe("2026-09-15");
  });

  it("本期（今天）买过就取今天——「主理人买入后实时更新」", () => {
    expect(
      latestPlanPeriod(["2026-09-15", "2026-09-22"], "2026-09-22"),
    ).toBe("2026-09-22");
  });

  it("今天已是周二但还没买：停在上一期，而不是给一张空表", () => {
    expect(
      latestPlanPeriod(["2026-09-08", "2026-09-15"], "2026-09-22"),
    ).toBe("2026-09-15");
  });

  it("只认周二的买入：周三、周末的加仓不纳入本计划", () => {
    expect(
      latestPlanPeriod(["2026-09-16", "2026-09-19", "2026-09-21"], "2026-09-22"),
    ).toBeNull();
  });

  it("未来的单子不算", () => {
    expect(latestPlanPeriod(["2026-09-29"], "2026-09-22")).toBeNull();
  });

  it("没有记录 / 全是脏日期 → null（页面据此走空态）", () => {
    expect(latestPlanPeriod([], "2026-09-22")).toBeNull();
    expect(latestPlanPeriod(["", "garbage", "2026-13-40"], "2026-09-22")).toBeNull();
  });

  it("不看顺序：入参乱序也取最大的那个周二", () => {
    expect(
      latestPlanPeriod(["2026-09-15", "2026-08-04", "2026-09-01"], "2026-09-22"),
    ).toBe("2026-09-15");
  });
});

describe("currentPlanDay", () => {
  it("今天就是周二：取今天", () => {
    expect(currentPlanDay("2026-09-22")).toBe("2026-09-22");
  });

  it("本周其余几天：退到本周二", () => {
    expect(currentPlanDay("2026-09-21")).toBe("2026-09-15"); // 周一
    expect(currentPlanDay("2026-09-20")).toBe("2026-09-15"); // 周日
    expect(currentPlanDay("2026-09-23")).toBe("2026-09-22"); // 周三
    expect(currentPlanDay("2026-09-27")).toBe("2026-09-22"); // 周日
  });

  it("跨月跨年也对（周日属于上一个自然周）", () => {
    // 2026-10-01 是周四，本周二是 09-29
    expect(currentPlanDay("2026-10-01")).toBe("2026-09-29");
    // 2027-01-01 是周五，本周二是 2026-12-29
    expect(currentPlanDay("2027-01-01")).toBe("2026-12-29");
  });

  it("格式不对给 null（页面据此不写「停留」那句提示）", () => {
    expect(currentPlanDay("")).toBeNull();
    expect(currentPlanDay("2026/09/22")).toBeNull();
    expect(currentPlanDay("abc")).toBeNull();
  });
});

describe("planTargetCents", () => {
  it("基准金额 × 跟投比例（基准 = 主理人本期买入合计）", () => {
    // 主理人这期买了 10000 元，跟 10% → 1000 元
    expect(planTargetCents(1_000_000, 1000)).toBe(100_000);
    // 跟 1.5% → 150 元
    expect(planTargetCents(1_000_000, 150)).toBe(15_000);
    // 跟 100% = 跟他买一样多
    expect(planTargetCents(1_000_000, 10_000)).toBe(1_000_000);
    // 超过 100% 是合法用法（资金比主理人充裕时按倍数跟）
    expect(planTargetCents(1_000_000, 20000)).toBe(2_000_000);
  });

  it("四舍五入到分（走 Decimal，不碰浮点）", () => {
    // 999 元 × 3.33% = 33.2667 元 → 3326.67 分 → 3327
    expect(planTargetCents(99_900, 333)).toBe(3327);
  });

  it("零 / 负数 / 非有限值一律给 0，不抛", () => {
    expect(planTargetCents(0, 1000)).toBe(0);
    expect(planTargetCents(1_000_000, 0)).toBe(0);
    expect(planTargetCents(-1, 1000)).toBe(0);
    expect(planTargetCents(Number.NaN, 1000)).toBe(0);
    expect(planTargetCents(1_000_000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("allocateByWeight", () => {
  const weights = MASTER_AMOUNTS.map((c, i) => ({
    fundCode: String(100000 + i),
    weightCents: c,
  }));

  it("Σ分配 == 目标总额（一分不差）—— 这是本函数存在的理由", () => {
    // 挑几个除不尽的总额：8988 元的权重表配上都不是整数倍的目标
    for (const target of [100_000, 3333, 89_880, 1, 7, 12_345]) {
      const sum = allocateByWeight(weights, target).reduce((s, a) => s + a.amountCents, 0);
      expect(sum, `target=${target}`).toBe(target);
    }
  });

  it("每笔与精确值相差不到 1 分（最大余数法只挪小数部分）", () => {
    const target = 100_000;
    const total = MASTER_AMOUNTS.reduce((s, v) => s + v, 0);
    const out = allocateByWeight(weights, target);
    out.forEach((a, i) => {
      const exact = (target * MASTER_AMOUNTS[i]!) / total;
      expect(Math.abs(a.amountCents - exact)).toBeLessThan(1);
    });
  });

  it("权重大的分到的多（按主理人金额占比，不是平均分）", () => {
    const out = allocateByWeight(weights, 898_800);
    // 权重最大的那只（1306 元）应该拿到最多，最小的那只（924 元）拿到最少
    const maxIdx = MASTER_AMOUNTS.indexOf(Math.max(...MASTER_AMOUNTS));
    const minIdx = MASTER_AMOUNTS.indexOf(Math.min(...MASTER_AMOUNTS));
    expect(out[maxIdx]!.amountCents).toBeGreaterThan(out[minIdx]!.amountCents);
    // 目标是权重和本身时，分配应当几乎等于权重本身
    expect(out[maxIdx]!.amountCents).toBe(130_600);
  });

  it("余数按下标先后补，顺序稳定（刷新两次不会换人加这一分）", () => {
    const three = [1, 1, 1].map((w, i) => ({ fundCode: `f${i}`, weightCents: w }));
    expect(allocateByWeight(three, 100).map(a => a.amountCents)).toEqual([34, 33, 33]);
    expect(allocateByWeight(three, 100).map(a => a.amountCents)).toEqual([34, 33, 33]);
  });

  it("输出顺序与入参一致（页面按主理人的买入顺序展示）", () => {
    const out = allocateByWeight(weights, 100_000);
    expect(out.map(a => a.fundCode)).toEqual(weights.map(w => w.fundCode));
  });

  it("权重全为 0 / 空表 / 目标为 0 时给零，不编数字、不除零", () => {
    const zeros = weights.map(w => ({ ...w, weightCents: 0 }));
    expect(allocateByWeight(zeros, 100_000).every(a => a.amountCents === 0)).toBe(true);
    expect(allocateByWeight([], 100_000)).toEqual([]);
    expect(allocateByWeight(weights, 0).every(a => a.amountCents === 0)).toBe(true);
    expect(allocateByWeight(weights, -1).every(a => a.amountCents === 0)).toBe(true);
  });

  it("负权重当成 0（脏数据不许反向吃掉别人的份额）", () => {
    const dirty = [
      { fundCode: "a", weightCents: 100 },
      { fundCode: "b", weightCents: -50 },
    ];
    const out = allocateByWeight(dirty, 1000);
    expect(out[0]!.amountCents).toBe(1000);
    expect(out[1]!.amountCents).toBe(0);
  });
});

describe("parsePlanQuery", () => {
  it("不带参数：用默认值，且不弹提示（首屏就该有数字）", () => {
    const r = parsePlanQuery(q({}));
    expect(r.ratioBps).toBe(PLAN_DEFAULT_RATIO_BPS);
    expect(r.notices).toEqual([]);
  });

  it("正常参数：百分比是人话单位，与输入框所见一致", () => {
    const r = parsePlanQuery(q({ ratio: "50" }));
    expect(r.ratioBps).toBe(5000);
    expect(r.notices).toEqual([]);
  });

  it("带小数：3.33% → 333 万分之", () => {
    expect(parsePlanQuery(q({ ratio: "3.33" })).ratioBps).toBe(333);
  });

  it("比例可以超过 100%（资金比主理人充裕时按倍数跟）", () => {
    expect(parsePlanQuery(q({ ratio: "200" })).ratioBps).toBe(20_000);
    expect(parsePlanQuery(q({ ratio: "200" })).notices).toEqual([]);
  });

  it("非数字与 NaN 都回落默认值并给提示（不静默改口径、也不 500）", () => {
    for (const bad of ["abc", "NaN", "Infinity"]) {
      const r = parsePlanQuery(q({ ratio: bad }));
      expect(r.ratioBps, bad).toBe(PLAN_DEFAULT_RATIO_BPS);
      expect(r.notices, bad).toHaveLength(1);
      expect(r.notices[0]).toContain("跟投比例");
    }
  });

  it("越界收到上边界而非掉回默认值（填 800% 却按 10% 算会莫名其妙）", () => {
    const r = parsePlanQuery(q({ ratio: "800" }));
    expect(r.ratioBps).toBe(PLAN_RATIO_MAX_BPS);
    expect(r.notices[0]).toContain("500%");
  });

  it("比例小到四舍五入成 0 时也回落（0.001% 等于没投）", () => {
    const r = parsePlanQuery(q({ ratio: "0.001" }));
    expect(r.ratioBps).toBe(PLAN_DEFAULT_RATIO_BPS);
    expect(r.notices).toHaveLength(1);
    // 0.005% 四舍五入到 1 万分之，是合法的最小档
    expect(parsePlanQuery(q({ ratio: "0.005" })).ratioBps).toBe(1);
  });

  it("0 / 负数一律回落默认值", () => {
    expect(parsePlanQuery(q({ ratio: "0" })).ratioBps).toBe(PLAN_DEFAULT_RATIO_BPS);
    expect(parsePlanQuery(q({ ratio: "-1" })).ratioBps).toBe(PLAN_DEFAULT_RATIO_BPS);
  });

  it("只管 ratio：URL 上多余的参数（比如老的 capital）不影响结果", () => {
    const r = parsePlanQuery(q({ capital: "20000", ratio: "20" }));
    expect(r.ratioBps).toBe(2000);
    expect(r.notices).toEqual([]);
  });
});

describe("输入框文本", () => {
  it("比例去掉无意义的尾零", () => {
    expect(bpsToInputText(1000)).toBe("10");
    expect(bpsToInputText(150)).toBe("1.5");
    expect(bpsToInputText(1)).toBe("0.01");
  });
});
