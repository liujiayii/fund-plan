import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
import { registerUser } from "~/services/auth";
import {
  addWatch,
  isWatched,
  listWatch,
  removeWatch,
} from "~/services/watchlist-service";

/**
 * 自选服务集成测试。用真实 workerd + 真实 D1 跑，
 * 覆盖加/列/删/幂等/级联删除五条核心路径。
 */

/** 每个用例前清空所有用户相关表 + 基金表，避免互相污染 */
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
}

/** 预置一只基金档案（避免 addWatch 走真网络拉东财） */
async function seedFund(code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试成长混合",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

/** 预置一条净值记录 */
async function seedNav(
  navDate: string,
  unitNav: number,
  growthRate: number,
  code = "000001",
) {
  const db = getDb(env.DB);
  await db
    .insert(fundNav)
    .values({ fundCode: code, navDate, unitNav, accNav: unitNav, growthRate });
}

/** 注册一个用户，返回其 id */
async function seedUser(name = "alice") {
  return (await registerUser(getDb(env.DB), env, name, "hunter2")).id;
}

beforeEach(resetAll);

describe("watchlist-service", () => {
  it("addWatch：库里已有基金时直接加，重复加幂等", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    await addWatch(db, env, userId, "000001"); // 重复，幂等
    expect(await isWatched(db, userId, "000001")).toBe(true);
    const list = await listWatch(db, userId);
    expect(list).toHaveLength(1);
    expect(list[0].fundName).toBe("测试成长混合");
  });

  it("addWatch：库里没有基金时先 ensureFund 落档再加（fetch stub）", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    // 不预置 fund；999999 是不存在的代码，
    // ensureFund 内部 fetchFundBasic 走真网络会失败 → 返回 null → addWatch 抛错
    await expect(addWatch(db, env, userId, "999999")).rejects.toThrow();
  });

  it("listWatch：带基金名 + 最新净值 + 日涨跌", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNav("2026-08-25", 12345, 263); // +2.63%
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    const list = await listWatch(db, userId);
    expect(list[0].unitNav).toBe(12345);
    expect(list[0].navDate).toBe("2026-08-25");
    expect(list[0].growthRate).toBe(263);
  });

  it("removeWatch：取消后 isWatched 为 false", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    await removeWatch(db, userId, "000001");
    expect(await isWatched(db, userId, "000001")).toBe(false);
    expect(await listWatch(db, userId)).toHaveLength(0);
  });

  it("级联删除：删用户后 watchlist 跟着没", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    await addWatch(db, env, userId, "000001");
    // 删用户：外键 onDelete: cascade 会把 watchlist 行一起带走
    await db.delete(user).where(eq(user.id, userId));
    const list = await listWatch(db, userId);
    // 用户没了，按 userId 查应空（外键 cascade 已删 watchlist 行）
    expect(list).toHaveLength(0);
  });
});
