// app/domain/leaderboard.ts
import { safeRate } from "./money";

/**
 * 收益排行榜的领域层（spec §2/§4.1）。
 *
 * 口径是本文件唯一的「为什么」：
 *   累计入金   = initialCash + totalCheckin
 *   总资产     = 持仓市值 + 现金 + 在途资金（pending 买单已冻结金额）
 *   总收益     = 总资产 − 累计入金（已实现 + 浮动盈亏都在内）
 *   选基收益率 = 总收益 ÷ 累计买入金额    ← 分母只算真投进基金的钱
 * 这样清仓落袋的利润不会从榜上消失（浮盈口径会），签到是入金不算收益（刷不了榜）。
 * 与 asset-timeline 的「净入金」概念一致，全站口径自洽。
 *
 * ## 为什么只留选基收益率（2026-09-22）
 *
 * 曾经同时展示「账户收益率 = 总收益 ÷ 累计入金」。分母含没投出去的闲钱，
 * 轻仓用户会被稀释到看不出收益：只把 10 万里的 1000 元买了基金、赚 3.48 元，
 * 账户收益率 = 3.48 / 100000 = 0.0035%，四舍五入后是 0.00%——「赚了钱但
 * 收益率是 0」。它和选基收益率并排时，用户分不清哪个才是自己的成绩，
 * 所以全站去掉账户收益率，收益率榜、总览卡、后台都只留选基收益率。
 * 总收益金额本身不动（它仍然相对累计入金），拿掉的只是那个比率。
 *
 * ⚠️ 选基收益率的已知局限：分母是**累计买入额**（周转额），同一笔钱买入卖出
 * 再买入会重复计入，于是高频交易者的选基收益率会被系统性压低。它衡量的是
 * 「每投入一元赚了多少」，不是时间加权收益率——榜单展示够用，别拿它做归因。
 * 从未买过（investedCents = 0）时为 null，展示「—」，也不参与收益率榜排序。
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
  /** 累计买入金额（分）= Σ 已成交买单的下单金额。选基收益率的分母 */
  investedCents: number;
  /** 是否有过 confirmed 订单（上榜门槛） */
  hasTrades: boolean;
}

/** 计算完口径的条目。rank 由 rankLeaderboard 填，compute 出来时恒为 0 */
export interface LeaderboardEntry extends LeaderboardEntryInput {
  /** 总资产（分）= 市值 + 现金 + 在途资金 */
  totalAssetCents: number;
  /** 总收益（分）= 总资产 − 累计入金 */
  totalPnlCents: number;
  /**
   * 选基收益率（普通小数）= 总收益 ÷ 累计买入金额。
   * 从未买过（investedCents = 0）时为 null——「无数据」与「0%」必须区分开，
   * 页面据此显示「—」而不是一个会误导的 0.00%。
   * 收益率榜只排这个数；null 的人不进该榜（见 rankLeaderboard）。
   */
  investedPnlRate: number | null;
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
      // 分母为 0（从未买过）时 safeRate 返回 null：展示「—」，
      // 也不能拿一个假 0 去跟真·持平的人抢收益率榜的名次
      const investedPnlRate = safeRate(totalPnlCents, r.investedCents);

      return {
        ...r,
        totalAssetCents,
        totalPnlCents,
        investedPnlRate,
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
  // 收益率榜只排真买过的人：investedPnlRate 为 null 表示分母是 0，
  // 没有「选基能力」可排，塞进去只会占一个说不清的名次。
  // 总收益榜照旧全收——清仓落袋、只签到的人收益金额仍然有意义。
  const pool = by === "rate"
    ? entries.filter(e => e.investedPnlRate !== null)
    : entries;
  const metric = (e: LeaderboardEntry) => (by === "rate" ? e.investedPnlRate! : e.totalPnlCents);
  const sorted = [...pool].sort((a, b) => {
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

/**
 * 按 competition ranking 切「终榜条带」该吃的人。
 *
 * 完整领先档（四人并列第一则四条全进条带）+ 其余 rank ≤ 3 的条目。
 * 绝不能 slice(0, 3) 再分组——那会把并列第一的第 4 人踢进名单带，
 * 名次还写着 1（CodeRabbit PR #95）。
 *
 * 入参必须已经过 rankLeaderboard（按 rank 升序）。空榜三组全空。
 */
export function splitPodium(entries: LeaderboardEntry[]): {
  leads: LeaderboardEntry[];
  rest: LeaderboardEntry[];
  tape: LeaderboardEntry[];
} {
  if (entries.length === 0)
    return { leads: [], rest: [], tape: [] };
  const leadRank = entries[0].rank;
  let i = 0;
  while (i < entries.length && entries[i].rank === leadRank)
    i++;
  const leads = entries.slice(0, i);
  // 领先档已经覆盖「前三」时（三人及以上并列第一），后面不再补银铜
  while (i < entries.length && entries[i].rank <= 3)
    i++;
  return {
    leads,
    rest: entries.slice(leads.length, i),
    tape: entries.slice(i),
  };
}

/**
 * 奥林匹克三柱装得下才走领奖台。
 *
 * 门槛是 rank ≤ 3 合计 ≤ 3（三柱最多站 3 人），不是「只有四人并列第一才跌回」。
 * 1/2/3、两人并列第一、三人并列第一都走三柱；
 * 四人并列第一、1/2/3/3、1/2/2/2 都装不下——绝不能 slice(0,3)，
 * 否则并列的人会从台上消失。空榜 false。不改 splitPodium 的切分口径。
 */
export function isOlympicPodium(
  leads: LeaderboardEntry[],
  rest: LeaderboardEntry[],
): boolean {
  const n = leads.length + rest.length;
  return n > 0 && n <= 3;
}
