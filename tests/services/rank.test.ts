import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "~/db/client";
import {
  account,
  checkin,
  dcaPlan,
  fund,
  fundNav,
  holding,
  orders,
  session,
  shareLot,
  transactions,
  user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getFundRank } from "~/services/rank-service";

/**
 * 排行榜服务集成测试。用真实 workerd + 真实 D1 + 真实 KV 跑，
 * 覆盖三条路径：东财有数据直用、东财挂本地降级、本地无该类型空态。
 *
 * ⚠️ fetchFundRank 用 KV 缓存（key 形如 `fund:rank:hh:1yzf`），
 * 测试间若不清理会互相污染——test 1 缓存了 hh/1m 的远程结果，
 * test 2 同 key 会命中缓存不走 fetch，断言本地降级就挂了。
 * 所以 resetAll 里除了清表还要清掉排行榜相关 KV。
 */

/** 排行榜所有可能的 KV key（类型 × 周期排序码，共 12 个） */
const RANK_KV_KEYS = [
  ...["gp", "hh", "zs", "zq"].flatMap(ft =>
    ["1yzf", "3yzf", "1nzf"].map(sc => `fund:rank:${ft}:${sc}`),
  ),
];

/** 每个用例前：清空所有用户表 + 基金表 + 排行榜 KV 缓存 */
async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [
    transactions,
    shareLot,
    holding,
    orders,
    dcaPlan,
    checkin,
    session,
    account,
    user,
    fundNav,
    fund,
  ])
    await db.delete(t);
  // 清掉排行榜 KV，避免上一条的远程缓存污染下一条的本地降级断言
  for (const key of RANK_KV_KEYS)
    await env.KV.delete(key);
}

/** 预置一只基金档案 + 多条净值（避免测试走真网络拉东财） */
async function seedFundWithNav(
  code: string,
  name: string,
  type: string,
  navs: [string, number][],
) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name,
    type,
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
  for (const [d, nv] of navs)
    await db.insert(fundNav).values({ fundCode: code, navDate: d, unitNav: nv, accNav: nv, growthRate: 0 });
}

beforeEach(resetAll);

describe("getFundRank 本地降级", () => {
  it("东财有数据时直用远程结果（fetch stub）", async () => {
    const db = getDb(env.DB);
    // rankhandler 真实响应形状：`var rankData = {datas:["..."],...};`
    // 字段顺序：代码,简称,简拼,净值日期,单位净值,累计净值,日涨跌,近1月(列8),...
    const rankResp = `var rankData = {datas:["018751,山证混合C,SZ,2026-08-25,1.4142,1.4142,-2.63,10.67,36.03"]};`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rankResp)));
    const r = await getFundRank(db, env, "hh", "1m");
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe("018751");
    vi.unstubAllGlobals();
  });

  it("东财挂掉时本地降级：按类型前缀过滤 + 周期收益降序", async () => {
    const db = getDb(env.DB);
    // 两只混合型：A 涨得多（近1月 +20%），B 涨得少（近1月 +5%）
    await seedFundWithNav("000001", "基金A", "混合型-灵活", [
      ["2026-07-25", 10000],
      ["2026-08-25", 12000],
    ]);
    await seedFundWithNav("000002", "基金B", "混合型-灵活", [
      ["2026-07-25", 10000],
      ["2026-08-25", 10500],
    ]);
    // 一只股票型，不应出现在混合榜里
    await seedFundWithNav("000003", "基金C", "股票型", [
      ["2026-07-25", 10000],
      ["2026-08-25", 13000],
    ]);

    // 东财返回空 → 走本地
    vi.stubGlobal("fetch", vi.fn(async () => new Response("var rankData = {datas:[]};")));
    const r = await getFundRank(db, env, "hh", "1m");
    expect(r.map(x => x.code)).toEqual(["000001", "000002"]); // A 在前
    expect(r[0].periodRate).toBeGreaterThan(r[1].periodRate!);
    // 股票型 000003 不在混合榜
    expect(r.find(x => x.code === "000003")).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("本地降级且无该类型基金时返回空（页面显示空态，不报错）", async () => {
    const db = getDb(env.DB);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("var rankData = {datas:[]};")));
    const r = await getFundRank(db, env, "zq", "1m"); // 库里无债券型
    expect(r).toEqual([]);
    vi.unstubAllGlobals();
  });
});
