import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, session, transactions, user } from "~/db/schema";
import { registerUser } from "~/services/auth";
import {
  assertOwnership,
  getAdminUser,
  getCurrentUser,
  requireAdmin,
  requireUser,
} from "~/services/guard";
import { createSession, sessionCookie } from "~/services/session";

/** 造一个带会话 Cookie 的请求 */
function requestWithToken(token: string, url = "https://x.dev/me"): Request {
  return new Request(url, {
    headers: { Cookie: sessionCookie(token) },
  });
}

async function resetTables() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
}

beforeEach(resetTables);

describe("getCurrentUser 当前用户", () => {
  it("无 Cookie 时返回 null（游客）", async () => {
    const db = getDb(env.DB);
    const req = new Request("https://x.dev/");
    expect(await getCurrentUser(req, db)).toBeNull();
  });

  it("有效会话返回用户信息", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    const u = await getCurrentUser(requestWithToken(token), db);
    expect(u).not.toBeNull();
    expect(u!.id).toBe(reg.id);
    expect(u!.username).toBe("alice");
    expect(u!.role).toBe("user");
  });

  it("伪造的 token 返回 null", async () => {
    const db = getDb(env.DB);
    expect(await getCurrentUser(requestWithToken("fake-token"), db)).toBeNull();
  });
});

describe("requireUser 强制登录", () => {
  it("已登录时正常返回用户", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    const u = await requireUser(requestWithToken(token), db);
    expect(u.id).toBe(reg.id);
  });

  it("未登录时抛出重定向到 /login", async () => {
    const db = getDb(env.DB);
    const req = new Request("https://x.dev/me/holdings");

    try {
      await requireUser(req, db);
      expect.unreachable("应该抛出重定向");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      const resp = thrown as Response;
      expect(resp.status).toBe(302);
      const loc = resp.headers.get("Location")!;
      expect(loc).toContain("/login");
      // 应带上原路径便于登录后跳回
      expect(decodeURIComponent(loc)).toContain("/me/holdings");
    }
  });
});

describe("getAdminUser 主理人账号", () => {
  it("主理人已注册时能查到，且角色为 admin", async () => {
    const db = getDb(env.DB);
    // 测试环境 ADMIN_USERNAME = 'testadmin'
    await registerUser(db, env, "testadmin", "hunter2");

    const admin = await getAdminUser(db, env);
    expect(admin).not.toBeNull();
    expect(admin!.username).toBe("testadmin");
    expect(admin!.role).toBe("admin");
  });

  it("主理人还没注册时返回 null（首页应据此显示引导，而非报错）", async () => {
    const db = getDb(env.DB);
    expect(await getAdminUser(db, env)).toBeNull();
  });

  it("存在其他用户但主理人未注册时仍返回 null", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "alice", "hunter2");
    expect(await getAdminUser(db, env)).toBeNull();
  });
});

describe("assertOwnership 越权防护", () => {
  it("操作自己的资源通过", () => {
    expect(() => assertOwnership(1, 1)).not.toThrow();
  });

  it("操作他人资源抛 403", () => {
    try {
      assertOwnership(1, 2);
      expect.unreachable("应该抛出 403");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }
  });
});

describe("requireAdmin 管理员守门", () => {
  it("admin 通过", async () => {
    const db = getDb(env.DB);
    // 测试环境 ADMIN_USERNAME = 'testadmin'
    const reg = await registerUser(db, env, "testadmin", "hunter2");
    const token = await createSession(db, reg.id);

    const u = await requireAdmin(requestWithToken(token), db);
    expect(u.id).toBe(reg.id);
    expect(u.role).toBe("admin");
  });

  it("普通用户抛 403", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    try {
      await requireAdmin(requestWithToken(token), db);
      expect.unreachable("应该抛出 403");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }
  });

  it("未登录抛 403（不是重定向——/admin 的存在本身就不该对游客暴露）", async () => {
    const db = getDb(env.DB);
    const req = new Request("https://x.dev/admin");

    try {
      await requireAdmin(req, db);
      expect.unreachable("应该抛出 403");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }
  });
});
