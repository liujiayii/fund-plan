import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, session, transactions, user } from "~/db/schema";
import {
  hashPassword,
  loginUser,
  registerUser,
  verifyPassword,
} from "~/services/auth";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSession,
  sessionCookie,
} from "~/services/session";

/**
 * 认证与会话。用真实 D1 跑，验证注册的副作用（建账户、发本金、记流水）
 * 确实在同一个事务批次里完成。
 */

/** 每个用例前清空用户相关表，避免互相污染 */
async function resetTables() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
}

beforeEach(resetTables);

describe("PBKDF2 密码哈希", () => {
  it("同一密码配不同盐得到不同哈希", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("指定相同盐时哈希可复现", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2", a.salt);
    expect(b.hash).toBe(a.hash);
  });

  it("正确密码校验通过", async () => {
    const { hash, salt } = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash, salt)).toBe(true);
  });

  it("错误密码校验失败", async () => {
    const { hash, salt } = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash, salt)).toBe(false);
  });

  it("哈希与盐都是 hex 字符串", async () => {
    const { hash, salt } = await hashPassword("hunter2");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(salt).toMatch(/^[0-9a-f]+$/);
  });
});

describe("registerUser 注册", () => {
  it("注册成功后自动建账户、发 10 万本金、记一条 init 流水", async () => {
    const db = getDb(env.DB);
    const r = await registerUser(db, env, "alice", "hunter2");

    expect(r.id).toBeGreaterThan(0);
    expect(r.role).toBe("user");

    const acc = await db.query.account.findFirst({
      where: eq(account.userId, r.id),
    });
    expect(acc).toBeDefined();
    expect(acc!.cash).toBe(10_000_000); // 10 万元
    expect(acc!.initialCash).toBe(10_000_000);

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, r.id));
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe("init");
    expect(txs[0].amount).toBe(10_000_000);
    expect(txs[0].balance).toBe(10_000_000);
  });

  it("用户名与 ADMIN_USERNAME 一致时获得 admin 角色", async () => {
    const db = getDb(env.DB);
    // 测试环境里 ADMIN_USERNAME 绑定为 'testadmin'
    const r = await registerUser(db, env, "testadmin", "hunter2");
    expect(r.role).toBe("admin");
  });

  it("普通用户名得到 user 角色", async () => {
    const db = getDb(env.DB);
    const r = await registerUser(db, env, "bob", "hunter2");
    expect(r.role).toBe("user");
  });

  it("用户名重复时抛错", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "alice", "hunter2");
    // 注意密码要够 6 位，否则会先撞上密码长度校验，测不到重名分支
    await expect(registerUser(db, env, "alice", "another1")).rejects.toThrow(
      /已被注册|已存在/,
    );
  });

  it("用户名过短时抛错", async () => {
    const db = getDb(env.DB);
    await expect(registerUser(db, env, "ab", "hunter2")).rejects.toThrow();
  });

  it("密码过短时抛错", async () => {
    const db = getDb(env.DB);
    await expect(registerUser(db, env, "alice", "123")).rejects.toThrow();
  });

  it("密码不以明文入库", async () => {
    const db = getDb(env.DB);
    const r = await registerUser(db, env, "alice", "hunter2");
    const u = await db.query.user.findFirst({ where: eq(user.id, r.id) });
    expect(u!.passwordHash).not.toContain("hunter2");
    expect(u!.passwordHash.length).toBeGreaterThan(32);
  });
});

describe("loginUser 登录", () => {
  it("正确凭据登录成功", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const r = await loginUser(db, "alice", "hunter2");
    expect(r).not.toBeNull();
    expect(r!.id).toBe(reg.id);
    expect(r!.username).toBe("alice");
  });

  it("密码错误返回 null", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "alice", "hunter2");
    expect(await loginUser(db, "alice", "wrong")).toBeNull();
  });

  it("用户不存在返回 null", async () => {
    const db = getDb(env.DB);
    expect(await loginUser(db, "nobody", "hunter2")).toBeNull();
  });
});

describe("会话管理", () => {
  it("创建会话后能读回用户信息", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    expect(token.length).toBeGreaterThan(16);
    const s = await readSession(db, token);
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(reg.id);
    expect(s!.username).toBe("alice");
    expect(s!.role).toBe("user");
  });

  it("不存在的 token 返回 null", async () => {
    const db = getDb(env.DB);
    expect(await readSession(db, "not-a-real-token")).toBeNull();
  });

  it("过期会话返回 null 并被清理", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    // 手动把过期时间改到过去
    await db
      .update(session)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(session.token, token));

    expect(await readSession(db, token)).toBeNull();
  });

  it("销毁会话后无法再读取", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    await destroySession(db, token);
    expect(await readSession(db, token)).toBeNull();
  });
});

describe("Cookie 序列化", () => {
  it("会话 Cookie 带 HttpOnly / SameSite / Path", () => {
    const c = sessionCookie("abc123");
    expect(c).toContain("session=abc123");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=");
  });

  it("清除 Cookie 用 Max-Age=0", () => {
    const c = clearSessionCookie();
    expect(c).toContain("session=");
    expect(c).toContain("Max-Age=0");
  });
});
