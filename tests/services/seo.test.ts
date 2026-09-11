import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { fund } from "~/db/schema";
import { listFundCodes } from "~/services/seo-service";

/** 只清基金表：sitemap 只读这一张 */
async function reset() {
  const db = getDb(env.DB);
  await db.delete(fund);
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

describe("listFundCodes sitemap 用基金清单", () => {
  it("空库返回空数组", async () => {
    const db = getDb(env.DB);
    expect(await listFundCodes(db)).toEqual([]);
  });

  it("只返回代码、按代码升序，不含名称等其它字段", async () => {
    const db = getDb(env.DB);
    await db.insert(fund).values([
      fundRow("110022", "易方达消费"),
      fundRow("000001", "华夏成长"),
    ]);
    expect(await listFundCodes(db)).toEqual(["000001", "110022"]);
  });
});
