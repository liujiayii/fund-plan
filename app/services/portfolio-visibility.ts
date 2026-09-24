import type { Db } from "~/db/client";
import { eq } from "drizzle-orm";
import { user } from "~/db/schema";

export type PublicPortfolioDenial
  = | { ok: true }
    | { ok: false; status: 403 | 404; message: string };

/**
 * 排行榜点进他人公开组合的门。
 * 单向：只看被看的人开没开「公开我的组合」，看的人自己开不开无所谓。
 * 自己的开关只决定别人能不能看自己。
 *
 * 代价是登录用户能靠 404/403 的差别探到某个 id 存不存在、开没开——
 * 这是改成单向时接受的暴露，排行榜本来就会把开了的人亮出来。
 * 自己看自己不走这里（/me）；目标不存在 404，对方没开 403。
 */
export async function canViewPublicPortfolio(
  db: Db,
  viewerId: number,
  targetId: number,
): Promise<PublicPortfolioDenial> {
  if (viewerId === targetId) {
    return { ok: false, status: 403, message: "请到「我的」查看自己的组合" };
  }

  const target = await db.query.user.findFirst({
    where: eq(user.id, targetId),
    columns: { portfolioPublic: true },
  });

  if (!target) {
    return { ok: false, status: 404, message: "用户不存在" };
  }
  if (!target.portfolioPublic) {
    return { ok: false, status: 403, message: "对方未公开组合" };
  }
  return { ok: true };
}
