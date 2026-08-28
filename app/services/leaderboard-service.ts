// app/services/leaderboard-service.ts
import type { Db } from "~/db/client";
import type { LeaderboardEntry, LeaderboardEntryInput } from "~/domain/leaderboard";
import { eq } from "drizzle-orm";
import { account, holding, orders, user } from "~/db/schema";
import {
  computeLeaderboard,
  rankLeaderboard,
} from "~/domain/leaderboard";
import { navToDecimal, roundInt, sharesToDecimal, YUAN } from "~/domain/money";
import { latestNavMap } from "~/services/portfolio-service";

/**
 * 排行榜 service（spec §4.2）：四次查询拼 LeaderboardEntryInput[]，喂领域层。
 *
 * 刻意不做 KV 缓存 / cron 物化：模拟盘用户量小，全量内存计算绰绰有余，
 * KV 写入 1000 次/天是全站最紧额度，别去挤。
 * 任何一步查不到数据都不抛：空数据让页面渲染空态。
 */

/** 页面直接消费的视图：两个维度各自排好序 */
export interface LeaderboardView {
  byRate: LeaderboardEntry[];
  byPnl: LeaderboardEntry[];
}

export async function getLeaderboard(db: Db): Promise<LeaderboardView> {
  // ── 查询 1：全量用户 + 账户 ──────────────────────────────────────
  const users = await db
    .select({
      userId: user.id,
      username: user.username,
      cash: account.cash,
      initialCash: account.initialCash,
      totalCheckin: account.totalCheckin,
    })
    .from(user)
    .leftJoin(account, eq(account.userId, user.id));

  // ── 查询 2：全量持仓 ─────────────────────────────────────────────
  const holdings = await db.select().from(holding);

  // ── 查询 3：最新净值（一次取所有涉及基金） ────────────────────────
  const codes = [...new Set(holdings.map(h => h.fundCode))];
  const navMap = await latestNavMap(db, codes);

  // ── 查询 4：哪些用户有过 confirmed 订单（上榜门槛） ────────────────
  const confirmedUserIds = new Set(
    (await db
      .selectDistinct({ userId: orders.userId })
      .from(orders)
      .where(eq(orders.status, "confirmed")))
      .map(r => r.userId),
  );

  // ── 市值聚合：userId → 持仓市值合计 ────────────────────────────────
  // 口径：无净值时按成本兜底（市值 = 成本，盈亏为 0）。
  // 注意：getPortfolio 的兜底公式（成本/份额折算净值）存在 ×100 缩放偏差，
  // 兜底市值会低估百倍；此处不复刻该偏差（上游 bug 已另行记录）。
  const marketValueByUser = new Map<number, number>();
  for (const h of holdings) {
    // 过滤已清仓行（份额 0 的持仓记录还在表里，市值贡献为 0）
    if (h.totalShares <= 0)
      continue;
    const navInfo = navMap.get(h.fundCode);
    // 无净值 → 成本兜底（市值 = 成本）
    const mvCents = navInfo
      ? roundInt(
          sharesToDecimal(h.totalShares)
            .mul(navToDecimal(navInfo.unitNav))
            .mul(YUAN),
        )
      : h.totalCost;
    const prev = marketValueByUser.get(h.userId) ?? 0;
    marketValueByUser.set(h.userId, prev + mvCents);
  }

  // ── 拼 LeaderboardEntryInput 喂领域层 ─────────────────────────────
  const inputs: LeaderboardEntryInput[] = users.map((u) => {
    const mv = marketValueByUser.get(u.userId) ?? 0;
    return {
      userId: u.userId,
      username: u.username,
      marketValueCents: mv,
      // leftJoin 无 account 时兜 0（防御，正常注册必有 account）
      cashCents: u.cash ?? 0,
      initialCashCents: u.initialCash ?? 0,
      totalCheckinCents: u.totalCheckin ?? 0,
      hasTrades: confirmedUserIds.has(u.userId),
    };
  });

  const entries = computeLeaderboard(inputs);
  return {
    byRate: rankLeaderboard(entries, "rate"),
    byPnl: rankLeaderboard(entries, "pnl"),
  };
}
