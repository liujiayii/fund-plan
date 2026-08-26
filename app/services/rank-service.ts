import type { FundRankItem } from "./fund-data";
import type { Db } from "~/db/client";
import type { PeriodReturns } from "~/domain/performance";
import { like } from "drizzle-orm";
import { fund } from "~/db/schema";
import { calcPeriodReturns } from "~/domain/performance";
import { fetchFundRank } from "./fund-data";
import { getNavSeries } from "./portfolio-service";

/** 基金类型 Tab：东财 ft 码 + 本地 fund.type 前缀（降级过滤用） */
export type FundType = "gp" | "hh" | "zs" | "zq";

/** 排行周期 Tab */
export type RankPeriod = "1m" | "3m" | "1y";

/** ft 码 → 本地类型前缀（东财 FTYPE 形如「混合型-灵活」） */
const TYPE_FT: Record<FundType, { ft: string; localPrefix: string; label: string }> = {
  gp: { ft: "gp", localPrefix: "股票", label: "股票型" },
  hh: { ft: "hh", localPrefix: "混合", label: "混合型" },
  zs: { ft: "zs", localPrefix: "指数", label: "指数型" },
  zq: { ft: "zq", localPrefix: "债券", label: "债券型" },
};

/** 周期 → 东财排序码 + 收益率列索引 + calcPeriodReturns 字段 */
const PERIOD: Record<RankPeriod, {
  sc: string;
  col: number;
  field: keyof PeriodReturns;
  label: string;
}> = {
  "1m": { sc: "1yzf", col: 8, field: "m1", label: "近 1 月" },
  "3m": { sc: "3yzf", col: 9, field: "m3", label: "近 3 月" },
  "1y": { sc: "1nzf", col: 11, field: "y1", label: "近 1 年" },
};

/** 类型 Tab 选项，供 Task 8 的 /funds 页面消费 */
export const FUND_TYPE_OPTIONS: { value: FundType; label: string }[] = [
  { value: "hh", label: "混合型" },
  { value: "gp", label: "股票型" },
  { value: "zs", label: "指数型" },
  { value: "zq", label: "债券型" },
];

/** 周期 Tab 选项，供 Task 8 的 /funds 页面消费 */
export const RANK_PERIOD_OPTIONS: { value: RankPeriod; label: string }[] = [
  { value: "1m", label: "近 1 月" },
  { value: "3m", label: "近 3 月" },
  { value: "1y", label: "近 1 年" },
];

/**
 * 基金排行榜：东财接口优先，挂掉时本地降级。
 *
 * 降级路径（spec §8 验收项「排行榜接口挂掉时页面仍可用」）：
 *  按 type 前缀过滤已入库基金，各自用本地 fund_nav 跑 calcPeriodReturns，
 *  取该周期值降序前 20。本地只有用户访问过的基金，榜单短但不空。
 */
export async function getFundRank(
  db: Db,
  env: Env,
  type: FundType,
  period: RankPeriod,
): Promise<FundRankItem[]> {
  const { ft, localPrefix } = TYPE_FT[type];
  const { sc, col, field } = PERIOD[period];

  // 1. 先试东财
  const remote = await fetchFundRank(env, ft, sc, col);
  if (remote.length > 0)
    return remote;

  // 2. 本地降级：按类型前缀过滤已入库基金
  const funds = await db
    .select()
    .from(fund)
    .where(like(fund.type, `${localPrefix}%`));
  if (funds.length === 0)
    return [];

  const ranked: FundRankItem[] = [];
  for (const f of funds) {
    const series = await getNavSeries(db, f.code);
    if (series.length === 0)
      continue;
    const ret = calcPeriodReturns(series);
    const periodRate = ret[field];
    // 该周期收益率为 null（数据不足）则跳过，不进榜
    if (periodRate === null)
      continue;
    const latest = series[series.length - 1];
    ranked.push({
      code: f.code,
      name: f.name,
      navDate: latest.navDate,
      unitNav: latest.unitNav,
      growthRate: latest.growthRate,
      periodRate,
    });
  }
  // 降序按周期收益
  ranked.sort((a, b) => (b.periodRate ?? 0) - (a.periodRate ?? 0));
  return ranked.slice(0, 20);
}
