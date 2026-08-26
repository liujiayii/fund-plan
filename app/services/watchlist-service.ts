import type { Db } from "~/db/client";
import { and, desc, eq, inArray } from "drizzle-orm";
import { fund, watchlist } from "~/db/schema";
// ⚠️ latestNavMap 在 portfolio-service.ts（本期 T3 Step1 刚导出），不是 fund-data.ts
import { ensureFund } from "./fund-data";
import { latestNavMap } from "./portfolio-service";

/**
 * 自选基金服务。与持仓无关——用户收藏的基金独立维护，
 * 用于「发现」页与详情页的加自选按钮。
 *
 * 复用 latestNavMap 保证自选列表的净值口径与 /me/holdings 估值同源，
 * 避免两处显示的「最新净值」对不上。
 */

/** 自选条目视图：带基金名、类型、最新净值与日涨跌，直接喂 FundListItem */
export interface WatchItem {
  fundCode: string;
  fundName: string;
  fundType: string;
  navDate: string | null;
  unitNav: number | null;
  /** 日涨跌率 ×10000（万分之）；无净值时 0（展示层用 PnlText 判色） */
  growthRate: number;
}

/**
 * 加自选。先 ensureFund 落档案（用户可能没访问过详情页），
 * 再插 watchlist；复合主键 + onConflictDoNothing 保证重复关注幂等。
 */
export async function addWatch(
  db: Db,
  env: Env,
  userId: number,
  fundCode: string,
): Promise<void> {
  // 先确保基金档案在库里（自选时 fund 表可能还没这只基金）
  const f = await ensureFund(db, env, fundCode);
  if (!f) {
    throw new Error(`没找到基金 ${fundCode}，无法加自选`);
  }
  // 复合主键 (userId, fundCode) 命中时静默吞掉，重复关注幂等
  await db
    .insert(watchlist)
    .values({ userId, fundCode, createdAt: Date.now() })
    .onConflictDoNothing();
}

/** 取消自选 */
export async function removeWatch(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<void> {
  await db
    .delete(watchlist)
    .where(
      and(eq(watchlist.userId, userId), eq(watchlist.fundCode, fundCode)),
    );
}

/** 是否已自选（详情页「加自选」按钮的初始态判断） */
export async function isWatched(
  db: Db,
  userId: number,
  fundCode: string,
): Promise<boolean> {
  const r = await db.query.watchlist.findFirst({
    where: and(
      eq(watchlist.userId, userId),
      eq(watchlist.fundCode, fundCode),
    ),
  });
  return !!r;
}

/**
 * 列出自选基金 + 最新净值 + 日涨跌。
 * 复用 latestNavMap 保证与 /me/holdings 估值同源（同一份净值口径）。
 */
export async function listWatch(db: Db, userId: number): Promise<WatchItem[]> {
  // 按加入时间倒序，最近加的排前面
  const rows = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.userId, userId))
    .orderBy(desc(watchlist.createdAt));

  const codes = rows.map(r => r.fundCode);
  if (codes.length === 0)
    return [];

  // 一次性拉所有相关基金档案，避免 N+1
  const funds = await db.select().from(fund).where(inArray(fund.code, codes));
  const fundMap = new Map(funds.map(f => [f.code, f]));
  // 复用组合估值的同源净值口径
  const navMap = await latestNavMap(db, codes);

  return rows.map((r) => {
    const f = fundMap.get(r.fundCode);
    const nav = navMap.get(r.fundCode);
    return {
      fundCode: r.fundCode,
      fundName: f?.name ?? r.fundCode,
      fundType: f?.type ?? "",
      navDate: nav?.navDate ?? null,
      unitNav: nav?.unitNav ?? null,
      growthRate: nav?.growthRate ?? 0,
    };
  });
}
