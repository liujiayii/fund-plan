import { eq } from 'drizzle-orm';
import { redirect } from 'react-router';
import type { Db } from '~/db/client';
import { user } from '~/db/schema';
import { readSession, readTokenFromRequest } from './session';

/**
 * 鉴权与权限矩阵。
 *
 * | 身份            | 看主人组合 | 看自己组合 | 下单/定投/签到 |
 * |----------------|-----------|-----------|---------------|
 * | 游客（未登录）   | ✅ 只读    | —         | ❌            |
 * | 普通用户 user   | ✅ 只读    | ✅ 读写    | ✅（仅自己的） |
 * | 管理员 admin    | ✅ 读写    | 同上      | ✅            |
 *
 * admin 没有独立后台：主人的 /me 就是被公开的那个盘，
 * /master 只是它的只读公开镜像。一份代码，两种身份。
 */

export interface CurrentUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

/**
 * 读取当前登录用户；未登录返回 null（游客，可继续浏览公开页）。
 */
export async function getCurrentUser(
  request: Request,
  db: Db,
): Promise<CurrentUser | null> {
  const token = readTokenFromRequest(request);
  if (!token) return null;

  const s = await readSession(db, token);
  if (!s) return null;

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
 * 查出「主人」（管理员）账号，其组合对所有人公开。
 * 由环境变量 ADMIN_USERNAME 指定；主人还没注册时返回 null，
 * 首页应据此显示引导文案而不是报错。
 */
export async function getAdminUser(
  db: Db,
  env: Env,
): Promise<CurrentUser | null> {
  const name = env.ADMIN_USERNAME?.trim();
  if (!name) return null;

  const u = await db.query.user.findFirst({
    where: eq(user.username, name),
  });
  if (!u) return null;

  return { id: u.id, username: u.username, role: u.role };
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
    throw new Response('无权操作他人的数据', { status: 403 });
  }
}
