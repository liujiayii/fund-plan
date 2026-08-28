import type { Db } from "~/db/client";
import type { LeaderboardEntry, LeaderboardEntryInput } from "~/domain/leaderboard";
import { and, eq } from "drizzle-orm";
import { account, holding, orders, user } from "~/db/schema";
import {
  computeLeaderboard,
  rankLeaderboard,
} from "~/domain/leaderboard";
import { costBasisNavScaled, valuateHolding } from "~/domain/portfolio";
import { latestNavMap } from "~/services/portfolio-service";

/**
 * 排行榜 service（spec §4.2）：五次查询拼 LeaderboardEntryInput[]，喂领域层。
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
  // 只取仍有份额的持仓：清仓行份额为 0 但永久留存，不滤的话会把
  // 「全站历史持有过」的基金全灌进 latestNavMap 的查询里
  const active = holdings.filter(h => h.totalShares > 0);
  const codes = [...new Set(active.map(h => h.fundCode))];
  const navMap = await latestNavMap(db, codes);

  // ── 查询 4：哪些用户有过 confirmed 订单（上榜门槛） ────────────────
  const confirmedUserIds = new Set(
    (await db
      .selectDistinct({ userId: orders.userId })
      .from(orders)
      .where(eq(orders.status, "confirmed")))
      .map(r => r.userId),
  );

  // ── 查询 5：pending 买单的在途资金（下单即冻结现金，但份额要等撮合才生成；
  // 不计入的话 pending 窗口内榜上总资产凭空少一笔——每天 10:00 定投单生成到
  // 20:30 撮合之间，所有定投用户都会"凭空亏"一笔定投额） ──────────────
  const pendingBuyRows = await db
    .select({ userId: orders.userId, amount: orders.amount })
    .from(orders)
    .where(and(eq(orders.status, "pending"), eq(orders.side, "buy")));
  const inFlightByUser = new Map<number, number>();
  for (const r of pendingBuyRows) {
    const amt = r.amount ?? 0; // 理论非 null（买单必填），防御性兜 0
    inFlightByUser.set(r.userId, (inFlightByUser.get(r.userId) ?? 0) + amt);
  }

  // ── 市值聚合：userId → 持仓市值合计 ────────────────────────────────
  // 估值与 getPortfolio / getHoldingDetail 同源：valuateHolding + 无净值
  // 时 costBasisNavScaled 成本兜底（市值 ≈ 成本，盈亏 ≈ 0）。
  // 遍历 active（与 codes 同源），两处共用同一份过滤，逻辑不漂移。
  const marketValueByUser = new Map<number, number>();
  for (const h of active) {
    const navInfo = navMap.get(h.fundCode);
    const v = valuateHolding({
      fundCode: h.fundCode,
      totalSharesScaled: h.totalShares,
      totalCostCents: h.totalCost,
      // 无净值 → 成本兜底净值
      navScaled: navInfo ? navInfo.unitNav : costBasisNavScaled(h.totalCost, h.totalShares),
    });
    const prev = marketValueByUser.get(h.userId) ?? 0;
    marketValueByUser.set(h.userId, prev + v.marketValueCents);
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
      // 在途资金：该用户 pending 买单已冻结的金额（整数分直接累加）
      inFlightCashCents: inFlightByUser.get(u.userId) ?? 0,
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
