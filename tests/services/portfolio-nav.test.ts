import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { fundNav } from "~/db/schema";
import { latestNavMap } from "~/services/portfolio-service";

/**
 * latestNavMap 行为钉子：它被 /me、/master、自选列表、首页共用，
 * 「每只基金取最新一条净值（含日涨跌）」的口径不能因为查询改写而漂移。
 */

async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [fundNav])
    await db.delete(t);
}

/** seed 一条净值；growthRate 单位是万分之 */
async function seedNav(code: string, navDate: string, unitNav: number, growthRate = 0) {
  await getDb(env.DB).insert(fundNav).values({
    fundCode: code,
    navDate,
    unitNav,
    accNav: unitNav,
    growthRate,
  });
}

beforeEach(resetAll);

describe("latestNavMap", () => {
  it("每只基金取 nav_date 最大的那一行（含日涨跌），与日期顺序无关", async () => {
    const db = getDb(env.DB);
    // 乱序插入，逼实现真去比较 nav_date 而不是碰巧取到「最后插入」
    await seedNav("000001", "2026-08-01", 10000, 11);
    await seedNav("000001", "2026-08-25", 12345, 150); // 000001 的最新一条
    await seedNav("000001", "2026-08-10", 11000, 22);
    await seedNav("000002", "2026-08-24", 20000, -30);

    const map = await latestNavMap(db, ["000001", "000002"]);
    expect(map.size).toBe(2);
    expect(map.get("000001")).toEqual({
      navDate: "2026-08-25",
      unitNav: 12345,
      growthRate: 150,
    });
    expect(map.get("000002")).toEqual({
      navDate: "2026-08-24",
      unitNav: 20000,
      growthRate: -30,
    });
  });

  it("入参里有库里不存在的基金 → 不出现在结果里", async () => {
    const db = getDb(env.DB);
    await seedNav("000001", "2026-08-25", 12345);
    const map = await latestNavMap(db, ["000001", "000009"]);
    expect(map.size).toBe(1);
    expect(map.has("000009")).toBe(false);
  });

  it("空列表返回空 Map，不发查询", async () => {
    const map = await latestNavMap(getDb(env.DB), []);
    expect(map.size).toBe(0);
  });
});
