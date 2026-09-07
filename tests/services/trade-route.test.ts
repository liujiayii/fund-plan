import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, fund, fundNav, orders, session, transactions, user } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { action } from "~/routes/me.trade";
import { registerUser } from "~/services/auth";
import { createSession, sessionCookie } from "~/services/session";
import { CloudflareContext } from "../../workers/app";

/**
 * /me/trade 买入 action 的四条路径。
 * 直接调路由 action（不经 fetch handler）：context 用伪对象——
 * getAppContext 只消费 get(CloudflareContext) → { env, ctx }，能伪造。
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

/** 造 POST /me/trade 请求（可带会话 Cookie） */
function postTrade(fd: Record<string, string>, token?: string): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fd)) body.append(k, v);
  return new Request("https://x.dev/me/trade", {
    method: "POST",
    body,
    headers: token ? { Cookie: sessionCookie(token) } : undefined,
  });
}

/** 建一只测试基金（与 trade.test.ts 同款） */
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

/** 注册用户并返回 { userId, token } */
async function seedUser(name = "alice") {
  const db = getDb(env.DB);
  const r = await registerUser(db, env, name, "hunter2");
  const token = await createSession(db, r.id);
  return { userId: r.id, token };
}

async function resetAll() {
  const db = getDb(env.DB);
  await db.delete(orders);
  await db.delete(transactions);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
  await db.delete(fundNav);
  await db.delete(fund);
}

beforeEach(resetAll);

describe("POST /me/trade 买入", () => {
  it("未登录：requireUser 抛 302 重定向到 /login", async () => {
    try {
      await action({
        request: postTrade({ intent: "buy", fundCode: "000001", amount: "100" }),
        context: fakeContext(),
        params: {},
      } as never);
      expect.unreachable("应该抛出重定向");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      const resp = thrown as Response;
      expect(resp.status).toBe(302);
      expect(resp.headers.get("Location")).toContain("/login");
    }
  });

  it("基金代码非六位：返回业务错误、不落单", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const { token } = await seedUser();

    const r = await action({
      request: postTrade({ intent: "buy", fundCode: "12345", amount: "100" }, token),
      context: fakeContext(),
      params: {},
    } as never) as { error?: string };

    expect(r.error).toBe("请输入 6 位基金代码");
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("金额非法：返回业务错误", async () => {
    await seedFund();
    const { token } = await seedUser();

    const r = await action({
      request: postTrade({ intent: "buy", fundCode: "000001", amount: "abc" }, token),
      context: fakeContext(),
      params: {},
    } as never) as { error?: string };

    expect(r.error).toBe("请输入正确的金额");
  });

  it("正常下单：返回 ok、生成 pending 单、现金立即冻结扣减", async () => {
    const db = getDb(env.DB);
    await seedFund();
    const { userId, token } = await seedUser();
    const cashBefore = (await db.query.account.findFirst({
      where: eq(account.userId, userId),
    }))!.cash;

    const r = await action({
      request: postTrade({ intent: "buy", fundCode: "000001", amount: "100" }, token),
      context: fakeContext(),
      params: {},
    } as never) as { ok?: boolean; message?: string };

    expect(r.ok).toBe(true);
    expect(r.message).toContain("下单成功");
    // pending 订单已落库
    const os = await db.select().from(orders);
    expect(os).toHaveLength(1);
    expect(os[0].status).toBe("pending");
    expect(os[0].fundCode).toBe("000001");
    // 买入立即冻结现金：100 元 = 10000 分
    const cashAfter = (await db.query.account.findFirst({
      where: eq(account.userId, userId),
    }))!.cash;
    expect(cashBefore - cashAfter).toBe(10000);
  });
});
