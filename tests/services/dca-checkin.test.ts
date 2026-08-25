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
import { doCheckin, getCheckinStatus } from "~/services/checkin-service";
import {
  createDcaPlan,
  deleteDcaPlan,
  scanDcaPlans,
  toggleDcaPlan,
} from "~/services/dca-service";

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
    minPurchase: 1000,
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

beforeEach(resetAll);

describe("createDcaPlan 创建定投计划", () => {
  it("月投计划的 next_run 严格晚于今天", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const r = await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "monthly",
      dayOfMonth: 15,
      now: new Date("2026-08-24T06:00:00Z"), // 北京 8/24
    });

    const p = await db.query.dcaPlan.findFirst({
      where: eq(dcaPlan.id, r.id),
    });
    expect(p!.nextRun).toBe("2026-09-15"); // 本月 15 号已过 → 下月
    expect(p!.status).toBe("active");
    expect(p!.runCount).toBe(0);
    expect(p!.totalInvested).toBe(0);
  });

  it("周投计划正确落 dayOfWeek", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const r = await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 50000,
      frequency: "weekly",
      dayOfWeek: 3, // 周三
      now: new Date("2026-08-24T06:00:00Z"), // 周一
    });

    const p = await db.query.dcaPlan.findFirst({ where: eq(dcaPlan.id, r.id) });
    expect(p!.frequency).toBe("weekly");
    expect(p!.dayOfWeek).toBe(3);
    expect(p!.nextRun).toBe("2026-08-26"); // 本周三
  });

  it("每期金额低于起购时抛错", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await expect(
      createDcaPlan(db, {
        userId,
        fundCode: "000001",
        amountCents: 500, // 5 元，低于 10 元起购
        frequency: "daily",
      }),
    ).rejects.toThrow(/起购/);
  });

  it("dayOfMonth 超过 28 时抛错", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await expect(
      createDcaPlan(db, {
        userId,
        fundCode: "000001",
        amountCents: 100000,
        frequency: "monthly",
        dayOfMonth: 31,
      }),
    ).rejects.toThrow();
  });
});

describe("scanDcaPlans 定投扫描", () => {
  it("到期计划触发下单，并推进 next_run 与统计", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const created = await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
      now: new Date("2026-08-23T06:00:00Z"),
    });
    // next_run 应为 8/24

    const r = await scanDcaPlans(db, env, new Date("2026-08-24T02:00:00Z"));
    expect(r.triggered).toBe(1);
    expect(r.failed).toBe(0);

    // 生成了一张 dca 来源的 pending 单
    const os = await db.select().from(orders);
    expect(os).toHaveLength(1);
    expect(os[0].source).toBe("dca");
    expect(os[0].status).toBe("pending");
    expect(os[0].amount).toBe(100000);

    // 计划统计推进
    const p = await db.query.dcaPlan.findFirst({
      where: eq(dcaPlan.id, created.id),
    });
    expect(p!.runCount).toBe(1);
    expect(p!.totalInvested).toBe(100000);
    expect(p!.nextRun).toBe("2026-08-25"); // 已推进到明天
  });

  it("同日重复扫描不重复触发（幂等）", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
      now: new Date("2026-08-23T06:00:00Z"),
    });

    const first = await scanDcaPlans(db, env, new Date("2026-08-24T02:00:00Z"));
    const second = await scanDcaPlans(db, env, new Date("2026-08-24T02:05:00Z"));

    expect(first.triggered).toBe(1);
    expect(second.triggered).toBe(0);

    const os = await db.select().from(orders);
    expect(os).toHaveLength(1);
  });

  it("paused 计划不触发", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    const created = await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
      now: new Date("2026-08-23T06:00:00Z"),
    });
    await toggleDcaPlan(db, userId, created.id, "paused");

    const r = await scanDcaPlans(db, env, new Date("2026-08-24T02:00:00Z"));
    expect(r.triggered).toBe(0);
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("next_run 在未来的计划不触发", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const userId = await seedUser();

    await createDcaPlan(db, {
      userId,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "monthly",
      dayOfMonth: 15,
      now: new Date("2026-08-24T06:00:00Z"), // next_run = 9/15
    });

    const r = await scanDcaPlans(db, env, new Date("2026-08-25T02:00:00Z"));
    expect(r.triggered).toBe(0);
  });

  it("某计划现金不足时只失败它自己，不阻塞其他计划", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const poor = await seedUser("poor");
    const rich = await seedUser("rich");

    // 把 poor 的现金抽干到只剩 100 元
    await db
      .update(account)
      .set({ cash: 10000 })
      .where(eq(account.userId, poor));

    await createDcaPlan(db, {
      userId: poor,
      fundCode: "000001",
      amountCents: 500000, // 5000 元，明显不够
      frequency: "daily",
      now: new Date("2026-08-23T06:00:00Z"),
    });
    await createDcaPlan(db, {
      userId: rich,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
      now: new Date("2026-08-23T06:00:00Z"),
    });

    const r = await scanDcaPlans(db, env, new Date("2026-08-24T02:00:00Z"));
    expect(r.triggered).toBe(1); // rich 成功
    expect(r.failed).toBe(1); // poor 失败

    // rich 的单子确实生成了
    const os = await db.select().from(orders);
    expect(os).toHaveLength(1);
    expect(os[0].userId).toBe(rich);

    // poor 的计划日期也推进了，避免明天连着今天一起失败
    const poorPlan = await db.query.dcaPlan.findFirst({
      where: eq(dcaPlan.userId, poor),
    });
    expect(poorPlan!.nextRun).toBe("2026-08-25");
    expect(poorPlan!.runCount).toBe(0); // 没成功就不计数
  });
});

describe("定投计划权限", () => {
  it("不能暂停他人的计划", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");

    const created = await createDcaPlan(db, {
      userId: alice,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
    });

    await expect(toggleDcaPlan(db, bob, created.id, "paused")).rejects.toBeTruthy();
  });

  it("不能删除他人的计划", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");
    const bob = await seedUser("bob");

    const created = await createDcaPlan(db, {
      userId: alice,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
    });

    await expect(deleteDcaPlan(db, bob, created.id)).rejects.toBeTruthy();
    // 计划应还在
    expect(
      await db.query.dcaPlan.findFirst({ where: eq(dcaPlan.id, created.id) }),
    ).toBeDefined();
  });

  it("能删除自己的计划", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const alice = await seedUser("alice");

    const created = await createDcaPlan(db, {
      userId: alice,
      fundCode: "000001",
      amountCents: 100000,
      frequency: "daily",
    });
    await deleteDcaPlan(db, alice, created.id);

    expect(
      await db.query.dcaPlan.findFirst({ where: eq(dcaPlan.id, created.id) }),
    ).toBeUndefined();
  });
});

describe("doCheckin 签到入金", () => {
  it("首签得 100 元，余额与累计签到同步增加，记一条流水", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    const r = await doCheckin(db, userId, new Date("2026-08-24T02:00:00Z"));
    expect(r.reward).toBe(10000);
    expect(r.streak).toBe(1);
    expect(r.balance).toBe(10_000_000 + 10000);

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(acc!.cash).toBe(10_010_000);
    expect(acc!.totalCheckin).toBe(10000);

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.type, "checkin"));
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(10000);
    expect(txs[0].balance).toBe(10_010_000);
  });

  it("同日重复签到抛错且余额不变", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    const t = new Date("2026-08-24T02:00:00Z");

    await doCheckin(db, userId, t);
    const before = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });

    await expect(doCheckin(db, userId, t)).rejects.toThrow(/已签到/);

    const after = await db.query.account.findFirst({
      where: eq(account.userId, userId),
    });
    expect(after!.cash).toBe(before!.cash);
    // 签到记录也只有一条
    expect(await db.select().from(checkin)).toHaveLength(1);
  });

  it("连签第 2 天得 150 元", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    await doCheckin(db, userId, new Date("2026-08-23T02:00:00Z"));
    const r = await doCheckin(db, userId, new Date("2026-08-24T02:00:00Z"));

    expect(r.streak).toBe(2);
    expect(r.reward).toBe(15000);
    expect(r.balance).toBe(10_000_000 + 10000 + 15000);
  });

  it("连签 9 天触及 500 元封顶", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    const dates = [
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ];
    let last: Awaited<ReturnType<typeof doCheckin>> | null = null;
    for (const d of dates) {
      last = await doCheckin(db, userId, new Date(`${d}T02:00:00Z`));
    }

    expect(last!.streak).toBe(9);
    expect(last!.reward).toBe(50000);
  });

  it("断签后连签归零，奖励掉回 100 元", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    await doCheckin(db, userId, new Date("2026-08-20T02:00:00Z"));
    await doCheckin(db, userId, new Date("2026-08-21T02:00:00Z"));
    // 隔了 8/22、8/23 没签
    const r = await doCheckin(db, userId, new Date("2026-08-24T02:00:00Z"));

    expect(r.streak).toBe(1);
    expect(r.reward).toBe(10000);
  });
});

describe("getCheckinStatus 签到状态", () => {
  it("未签到时显示今天可领金额", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    const s = await getCheckinStatus(db, userId, new Date("2026-08-24T02:00:00Z"));
    expect(s.checkedToday).toBe(false);
    expect(s.nextReward).toBe(10000); // 首签 100 元
    expect(s.totalCheckin).toBe(0);
  });

  it("已签到时显示明天续签金额", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    const t = new Date("2026-08-24T02:00:00Z");

    await doCheckin(db, userId, t);
    const s = await getCheckinStatus(db, userId, t);

    expect(s.checkedToday).toBe(true);
    expect(s.streak).toBe(1);
    expect(s.nextReward).toBe(15000); // 明天连签第 2 天
    expect(s.totalCheckin).toBe(10000);
  });

  it("断签状态下今天签到只能拿基础奖励", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();

    await doCheckin(db, userId, new Date("2026-08-20T02:00:00Z"));
    // 今天是 8/24，已断签
    const s = await getCheckinStatus(db, userId, new Date("2026-08-24T02:00:00Z"));

    expect(s.checkedToday).toBe(false);
    expect(s.nextReward).toBe(10000); // 断签归零
  });
});
