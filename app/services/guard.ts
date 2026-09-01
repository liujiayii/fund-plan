import type { Db } from "~/db/client";
import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { user } from "~/db/schema";
import { readSession, readTokenFromRequest } from "./session";

/**
 * 鉴权与权限矩阵。
 *
 * | 身份            | 看主理人组合 | 看自己组合 | 下单/定投/签到 |
 * |----------------|-----------|-----------|---------------|
 * | 游客（未登录）   | ✅ 只读    | —         | ❌            |
 * | 普通用户 user   | ✅ 只读    | ✅ 读写    | ✅（仅自己的） |
 * | 管理员 admin    | ✅ 读写    | 同上      | ✅            |
 *
 * admin 没有独立后台：主理人的 /me 就是被公开的那个盘，
 * /master 只是它的只读公开镜像。一份代码，两种身份。
 */

export interface CurrentUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

/**
 * 读取当前登录用户；未登录返回 null（游客，可继续浏览公开页）。
 */
export async function getCurrentUser(
  request: Request,
  db: Db,
): Promise<CurrentUser | null> {
  const token = readTokenFromRequest(request);
  if (!token)
    return null;

  const s = await readSession(db, token);
  if (!s)
    return null;

  return { id: s.userId, username: s.username, role: s.role };
}

/**
 * 要求已登录。未登录直接抛出重定向到登录页，
 * 并带上 redirectTo 便于登录后跳回原页面。
 */
export async function requireUser(
  request: Request,
  db: Db,
): Promise<CurrentUser> {
  const u = await getCurrentUser(request, db);
  if (!u) {
    const url = new URL(request.url);
    const to = encodeURIComponent(url.pathname + url.search);
    throw redirect(`/login?redirectTo=${to}`);
  }
  return u;
}

/**
 * 查出「主理人」（管理员）账号，其组合对所有人公开。
 * 由环境变量 ADMIN_USERNAME 指定；主理人还没注册时返回 null，
 * 首页应据此显示引导文案而不是报错。
 */
export async function getAdminUser(
  db: Db,
  env: Env,
): Promise<CurrentUser | null> {
  const name = env.ADMIN_USERNAME?.trim();
  if (!name)
    return null;

  const u = await db.query.user.findFirst({
    where: eq(user.username, name),
  });
  if (!u)
    return null;

  return { id: u.id, username: u.username, role: u.role };
}

/**
 * 要求管理员。未登录与普通用户都抛 403。
 *
 * 与 requireUser 的语义刻意不同：requireUser 未登录时重定向到 /login
 * （那是「你还没登录」的善意引导）；/admin 是管理后台，对非 admin
 * 一视同仁地拒绝，不暴露「这里有个后台」的信息。
 * 语义与 assertOwnership 的 403 一致。
 */
export async function requireAdmin(
  request: Request,
  db: Db,
): Promise<CurrentUser> {
  const u = await getCurrentUser(request, db);
  if (!u || u.role !== "admin") {
    throw new Response("仅管理员可访问", { status: 403 });
  }
  return u;
}

/**
 * 校验某项资源是否属于当前用户。
 * 所有「改自己数据」的 action 都要过这一关，防越权。
 */
export function assertOwnership(
  currentUserId: number,
  resourceUserId: number,
): void {
  if (currentUserId !== resourceUserId) {
    throw new Response("无权操作他人的数据", { status: 403 });
  }
}
