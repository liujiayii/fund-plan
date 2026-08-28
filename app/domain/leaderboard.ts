// app/domain/leaderboard.ts
import Decimal from "decimal.js";

/**
 * 收益排行榜的领域层（spec §2/§4.1）。
 *
 * 口径是本文件唯一的「为什么」：
 *   累计入金 = initialCash + totalCheckin
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
  initialCashCents: number;
  totalCheckinCents: number;
  /** 是否有过 confirmed 订单（上榜门槛） */
  hasTrades: boolean;
}

/** 计算完口径的条目。rank 由 rankLeaderboard 填，compute 出来时恒为 0 */
export interface LeaderboardEntry extends LeaderboardEntryInput {
  /** 总资产（分）= 市值 + 现金 */
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
      const totalAssetCents = r.marketValueCents + r.cashCents;
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
 * 同分同名次（1,2,2,4 型）：先按指标降序，同指标按 userId 升序破平，
 * rank = 「严格大于自己的条目数 + 1」，天然产出竞赛排名。
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
  return sorted.map((e) => {
    // 比较用 Decimal：rate 是普通小数，浮点直接比较在极接近时会误判同名次
    const strictlyGreater = sorted.filter(other =>
      new Decimal(metric(other)).greaterThan(metric(e)),
    ).length;
    return { ...e, rank: strictlyGreater + 1 };
  });
}
