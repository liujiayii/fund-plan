// tests/services/dca-update.test.ts
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
  createDcaPlan,
  toggleDcaPlan,
  updateDcaPlan,
} from "~/services/dca-service";

/** updateDcaPlan：定投计划的修改（金额/频率/日子），next_run 随频率重算 */

async function resetAll() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(shareLot);
  await db.delete(holding);
  await db.delete(orders);
  await db.delete(dcaPlan);
  await db.delete(checkin);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
  await db.delete(fundNav);
  await db.delete(fund);
}

async function seedFund(code = "000001") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试成长混合",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000, // 起购 10 元
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

async function seedUser(name = "alice") {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

/** 造一个月投计划（每月 15 号、500 元），基准日统一北京 8/24（周一） */
async function seedMonthlyPlan(userId: number) {
  const db = getDb(env.DB);
  const r = await createDcaPlan(db, {
    userId,
    fundCode: "000001",
    amountCents: 50000,
    frequency: "monthly",
    dayOfMonth: 15,
    now: new Date("2026-08-24T06:00:00Z"),
  });
  return r.id;
}

beforeEach(resetAll);

describe("updateDcaPlan 修改定投计划", () => {
  it("只改金额：其余字段（频率/next_run/状态/累计）原样保留", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const planId = await seedMonthlyPlan(userId);

    await updateDcaPlan(db, userId, planId, {
      amountCents: 200000,
      frequency: "monthly",
      dayOfMonth: 15,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const p = await db.query.dcaPlan.findFirst({ where: eq(dcaPlan.id, planId) });
    expect(p!.amount).toBe(200000);
    expect(p!.frequency).toBe("monthly");
    expect(p!.dayOfMonth).toBe(15);
    // 同频率同日子 → next_run 不变（本月 15 号已过，仍是 9/15）
    expect(p!.nextRun).toBe("2026-09-15");
    expect(p!.status).toBe("active");
    expect(p!.runCount).toBe(0);
    expect(p!.totalInvested).toBe(0);
  });

  it("改频率重算 next_run：月投改周投（周三）→ 顺延到本周三 8/26", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const planId = await seedMonthlyPlan(userId);

    await updateDcaPlan(db, userId, planId, {
      amountCents: 50000,
      frequency: "weekly",
      dayOfWeek: 3,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const p = await db.query.dcaPlan.findFirst({ where: eq(dcaPlan.id, planId) });
    expect(p!.frequency).toBe("weekly");
    expect(p!.dayOfWeek).toBe(3);
    expect(p!.dayOfMonth).toBeNull(); // 换频率后旧日子字段清空，不留脏数据
    expect(p!.nextRun).toBe("2026-08-26");
  });

  it("暂停中的计划可修改，且不会被顺手启用", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const planId = await seedMonthlyPlan(userId);
    await toggleDcaPlan(db, userId, planId, "paused");

    await updateDcaPlan(db, userId, planId, {
      amountCents: 300000,
      frequency: "monthly",
      dayOfMonth: 15,
      now: new Date("2026-08-24T06:00:00Z"),
    });

    const p = await db.query.dcaPlan.findFirst({ where: eq(dcaPlan.id, planId) });
    expect(p!.amount).toBe(300000);
    expect(p!.status).toBe("paused");
  });

  it("金额低于起购金额报错", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();
    const planId = await seedMonthlyPlan(userId);

    await expect(updateDcaPlan(db, userId, planId, {
      amountCents: 500, // 5 元 < 起购 10 元
      frequency: "monthly",
      dayOfMonth: 15,
    })).rejects.toThrow("起购");
  });

  it("改别人的计划 403，计划不存在报错", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");
    const planId = await seedMonthlyPlan(alice);

    // 越权抛的是 Response（assertOwnership），与 toggle/delete 测试同款 toBeTruthy 断言
    await expect(updateDcaPlan(db, bob, planId, {
      amountCents: 200000,
      frequency: "monthly",
      dayOfMonth: 15,
    })).rejects.toBeTruthy();

    await expect(updateDcaPlan(db, alice, 99999, {
      amountCents: 200000,
      frequency: "monthly",
      dayOfMonth: 15,
    })).rejects.toThrow("不存在");
  });
});
