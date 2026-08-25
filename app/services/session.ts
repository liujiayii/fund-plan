import type { Db } from "~/db/client";
import { eq, lt } from "drizzle-orm";
import { session, user } from "~/db/schema";

/**
 * 会话管理。token 存在 httpOnly cookie 里，服务端用 session 表校验。
 * 不用 JWT——D1 查一次很便宜，而且服务端可随时吊销会话。
 */

/** Cookie 名 */
const COOKIE_NAME = "session";
/** 会话有效期：30 天 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

/** 创建会话，返回 token */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await db.insert(session).values({
    token,
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

/**
 * 读取会话对应的用户。
 * 过期或不存在都返回 null；顺手把过期记录删掉，避免表无限增长。
 */
export async function readSession(
  db: Db,
  token: string,
): Promise<{ userId: number; username: string; role: "admin" | "user" } | null> {
  if (!token)
    return null;

  const rows = await db
    .select({
      userId: session.userId,
      expiresAt: session.expiresAt,
      username: user.username,
      role: user.role,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(eq(session.token, token))
    .limit(1);

  const row = rows[0];
  if (!row)
    return null;

  // 过期：清理并视为未登录
  if (row.expiresAt <= Date.now()) {
    await db.delete(session).where(eq(session.token, token));
    return null;
  }

  return { userId: row.userId, username: row.username, role: row.role };
}

/** 销毁指定会话（登出） */
export async function destroySession(db: Db, token: string): Promise<void> {
  if (!token)
    return;
  await db.delete(session).where(eq(session.token, token));
}

/** 清理所有过期会话（可由 Cron 顺带调用） */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(session).where(lt(session.expiresAt, Date.now()));
}

/** 从请求头里解出会话 token */
export function readTokenFromRequest(request: Request): string {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME)
      return rest.join("=");
  }
  return "";
}

/**
 * 序列化会话 Cookie。
 * HttpOnly 防 XSS 读取；SameSite=Lax 防 CSRF；Secure 让它只走 HTTPS。
 * 本地 http://localhost 开发时 Secure 会被浏览器豁免，不影响调试。
 */
export function sessionCookie(token: string, maxAgeSec = SESSION_TTL_SEC): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAgeSec}`,
  ].join("; ");
}

/** 清除会话 Cookie（登出用） */
export function clearSessionCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Max-Age=0",
  ].join("; ");
}
