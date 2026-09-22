import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, runBatch } from "~/db/client";
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
import { registerUser } from "~/services/auth";
import { getPlanPeriod } from "~/services/undervalued-plan";

/**
 * `/plan` 读侧的接线测试（真实 D1）。
 *
 * 直接调 service 而不是 loader：loader 还要走 getAdminUser（依赖
 * ADMIN_USERNAME 与库里的用户对上），那一层由 guard.test.ts 覆盖；
 * 这里要钉的是「本期是哪一期、那一期有哪些品种」这套选取逻辑。
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

async function seedUser(name = "testadmin"): Promise<number> {
  const r = await registerUser(db, env, name, "hunter2");
  return r.id;
}

async function seedFund(code: string, name = `基金${code}`, minPurchase = 1000) {
  await db.insert(fund).values({
    code,
    name,
    type: "指数型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

/** 直接插订单：本测试关心的是「读了哪些单」，不需要真的跑一遍下单与撮合 */
async function seedOrder(
  userId: number,
  fundCode: string,
  placeDate: string,
  amountCents: number,
  status: "pending" | "confirmed" | "failed" | "cancelled" = "confirmed",
  side: "buy" | "sell" = "buy",
) {
  await db.insert(orders).values({
    userId,
    fundCode,
    side,
    status,
    source: "manual",
    amount: side === "buy" ? amountCents : null,
    shares: side === "sell" ? amountCents : null,
    placeDate,
    confirmDate: placeDate,
    createdAt: Date.now(),
  });
}

describe("getPlanPeriod", () => {
  it("取不晚于今天的最近一个有买入的周二，并按金额合并成品种", async () => {
    const uid = await seedUser();
    await seedFund("000001", "华夏成长");
    await seedFund("000002", "易方达消费");

    // 上上期、上一期、以及一个周三的机动加仓
    await seedOrder(uid, "000001", "2026-09-08", 100_000);
    await seedOrder(uid, "000002", "2026-09-16", 999_999); // 周三，不纳入
    await seedOrder(uid, "000001", "2026-09-15", 100_000);
    await seedOrder(uid, "000002", "2026-09-15", 200_000);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.period).toBe("2026-09-15");
    expect(v.buys.map(b => b.fundCode)).toEqual(["000001", "000002"]);
    expect(v.buys.map(b => b.amountCents)).toEqual([100_000, 200_000]);
    expect(v.totalCents).toBe(300_000);
    expect(v.buys[0]!.fundName).toBe("华夏成长");
    expect(v.buys[0]!.fundType).toBe("指数型");
    expect(v.buys[0]!.minPurchaseCents).toBe(1000);
    // 第一行的大字是自动缩出来的简称（剥掉公司名「华夏」）
    expect(v.buys[0]!.shortName).toBe("成长");
    expect(v.buys[1]!.shortName).toBe("消费");
  });

  it("今天买过就取今天——主理人落单那一刻页面就该更新（pending 也算）", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    await seedOrder(uid, "000001", "2026-09-15", 100_000);
    await seedOrder(uid, "000001", "2026-09-22", 50_000, "pending");

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.period).toBe("2026-09-22");
    expect(v.totalCents).toBe(50_000);
  });

  it("今天已是周二但还没买：停在上一期（不是空表）", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    await seedOrder(uid, "000001", "2026-09-15", 100_000);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.period).toBe("2026-09-15");
    expect(v.buys).toHaveLength(1);
  });

  it("同一只基金周二补过单：合并成一个品种，金额相加", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    await seedOrder(uid, "000001", "2026-09-15", 100_000);
    await seedOrder(uid, "000001", "2026-09-15", 25_000);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.buys).toHaveLength(1);
    expect(v.buys[0]!.amountCents).toBe(125_000);
    expect(v.totalCents).toBe(125_000);
  });

  it("未成交的单不算：failed / cancelled 不参与选期，也不进明细", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    await seedFund("000002");
    // 最近这个周二只有一张废单 → 这一期不算数，退回上一期
    await seedOrder(uid, "000002", "2026-09-22", 100_000, "failed");
    await seedOrder(uid, "000002", "2026-09-22", 100_000, "cancelled");
    await seedOrder(uid, "000001", "2026-09-15", 100_000);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.period).toBe("2026-09-15");
    expect(v.buys.map(b => b.fundCode)).toEqual(["000001"]);
  });

  it("赎回单不掺进来（这一页只讲买入）", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    await seedOrder(uid, "000001", "2026-09-15", 100_000, "confirmed", "sell");
    await seedOrder(uid, "000001", "2026-09-08", 60_000);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.period).toBe("2026-09-08");
    expect(v.totalCents).toBe(60_000);
  });

  it("只看主理人自己的单（别人的买卖不进这一页）", async () => {
    const admin = await seedUser("testadmin");
    const other = await seedUser("bob");
    await seedFund("000001");
    await seedOrder(other, "000001", "2026-09-22", 777_777);

    const mine = await getPlanPeriod(db, admin, "2026-09-22");
    expect(mine.period).toBeNull();
    expect(mine.buys).toEqual([]);
  });

  it("一期都没发过车 / 全是非周二的买入 → period 为 null，页面走空态", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    expect((await getPlanPeriod(db, uid, "2026-09-22")).period).toBeNull();

    await seedOrder(uid, "000001", "2026-09-17", 100_000); // 周四
    expect((await getPlanPeriod(db, uid, "2026-09-22")).period).toBeNull();
  });

  it("基金档案缺席也能显示：名字退化成代码，起购按 0（不编数字）", async () => {
    const uid = await seedUser();
    // 刻意不 seedFund：订单里有代码，fund 表里没有
    await seedOrder(uid, "159915", "2026-09-15", 88_800);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.buys[0]!.fundName).toBe("159915");
    expect(v.buys[0]!.fundType).toBe("");
    expect(v.buys[0]!.minPurchaseCents).toBe(0);
    expect(v.buys[0]!.amountCents).toBe(88_800);
  });

  it("品种顺序 = 主理人下单先后（同一天里按 id 升序，不是倒序）", async () => {
    const uid = await seedUser();
    await seedFund("000003");
    await seedFund("000002");
    await seedFund("000001");
    await seedOrder(uid, "000003", "2026-09-15", 300);
    await seedOrder(uid, "000002", "2026-09-15", 200);
    await seedOrder(uid, "000001", "2026-09-15", 100);

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.buys.map(b => b.fundCode)).toEqual(["000003", "000002", "000001"]);
  });

  it("本期的单子**全部**进明细，不受扫描上限截断（上限只加在日期上，不加在明细上）", async () => {
    const uid = await seedUser();
    await seedFund("000001");
    // 一趟 350 笔（刻意超过早先那版给明细查询设的 300 条上限）。
    // 上限若加在明细上，这里会静默只算到 300 笔、总额少 500 分——
    // 真实盘一天当然下不了这么多单，但「本期明细必须完整」是硬性质，
    // 用一条能被旧实现打红的用例钉住（CodeRabbit 评审 #4）
    await runBatch(
      db,
      Array.from({ length: 350 }, () =>
        db.insert(orders).values({
          userId: uid,
          fundCode: "000001",
          side: "buy",
          status: "confirmed",
          source: "manual",
          amount: 10,
          shares: null,
          placeDate: "2026-09-15",
          confirmDate: "2026-09-15",
          createdAt: Date.now(),
        })),
    );

    const v = await getPlanPeriod(db, uid, "2026-09-22");
    expect(v.period).toBe("2026-09-15");
    expect(v.buys).toHaveLength(1);
    expect(v.totalCents).toBe(3500);
  });
});
