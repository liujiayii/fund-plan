import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, session, transactions, user } from "~/db/schema";
import { action as settingsAction } from "~/routes/me.settings";
import { loader as publicLoader } from "~/routes/users.$id";
import { registerUser } from "~/services/auth";
import { canViewPublicPortfolio } from "~/services/portfolio-visibility";
import { createSession, sessionCookie } from "~/services/session";
import { CloudflareContext } from "../../workers/app";

async function resetTables() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
}

beforeEach(resetTables);

function fakeContext(): unknown {
  return {
    get: (key: unknown) =>
      key === CloudflareContext
        ? { env, ctx: { waitUntil: () => {} } }
        : undefined,
  };
}

function authed(token: string, url: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", sessionCookie(token));
  return new Request(url, { ...init, headers });
}

async function openPublic(userId: number) {
  const db = getDb(env.DB);
  await db.update(user).set({ portfolioPublic: 1 }).where(eq(user.id, userId));
}

describe("canViewPublicPortfolio 双向公开", () => {
  it("双方都开着才放行", async () => {
    const db = getDb(env.DB);
    const alice = await registerUser(db, env, "alice", "hunter2");
    const bob = await registerUser(db, env, "bob", "hunter2");
    expect((await canViewPublicPortfolio(db, alice.id, bob.id)).ok).toBe(false);

    await openPublic(bob.id);
    const onlyTarget = await canViewPublicPortfolio(db, alice.id, bob.id);
    expect(onlyTarget.ok).toBe(false);
    if (!onlyTarget.ok)
      expect(onlyTarget.message).toContain("你未公开");

    await openPublic(alice.id);
    expect((await canViewPublicPortfolio(db, alice.id, bob.id)).ok).toBe(true);
  });

  it("自己看自己拒绝，目标不存在 404", async () => {
    const db = getDb(env.DB);
    const alice = await registerUser(db, env, "alice", "hunter2");
    const self = await canViewPublicPortfolio(db, alice.id, alice.id);
    expect(self.ok).toBe(false);
    if (!self.ok)
      expect(self.status).toBe(403);

    const missing = await canViewPublicPortfolio(db, alice.id, 99999);
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.status).toBe(403);
  });
});

describe("/users/:id loader", () => {
  it("未登录重定向登录页", async () => {
    const db = getDb(env.DB);
    const bob = await registerUser(db, env, "bob", "hunter2");
    const req = new Request(`https://x.dev/users/${bob.id}`);
    try {
      await publicLoader({
        request: req,
        params: { id: String(bob.id) },
        context: fakeContext(),
      } as never);
      expect.unreachable("应该重定向");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(302);
      expect((thrown as Response).headers.get("Location")).toContain("/login");
    }
  });

  it("对方未公开时 403，双方公开时返回详情", async () => {
    const db = getDb(env.DB);
    const alice = await registerUser(db, env, "alice", "hunter2");
    const bob = await registerUser(db, env, "bob", "hunter2");
    await openPublic(alice.id);
    const token = await createSession(db, alice.id);

    try {
      await publicLoader({
        request: authed(token, `https://x.dev/users/${bob.id}`),
        params: { id: String(bob.id) },
        context: fakeContext(),
      } as never);
      expect.unreachable("应该 403");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }

    await openPublic(bob.id);
    const data = await publicLoader({
      request: authed(token, `https://x.dev/users/${bob.id}`),
      params: { id: String(bob.id) },
      context: fakeContext(),
    } as never);
    expect(data.detail.user.username).toBe("bob");
  });

  it("自己开了之后，不存在的 id 才是 404", async () => {
    const db = getDb(env.DB);
    const alice = await registerUser(db, env, "alice", "hunter2");
    await openPublic(alice.id);
    const missing = await canViewPublicPortfolio(db, alice.id, 99999);
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.status).toBe(404);
  });

  it("关着的人访问已公开用户仍 403", async () => {
    const db = getDb(env.DB);
    const alice = await registerUser(db, env, "alice", "hunter2");
    const bob = await registerUser(db, env, "bob", "hunter2");
    await openPublic(bob.id);
    const token = await createSession(db, alice.id);
    try {
      await publicLoader({
        request: authed(token, `https://x.dev/users/${bob.id}`),
        params: { id: String(bob.id) },
        context: fakeContext(),
      } as never);
      expect.unreachable("应该 403");
    }
    catch (thrown) {
      expect((thrown as Response).status).toBe(403);
    }
  });
});

describe("设置页公开开关", () => {
  it("写入 0/1，其它值当成关闭", async () => {
    const db = getDb(env.DB);
    const alice = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, alice.id);

    const on = await settingsAction({
      request: authed(token, "https://x.dev/me/settings", {
        method: "POST",
        body: new URLSearchParams({ intent: "setPortfolioPublic", portfolioPublic: "1" }),
      }),
      context: fakeContext(),
    } as never);
    expect(on).toMatchObject({ ok: true });
    const row = await db.query.user.findFirst({ where: eq(user.id, alice.id) });
    expect(row?.portfolioPublic).toBe(1);

    await settingsAction({
      request: authed(token, "https://x.dev/me/settings", {
        method: "POST",
        body: new URLSearchParams({ intent: "setPortfolioPublic", portfolioPublic: "yes" }),
      }),
      context: fakeContext(),
    } as never);
    const closed = await db.query.user.findFirst({ where: eq(user.id, alice.id) });
    expect(closed?.portfolioPublic).toBe(0);
  });
});
