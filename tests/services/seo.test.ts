import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { fund, fundNav } from "~/db/schema";
import { listFundSitemapEntries, listSiblingFunds } from "~/services/seo-service";

/** 只清基金表与净值表：sitemap 只读这两张 */
async function reset() {
  const db = getDb(env.DB);
  await db.delete(fund);
  await db.delete(fundNav);
}

beforeEach(reset);

function fundRow(code: string, name = `基金${code}`) {
  return {
    code,
    name,
    type: "混合型",
    purchaseRate: 15,
    redeemTiers: [{ minDays: 0, maxDays: null, rate: 0 }],
    minPurchase: 1000,
    riskLevel: 3,
    status: "开放申购",
    updatedAt: 1_756_000_000_000,
  };
}

describe("listFundSitemapEntries sitemap 用基金清单", () => {
  it("空库返回空数组", async () => {
    const db = getDb(env.DB);
    expect(await listFundSitemapEntries(db)).toEqual([]);
  });

  it("带出每只基金的最新净值日期（lastmod），按代码升序、一条查询搞定", async () => {
    const db = getDb(env.DB);
    await db.insert(fund).values([
      fundRow("110022", "易方达消费"),
      fundRow("000001", "华夏成长"),
      fundRow("003003", "无净值基金"),
    ]);
    // 乱序插入，逼实现真去取 max(nav_date) 而不是碰巧取到最后一条
    await db.insert(fundNav).values([
      { fundCode: "000001", navDate: "2026-09-10", unitNav: 10000, accNav: 10000, growthRate: 0 },
      { fundCode: "000001", navDate: "2026-09-16", unitNav: 10100, accNav: 10100, growthRate: 100 },
      { fundCode: "110022", navDate: "2026-09-15", unitNav: 20000, accNav: 20000, growthRate: 0 },
    ]);

    expect(await listFundSitemapEntries(db)).toEqual([
      { code: "000001", lastmod: "2026-09-16" },
      { code: "003003", lastmod: null },
      { code: "110022", lastmod: "2026-09-15" },
    ]);
  });
});

describe("listSiblingFunds 同类基金（基金页内链用）", () => {
  it("只出同类型、不含自己，按代码升序且受 limit 约束", async () => {
    const db = getDb(env.DB);
    await db.insert(fund).values([
      fundRow("000001", "华夏成长"),
      fundRow("110022", "易方达消费"),
      fundRow("161725", "招商中证白酒"),
      { ...fundRow("000300", "沪深300指数"), type: "指数型" },
    ]);

    const list = await listSiblingFunds(db, { code: "000001", type: "混合型", limit: 5 });
    expect(list.map(f => f.code)).toEqual(["110022", "161725"]);
    expect(list[0]!.name).toBe("易方达消费");

    // limit 生效（首页/详情页只留几个内链，别把整类铺开）
    const one = await listSiblingFunds(db, { code: "000001", type: "混合型", limit: 1 });
    expect(one.map(f => f.code)).toEqual(["110022"]);
  });

  it("type 为空（东财偶尔给空串）时返回空数组，不硬凑一堆无关基金", async () => {
    const db = getDb(env.DB);
    await db.insert(fund).values([fundRow("000001"), fundRow("110022")]);
    expect(await listSiblingFunds(db, { code: "000001", type: "", limit: 5 })).toEqual([]);
  });
});
