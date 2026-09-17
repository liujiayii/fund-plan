import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, runBatch } from "~/db/client";
import { fund, fundNav } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { loader } from "~/routes/tools.dca-backtest";
import { CloudflareContext } from "../../workers/app";

/**
 * `/tools/dca-backtest` 的 loader（新工具页的数据来源）。
 *
 * 直接调 loader、不经 fetch handler：context 用伪对象——getAppContext 只消费
 * `get(CloudflareContext) → { env, ctx }`，能伪造（与 trade-route.test.ts 同款）。
 *
 * ⚠️ 净值行必须 ≥ 250 条：本页给 ensureNavHistory 的阈值是 250（按天定投的默认
 * 期数就是 250 期），少于它 loader 会去回填，那条路要连东财——集成测试里走真网络
 * = 慢且看运气（rank.test.ts 顶注的教训）。
 */

/** 伪造路由 context：与 RouterContextProvider 同形，只实现 get */
function fakeContext(): unknown {
  return {
    get: (key: unknown) =>
      key === CloudflareContext
        ? { env, ctx: { waitUntil: () => {} } }
        : undefined,
  };
}

async function load(search: string) {
  return loader({
    request: new Request(`https://x.dev/tools/dca-backtest${search}`),
    context: fakeContext(),
    params: {},
  } as never);
}

async function reset() {
  const db = getDb(env.DB);
  await db.delete(fundNav);
  await db.delete(fund);
}

beforeEach(reset);

/**
 * 造一只基金 + 连续 260 天净值（2026-01-05 周一 ~ 2026-09-21 周一）。
 * 于是同一份数据在三种频率下的可用期数是确定的：按天 260 / 按周 38 / 按月 9。
 * 累计净值刻意比单位净值高 0.1 元（分红过的基金），用来验证口径开关真的换了一列。
 */
async function seedFund(code = "000001", name = "测试成长混合", updatedAt = Date.now()) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name,
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt,
  });
  // 一条一条插（runBatch）：D1 单条语句的绑定参数有上限，260 行 × 6 列一次性塞会超
  await runBatch(
    db,
    Array.from({ length: 260 }, (_, i) => {
      const navDate = new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10);
      return db.insert(fundNav).values({
        fundCode: code,
        navDate,
        unitNav: 10000 + i * 10,
        accNav: 11000 + i * 10,
        growthRate: 0,
      });
    }),
  );
}

describe("GET /tools/dca-backtest", () => {
  it("带 code：按库里净值算出回测与逐期明细（服务端算，SSR 拿到就是结果）", async () => {
    await seedFund();
    const data = await load("?code=000001");

    expect(data.code).toBe("000001");
    expect(data.fundName).toBe("测试成长混合");
    expect(data.isDefault).toBe(false);
    expect(data.notices).toEqual([]);
    // 按月默认 12 期，但库里只有 9 个自然月 → 按 9 期算
    expect(data.availablePeriods).toBe(9);
    expect(data.backtest).not.toBeNull();
    expect(data.backtest!.periods).toBe(9);
    expect(data.backtest!.investedCents).toBe(900_000);
    expect(data.backtest!.schedule.map(s => s.navDate)).toEqual([
      "2026-01-05",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
    // 默认口径是累计净值（分红再投）：首期买入价取的是 accNav 那一列
    expect(data.backtest!.schedule[0]!.nav).toBe(11000);
    // 区间 259 天 ≥ 半年门槛：年化要算出来（净值单调上行 → 为正）
    expect(data.backtest!.annualizedRate).not.toBeNull();
  });

  it("adjust=unit 换成单位净值口径：同一只基金，买入价换一列", async () => {
    await seedFund();
    const data = await load("?code=000001&adjust=unit");
    expect(data.adjust).toBe("unit");
    expect(data.backtest!.schedule[0]!.nav).toBe(10000);
  });

  it("金额与期数可调；期数在可用范围内就按填的算", async () => {
    await seedFund();
    const data = await load("?code=000001&amount=2000&periods=6");
    expect(data.amountCents).toBe(200_000);
    expect(data.periods).toBe(6);
    expect(data.backtest!.periods).toBe(6);
    expect(data.backtest!.investedCents).toBe(1_200_000);
  });

  it("坏参数回落默认值并逐条给提示（页面把提示原样展示，不静默改口径）", async () => {
    await seedFund();
    // periods=99 现在**是合法**的（期数可自定义，硬上限 1000），所以用 99999 触发回落
    const data = await load("?code=000001&amount=abc&periods=99999&adjust=xxx");
    expect(data.notices).toHaveLength(3);
    expect(data.amountCents).toBe(100_000);
    expect(data.periods).toBe(12);
    expect(data.adjust).toBe("acc");
    // 回到默认口径后仍算得出结果——回落不等于不给结果
    expect(data.backtest!.periods).toBe(9);
  });

  it("amount=NaN 不再把页面打成 500（decimal.js 会收下 NaN，只判 null 挡不住）", async () => {
    await seedFund();
    const data = await load("?code=000001&amount=NaN");
    expect(data.notices).toHaveLength(1);
    expect(data.notices[0]).toContain("每期金额请填数字");
    expect(data.amountCents).toBe(100_000);
    // 关键是这一条：坏金额回落后照样给出回测结果，而不是抛 500
    expect(data.backtest).not.toBeNull();
    expect(data.backtest!.periods).toBe(9);
  });

  it("freq=week：按自然周买，可用期数按自然周数算", async () => {
    await seedFund();
    const data = await load("?code=000001&freq=week&periods=3");
    expect(data.frequency).toBe("week");
    // 2026-01-05（周一）起连续 260 天 = 38 个自然周
    expect(data.availablePeriods).toBe(38);
    expect(data.backtest!.frequency).toBe("week");
    expect(data.backtest!.periods).toBe(3);
    // 最近 3 期的买入日 = 最后三周的周一
    expect(data.backtest!.schedule.map(s => s.navDate)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
    ]);
  });

  it("freq=day：默认 250 期、库里 260 个交易日 → 按 250 期算", async () => {
    await seedFund();
    const data = await load("?code=000001&freq=day");
    expect(data.frequency).toBe("day");
    expect(data.availablePeriods).toBe(260);
    expect(data.periods).toBe(250);
    expect(data.backtest!.periods).toBe(250);
    expect(data.backtest!.investedCents).toBe(25_000_000);
    expect(data.backtest!.from).toBe("2026-01-15");
    expect(data.backtest!.annualizedRate).not.toBeNull();
  });

  it("freq=day 且期数自定义：只取最近 N 个交易日", async () => {
    await seedFund();
    const data = await load("?code=000001&freq=day&periods=5");
    expect(data.backtest!.periods).toBe(5);
    expect(data.backtest!.schedule.map(s => s.navDate)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ]);
  });

  it("没带 code 但库里有基金：用最近更新过的那只当默认标的，并标记 isDefault", async () => {
    await seedFund();
    const data = await load("");
    expect(data.code).toBe("000001");
    expect(data.isDefault).toBe(true);
    expect(data.backtest).not.toBeNull();
    // 默认标的同样要能算出回测：被 sitemap 收录的是不带参数的这一版
    expect(data.backtest!.periods).toBe(9);
  });

  it("默认标的取最近更新过的那只，而不是先插的那只", async () => {
    await seedFund("110022", "易方达消费", Date.now() - 60_000);
    await seedFund("000001", "华夏成长", Date.now());
    const data = await load("");
    expect(data.code).toBe("000001");
    expect(data.fundName).toBe("华夏成长");
  });

  it("库是空的（全新部署）：不炸，给出「先选基金」的空态", async () => {
    const data = await load("");
    expect(data.code).toBe("");
    expect(data.fundName).toBe("");
    expect(data.backtest).toBeNull();
    expect(data.results).toEqual([]);
    expect(data.notices).toEqual([]);
  });
});
