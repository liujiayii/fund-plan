import dayjs from "dayjs";
import Decimal from "decimal.js";
import { RATE_SCALE, roundInt } from "./money";

/**
 * 「低估指数定投计划」页（`/plan`）的纯口径与计算。
 *
 * 页面讲两件事，两件都在这里落成可测的纯函数：
 *   1. **本期是哪个周二、主理人那天买了什么** —— `isPlanDay` / `latestPlanPeriod`
 *   2. **按自己的资金换算本期该投多少** —— `planTargetCents` / `allocateByWeight`
 *   以及 URL 参数的口径（`parsePlanQuery`，同 dca-backtest-params 的手法）。
 *
 * 为什么不并进 `dca.ts`：`dca.ts` 管的是站内「定投计划」的**调度**（频率、下次执行日、
 * 自动生成订单），这里是主理人**手工买入的公开复盘页**，两者只是名字撞车，
 * 没有任何共享口径。混在一起会让「改定投调度」的人误以为要动这一页。
 */

/** 定投执行日：每周二。dayjs 的 `day()`：0=周日 … 2=周二 */
export const PLAN_WEEKDAY = 2;

/**
 * 默认跟投比例：10%。
 *
 * 口径只有比例、没有「可用资金」——换算的基准是**主理人本期的买入金额**
 * （主人 2026-09-22 定稿：把资金输入框去掉）。所以「10%」= 每只都按他买的那只
 * 的十分之一跟，总额自然就是他这一期总额的十分之一，不必再让用户填一遍资金。
 */
export const PLAN_DEFAULT_RATIO_BPS = 1000;

/** 比例下限：万分之 1（0.01%）。再小四舍五入就成了 0，等于没填 */
export const PLAN_RATIO_MIN_BPS = 1;

/**
 * 比例上限：500%（万分之 50000）。
 * 允许超过 100%——资金比主理人充裕时按两倍、三倍跟是合理的用法；
 * 500% 只是防手滑的硬顶。
 */
export const PLAN_RATIO_MAX_BPS = 50_000;

/** YYYY-MM-DD。格式不对的日期一律不参与比较（脏日期进字符串比较会得出乱七八糟的结果） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 是不是定投执行日（周二）。
 *
 * 为什么按「星期几」而不是「每 7 天」：主理人的买入习惯就是跟着周历走，
 * 跨月、跨年都不会把同一周切成两期（与 `dca-backtest` 里「按周 = 自然周」同一口径）。
 */
export function isPlanDay(date: string): boolean {
  if (!DATE_RE.test(date))
    return false;
  return dayjs(date).day() === PLAN_WEEKDAY;
}

/**
 * 挑出「本期」：不晚于 `today` 的、**最近一个有买入记录**的周二。
 *
 * 「有买入记录」而不是「最近的周二」是关键：主理人这周二还没买（或者在忙别的），
 * 页面就该停在上一期的明细上，而不是甩出一张空表——这是主人明确要的行为
 * （「如果没有买入则停留在上一期的买入明细」）。
 *
 * 非周二的买入日不进候选：那些是主理人的机动加仓，不属于这个按周发布的计划。
 */
export function latestPlanPeriod(
  placeDates: readonly string[],
  today: string,
): string | null {
  let best: string | null = null;
  for (const d of placeDates) {
    // 未来的单子不算（理论上不该有，但 place_date 是文本，别赌）
    if (!isPlanDay(d) || d > today)
      continue;
    if (best === null || d > best)
      best = d;
  }
  return best;
}

/**
 * 不晚于 `today` 的最近一个周二（**不要求那天有买入**）。
 *
 * 与 `latestPlanPeriod` 的分工：那个回答「页面上该展示哪一期」，这个回答
 * 「那一期是不是本周的」——不是的话页面要明说「主理人本周二还没买入，
 * 以下停留在上一期」，否则读者会以为那就是他这周的实盘。
 */
export function currentPlanDay(today: string): string | null {
  if (!DATE_RE.test(today))
    return null;
  const d = dayjs(today);
  if (!d.isValid())
    return null;
  // 往回退 (今天星期几 − 周二) % 7 天：今天就是周二时退 0 天
  return d.subtract((d.day() - PLAN_WEEKDAY + 7) % 7, "day").format("YYYY-MM-DD");
}

/**
 * 本期目标总额（分）= **基准金额** × 跟投比例。
 *
 * 基准是主理人本期的买入合计（页面上那列「买入金额」的总和），
 * 于是「跟 10%」就是每只都按他的十分之一跟——用户不需要再填一遍自己的资金。
 * 比例是**万分之**整数（10% → 1000），与库里费率同一套缩放，别传普通小数。
 */
export function planTargetCents(baseCents: number, ratioBps: number): number {
  if (!Number.isFinite(baseCents) || !Number.isFinite(ratioBps))
    return 0;
  if (baseCents <= 0 || ratioBps <= 0)
    return 0;
  return roundInt(new Decimal(baseCents).mul(ratioBps).div(RATE_SCALE));
}

/** 一只基金在换算里的权重：等于主理人本期买它的金额（分） */
export interface PlanWeight {
  fundCode: string;
  weightCents: number;
}

/** 换算结果：这只基金本期该投多少（分） */
export interface PlanAllocation {
  fundCode: string;
  amountCents: number;
}

/**
 * 按主理人的买入金额占比，把 `targetCents` 拆到各基金上。
 *
 * **最大余数法**，保证 Σ分配 == targetCents（一分不差）。
 *
 * 为什么不能各自四舍五入完事：9 只基金各自取整，误差 ±4 分是常态——
 * 用户把页面上的数字加一遍，会发现和自己填的总额对不上。金融页面上这种
 * 「差几分」最伤信任，而它本来是可以做到零误差的。
 *
 * 做法：先各自向下取整，余额按小数部分从大到小逐个补 1 分。余额必定落在
 * `[0, n-1]`（每个小数部分都 < 1，Σ小数部分 = Σ精确值 − Σ下取整 = 余额），
 * 所以一趟发得完。并列时按下标先后补——顺序稳定，刷新两次不会换人加这一分。
 *
 * 输出顺序与入参一致（页面按主理人的买入顺序展示，不重排）。
 */
export function allocateByWeight(
  weights: readonly PlanWeight[],
  targetCents: number,
): PlanAllocation[] {
  const zero = weights.map(w => ({ fundCode: w.fundCode, amountCents: 0 }));
  if (!Number.isFinite(targetCents) || targetCents <= 0)
    return zero;

  // 权重取非负：主理人的买入金额不该为负，真出现脏数据也不让它反向吃掉别人的份额
  const safe = weights.map(w => Math.max(0, w.weightCents));
  const total = safe.reduce((s, v) => s + v, 0);
  // 这期一只都没买、或全为 0：没有比例可用，不编数字，如实给 0
  if (total <= 0)
    return zero;

  const exact = safe.map(v => new Decimal(targetCents).mul(v).div(total));
  const out = exact.map(e => e.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber());
  const rest = targetCents - out.reduce((s, v) => s + v, 0);

  const order = exact
    .map((_, i) => i)
    .sort((a, b) => exact[b]!.cmp(exact[a]!) || a - b);
  for (let k = 0; k < rest; k++) {
    const idx = order[k % order.length]!;
    out[idx] = out[idx]! + 1;
  }

  return weights.map((w, i) => ({ fundCode: w.fundCode, amountCents: out[i]! }));
}

/**
 * 只解析 query 的取值，避免 domain 依赖 URL / Request 这些宿主对象
 * （与 dca-backtest-params 的 QueryGetter 同一手法）。
 */
export interface PlanQueryGetter {
  get: (name: string) => string | null;
}

/** `parsePlanQuery` 的结果：可直接用的值 + 被回落时的提示 */
export interface PlanQuery {
  /** 跟投比例（万分之） */
  ratioBps: number;
  /** 参数被回落时的提示（空数组 = 一切正常），页面按行展示 */
  notices: string[];
}

/** 万分之 → 百分比文案，去掉无意义的尾零：1000 → "10%"、150 → "1.5%" */
function ratioText(bps: number): string {
  return `${new Decimal(bps).div(100).toDecimalPlaces(2).toString()}%`;
}

/** 百分比文本 → 万分之整数。非法（空 / 非数字 / 非正）返回 null */
function parseRatioBps(text: string): number | null {
  const t = text.trim();
  if (t === "")
    return null;
  // decimal.js 会收下 "NaN" / "Infinity"（返回非有限值、不抛），先过一道 Number 挡掉
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0)
    return null;
  try {
    const bps = roundInt(new Decimal(t).mul(100));
    return bps > 0 ? bps : null;
  }
  catch {
    return null;
  }
}

/**
 * 解析本页的 `?ratio=`（百分比，与输入框所见一致）。
 *
 * 纪律与全站一致：非法值一律**回落（或收到边界内）+ 留一条提示**。URL 是公开页
 * 的用户输入，还能被分享、被爬虫改；既不能把页面打成 500，也不能静默改口径——
 * 用户填了 50% 却看到按 10% 算的数字，比直接报错更糟。
 */
export function parsePlanQuery(params: PlanQueryGetter): PlanQuery {
  const notices: string[] = [];
  let ratioBps = PLAN_DEFAULT_RATIO_BPS;

  const rawRatio = params.get("ratio");
  if (rawRatio !== null) {
    const parsed = parseRatioBps(rawRatio);
    if (parsed === null) {
      notices.push(
        `跟投比例请填 ${ratioText(PLAN_RATIO_MIN_BPS)} ~ ${ratioText(PLAN_RATIO_MAX_BPS)} 的数字，`
        + `已按 ${ratioText(PLAN_DEFAULT_RATIO_BPS)} 换算`,
      );
    }
    else if (parsed > PLAN_RATIO_MAX_BPS) {
      // 越界**收到上边界**而不是回默认值：填了 800% 却掉回 10% 会莫名其妙，
      // 收到 500% 至少方向是对的，提示里也写清了发生了什么
      notices.push(`跟投比例最多 ${ratioText(PLAN_RATIO_MAX_BPS)}，已按上限换算`);
      ratioBps = PLAN_RATIO_MAX_BPS;
    }
    else {
      ratioBps = parsed;
    }
  }

  return { ratioBps, notices };
}

/** 万分之 → 输入框里的百分比文本（与 ratioText 同口径，去掉尾零） */
export function bpsToInputText(bps: number): string {
  return ratioText(bps).replace(/%$/, "");
}
