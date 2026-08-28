// app/domain/leaderboard.ts
import Decimal from "decimal.js";

/**
 * 收益排行榜的领域层（spec §2/§4.1）。
 *
 * 口径是本文件唯一的「为什么」：
 *   累计入金 = initialCash + totalCheckin
 *   总资产   = 持仓市值 + 现金 + 在途资金（pending 买单已冻结金额）
 *   总收益   = 总资产 − 累计入金（已实现 + 浮动盈亏都在内）
 *   收益率   = 总收益 ÷ 累计入金
 * 这样清仓落袋的利润不会从榜上消失（浮盈口径会），签到是入金不算收益（刷不了榜）。
 * 与 asset-timeline 的「净入金」概念一致，全站口径自洽。
 */

/** 单用户原始数据（service 层从 D1 查出后拼好喂进来） */
export interface LeaderboardEntryInput {
  userId: number;
  username: string;
  /** 持仓市值合计（分），由 service 用最新净值算好 */
  marketValueCents: number;
  cashCents: number;
  /** 在途资金（分）= 已冻结未撮合的买单金额 */
  inFlightCashCents: number;
  initialCashCents: number;
  totalCheckinCents: number;
  /** 是否有过 confirmed 订单（上榜门槛） */
  hasTrades: boolean;
}

/** 计算完口径的条目。rank 由 rankLeaderboard 填，compute 出来时恒为 0 */
export interface LeaderboardEntry extends LeaderboardEntryInput {
  /** 总资产（分）= 市值 + 现金 + 在途资金 */
  totalAssetCents: number;
  /** 总收益（分）= 总资产 − 累计入金 */
  totalPnlCents: number;
  /** 收益率（普通小数，0.05 表示 +5%） */
  totalPnlRate: number;
  rank: number;
}

/**
 * 过滤（门槛）+ 算口径。纯函数，不排序。
 * 门槛：从未成交的纯新号不上榜——它们收益恒为 0，榜上一堆 0% 空号没有信息量。
 */
export function computeLeaderboard(
  rows: LeaderboardEntryInput[],
): LeaderboardEntry[] {
  return rows
    .filter(r => r.hasTrades)
    .map((r) => {
      // 累计入金 = 初始本金 + 签到（两者都是 account 表现成字段）
      const depositedCents
        = r.initialCashCents + r.totalCheckinCents;
      // 总资产含在途资金：买单下单即冻结现金，但份额要等 T+1 撮合才生成，
      // pending 窗口内不计入的话榜上资产凭空少一笔定投额（整数分直接加减，无需 Decimal）
      const totalAssetCents
        = r.marketValueCents + r.cashCents + r.inFlightCashCents;
      const totalPnlCents = totalAssetCents - depositedCents;
      // 除零守卫：注册即有 init 入金，理论到不了 0，守卫只是不让 NaN 上榜
      const totalPnlRate
        = depositedCents === 0
          ? 0
          : new Decimal(totalPnlCents).div(depositedCents).toNumber();

      return {
        ...r,
        totalAssetCents,
        totalPnlCents,
        totalPnlRate,
        rank: 0,
      };
    });
}

/**
 * 排序并填 rank。by = 'rate'（收益率榜）/ 'pnl'（总收益榜）。
 *
 * 同分同名次（1,2,2,4 型）：先按指标降序，同指标按 userId 升序破平。
 * 单趟扫描：与前一名指标相等则继承名次，否则名次 = 下标 + 1。
 */
export function rankLeaderboard(
  entries: LeaderboardEntry[],
  by: "rate" | "pnl",
): LeaderboardEntry[] {
  const metric = (e: LeaderboardEntry) => (by === "rate" ? e.totalPnlRate : e.totalPnlCents);
  const sorted = [...entries].sort((a, b) => {
    const d = metric(b) - metric(a);
    return d !== 0 ? d : a.userId - b.userId;
  });
  // 单趟扫描：sorted 已按（指标 desc, userId asc）排好，指标与前一条相等则
  // 继承前一条名次（1,2,2,4 型），否则名次 = 下标 + 1。省掉对每条再做
  // O(n) 「数严格更大者」的重复扫描（原 O(n²)）。
  const ranked: LeaderboardEntry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const rank
      = i > 0 && metric(sorted[i]) === metric(sorted[i - 1])
        ? ranked[i - 1].rank
        : i + 1;
    ranked.push({ ...sorted[i], rank });
  }
  return ranked;
}
