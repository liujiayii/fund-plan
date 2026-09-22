import { env } from "cloudflare:test";
import dayjs from "dayjs";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import {
  account,
  fund,
  holding,
  orders,
  session,
  shareLot,
  transactions,
  user,
} from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { toBeijing } from "~/domain/trading-calendar";
import { currentPlanDay } from "~/domain/undervalued-plan";
import { loader } from "~/routes/plan";
import { registerUser } from "~/services/auth";
import { CloudflareContext } from "../../workers/app";

/**
 * `/plan` 的 loader 接线测试（真实 D1 + 真实边界时间）。
 *
 * 直接调 loader、不经 fetch handler：context 用伪对象——getAppContext 只消费
 * `get(CloudflareContext) → { env, ctx }`，能伪造（与 dca-backtest-page.test.ts 同款）。
 *
 * ⚠️ 日期一律**相对今天算**，不写死 2026-09-22：loader 里的 `today` 取的是真实
 * 北京时钟，写死日期的话这个测试今天绿、下周二就红。测试环境 ADMIN_USERNAME 是
 * `testadmin`（见 guard.test.ts 顶注），所以注册一个同名用户就是主理人。
 */

const db = getDb(env.DB);

async function resetAll() {
  await db.delete(transactions);
  await db.delete(shareLot);
  await db.delete(holding);
  await db.delete(orders);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
  await db.delete(fund);
}

beforeEach(resetAll);

/** 北京时间今天 + 本周的周二 + 上周的周二，都由真实时钟推出来 */
const today = toBeijing(new Date()).format("YYYY-MM-DD");
const thisTuesday = currentPlanDay(today)!;
const lastTuesday = dayjs(thisTuesday).subtract(7, "day").format("YYYY-MM-DD");

/** 伪造路由 context：与 RouterContextProvider 同形，只实现 get */
function fakeContext(): unknown {
  return {
    get: (key: unknown) =>
      key === CloudflareContext
        ? { env, ctx: { waitUntil: () => {} } }
        : undefined,
  };
}

async function load(search = "") {
  return loader({
    request: new Request(`https://x.dev/plan${search}`),
    context: fakeContext(),
    params: {},
  } as never);
}

async function seedFund(code: string, name: string) {
  await db.insert(fund).values({
    code,
    name,
    type: "指数型-股票",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

async function seedOrder(userId: number, fundCode: string, placeDate: string, amountCents: number) {
  await db.insert(orders).values({
    userId,
    fundCode,
    side: "buy",
    status: "confirmed",
    source: "manual",
    amount: amountCents,
    shares: null,
    placeDate,
    confirmDate: placeDate,
    createdAt: Date.now(),
  });
}

/**
 * 造一个「本周二发过车」的盘：两只基金，合计 1500.01 元。
 *  金额刻意带零头（50001 而不是 50000）：换算出来的分配才需要走「最大余数法」
 *  的补余数那一步，否则整除下来根本验不到取整逻辑
 */
async function seedMaster() {
  const admin = await registerUser(db, env, "testadmin", "hunter2");
  await seedFund("050025", "博时标普500ETF联接A");
  await seedFund("161725", "招商中证白酒指数");
  await seedOrder(admin.id, "050025", thisTuesday, 100_000);
  await seedOrder(admin.id, "161725", thisTuesday, 50_001);
  return admin;
}

describe("GET /plan", () => {
  it("默认参数：按主理人买入合计 × 10% 换算，明细带简称", async () => {
    await seedMaster();
    const data = await load();

    expect(data.ready).toBe(true);
    expect(data.period).toBe(thisTuesday);
    expect(data.stale).toBe(false);
    expect(data.ratioBps).toBe(1000);
    expect(data.masterTotalCents).toBe(150_001);
    // 1500.01 元 × 10% = 150.001 元 → 四舍五入到分 = 15000 分
    expect(data.targetCents).toBe(15_000);
    expect(data.notices).toEqual([]);

    // 第一行大字 = 剥掉公司名与载体后缀的简称
    expect(data.rows.map(r => r.shortName)).toEqual(["标普500", "中证白酒"]);

    // 略超 2:1 的两笔，分配要走出补余数：向下取整是 9999 + 5000 = 14999，余 1 分补给第一只
    expect(data.rows.map(r => r.mineCents)).toEqual([10_000, 5_000]);
    // 和不变式：逐只加起来必须正好等于合计（差一分都是金融页面的信任问题）
    expect(data.rows.reduce((s, r) => s + r.mineCents, 0)).toBe(data.targetCents);
  });

  it("比例可调，URL 即状态；主理人的参考金额不受参数影响", async () => {
    await seedMaster();
    const data = await load("?ratio=50");
    expect(data.ratioBps).toBe(5000);
    // 1500.01 元 × 50% = 750.005 元 → HALF_UP 进位到分 = 75001 分
    expect(data.targetCents).toBe(75_001);
    expect(data.masterTotalCents).toBe(150_001);
    expect(data.rows.reduce((s, r) => s + r.mineCents, 0)).toBe(data.targetCents);
  });

  it("比例可以超过 100%（资金比主理人充裕时按倍数跟）", async () => {
    await seedMaster();
    const data = await load("?ratio=200");
    expect(data.ratioBps).toBe(20_000);
    expect(data.targetCents).toBe(300_002);
    expect(data.rows.reduce((s, r) => s + r.mineCents, 0)).toBe(data.targetCents);
  });

  it("坏参数回落默认值并给提示（页面原样展示，不静默改口径）", async () => {
    await seedMaster();
    const bad = await load("?ratio=abc");
    expect(bad.notices).toHaveLength(1);
    expect(bad.ratioBps).toBe(1000);
    // 回落不等于不给结果：照样算得出来
    expect(bad.rows).toHaveLength(2);

    // 越界的收到上边界而不是掉回默认值
    const clamped = await load("?ratio=800");
    expect(clamped.ratioBps).toBe(50_000);
    expect(clamped.notices[0]).toContain("500%");
  });

  it("这周二还没买：停在上一期并标记 stale（读者不会误以为那是本周的实盘）", async () => {
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    await seedFund("050025", "博时标普500ETF联接A");
    await seedOrder(admin.id, "050025", lastTuesday, 100_000);

    const data = await load();
    expect(data.period).toBe(lastTuesday);
    expect(data.stale).toBe(true);
    expect(data.rows).toHaveLength(1);
  });

  it("换算后低于起购的品种数会报出来（小额资金最容易踩的坑）", async () => {
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    // 起购 100 元；主理人这期买 1000 元，跟 1% = 10 元，怎么摊都不够
    await db.insert(fund).values({
      code: "050025",
      name: "博时标普500ETF联接A",
      type: "指数型-股票",
      purchaseRate: 150,
      redeemTiers: DEFAULT_REDEEM_TIERS,
      minPurchase: 10_000,
      riskLevel: 4,
      status: "开放申购",
      updatedAt: Date.now(),
    });
    await seedOrder(admin.id, "050025", thisTuesday, 100_000);

    const data = await load("?ratio=1");
    expect(data.targetCents).toBe(1000);
    expect(data.belowMinCount).toBe(1);
  });

  it("主理人还没注册：不炸，给引导（与 /master 同款）", async () => {
    const data = await load();
    expect(data.ready).toBe(false);
    expect(data.rows).toEqual([]);
    expect(data.period).toBeNull();
    expect(data.stale).toBe(false);
    // 没有基准就没有可换算的东西，如实给 0，不编一个数字
    expect(data.targetCents).toBe(0);
  });

  it("主理人一期都没发过车：空盘不给 stale 提示，页面走空态", async () => {
    await registerUser(db, env, "testadmin", "hunter2");
    const data = await load();
    expect(data.ready).toBe(true);
    expect(data.period).toBeNull();
    expect(data.stale).toBe(false);
    expect(data.rows).toEqual([]);
  });

  it("非周二的买入不纳入本期（只有周三的单 → 走空态）", async () => {
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    await seedFund("050025", "博时标普500ETF联接A");
    const wednesday = dayjs(thisTuesday).add(1, "day").format("YYYY-MM-DD");
    await seedOrder(admin.id, "050025", wednesday, 100_000);

    const data = await load();
    // 周三的单算不上「一期」；除非那天恰好是本周二之前最近的有单周二
    expect(data.period).toBeNull();
    expect(data.rows).toEqual([]);
  });
});
