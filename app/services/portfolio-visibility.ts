import type { Db } from "~/db/client";
import { eq } from "drizzle-orm";
import { user } from "~/db/schema";

export type PublicPortfolioDenial
  = | { ok: true }
    | { ok: false; status: 403 | 404; message: string };

/**
 * 排行榜点进他人公开组合的门。
 * 双向：看的人和被看的人都得开着「公开我的组合」。
 *
 * 自己没开时一律 403，不区分目标存不存在、开没开——
 * 否则关着的人能用 404/403 枚举全站 user id。
 * 自己开了之后：目标不存在 404，对方没开 403。
 */
export async function canViewPublicPortfolio(
  db: Db,
  viewerId: number,
  targetId: number,
): Promise<PublicPortfolioDenial> {
  if (viewerId === targetId) {
    return { ok: false, status: 403, message: "请到「我的」查看自己的组合" };
  }

  const [viewer, target] = await Promise.all([
    db.query.user.findFirst({
      where: eq(user.id, viewerId),
      columns: { portfolioPublic: true },
    }),
    db.query.user.findFirst({
      where: eq(user.id, targetId),
      columns: { portfolioPublic: true },
    }),
  ]);

  // 先看自己。关着的人连「这个 id 有没有人」都不该探到
  if (!viewer?.portfolioPublic) {
    return { ok: false, status: 403, message: "你未公开组合，不能查看他人的盘" };
  }
  if (!target) {
    return { ok: false, status: 404, message: "用户不存在" };
  }
  if (!target.portfolioPublic) {
    return { ok: false, status: 403, message: "对方未公开组合" };
  }
  return { ok: true };
}
