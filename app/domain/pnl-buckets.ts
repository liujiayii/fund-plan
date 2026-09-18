import type { FundDayPnl } from "./fund-pnl";
import dayjs from "dayjs";
import Decimal from "decimal.js";

/**
 * 收益日历的**统计粒度分桶**（纯函数，domain 层，零运行时依赖）。
 *
 * 收益日历原本只有「按日」一种粒度，这里把逐日快照按 日 / 周 / 月 / 年
 * 四种粒度归并成桶（bucket）：
 *   - 金额：桶内逐日 dayPnlCents **求和**（整数域累加，零误差）；
 *   - 收益率：桶内逐日 dayPnlRate **连乘**（复利），见 compoundRate 的论证。
 * 两个口径都与逐日序列同源——任意粒度下 Σ桶金额 === Σ逐日金额，
 * 粒度只改变「怎么分组」，绝不改变总额。
 *
 * 键（key）与页（page）是两个层次：
 *   key  = 一个格子（如 "2026-09-05" / "2026-09-01"(周一) / "2026-09" / "2026"）
 *   page = 日历一次展示的范围（日粒度一月一页、周/月粒度一年一页、
 *          年粒度只有一页），翻页按钮翻的是它。
 * 两者都用字典序可比对的字符串，升降序/边界判断直接用字符串比较。
 */

/** 统计粒度 */
export type PnlDimension = "day" | "week" | "month" | "year";

/**
 * 年粒度只有一页（数据里出现过的全部年份同屏），页标识用这个哨兵值。
 * 组件据它决定「不渲染翻页按钮」。
 */
export const ALL_PAGES = "all";

/** 参与分桶的逐日条目（收益日历 data 的最小形状，与 ProfitCalendar 的 Pick 对齐） */
export interface DailyPnlEntry {
  /** YYYY-MM-DD */
  date: string;
  dayPnlCents: number;
  dayPnlRate: number;
}

/** 一个粒度桶（日历的一格 + 明细区的一次查询范围） */
export interface PnlBucket {
  /** 稳定键：day → "YYYY-MM-DD"、week → 周一的 "YYYY-MM-DD"、month → "YYYY-MM"、year → "YYYY" */
  key: string;
  /** 桶内第一条有数据的日期（含） */
  startDate: string;
  /** 桶内最后一条有数据的日期（含） */
  endDate: string;
  /** 桶内参与归并的逐日条目数（交易日/有流水日，非自然日） */
  days: number;
  /** 区间收益（分）= Σ 逐日 dayPnlCents */
  pnlCents: number;
  /** 区间收益率 = ∏(1 + 逐日 dayPnlRate) − 1 */
  pnlRate: number;
}

/** 桶按 key 升序（四种 key 都是字典序可比的：YYYY ≤ YYYY-MM ≤ YYYY-MM-DD） */
function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * 日期所属自然周的周一（周一为一周之始，与国内日历习惯一致）。
 * dayjs 的 .day()：0=周日 … 6=周六 → 距周一的偏移 = (day + 6) % 7。
 */
export function mondayOf(date: string): string {
  const d = dayjs(date);
  return d.subtract((d.day() + 6) % 7, "day").format("YYYY-MM-DD");
}

/**
 * 日期 → 所属桶 key。
 *
 * ⚠️ 跨年的周整体归**周一所在年份**（周一是 2025-12-29，则 2026-01-01 也落进
 * 2025 年的桶）。这样同一周只会出现在一页上、金额也只会被算一次；
 * 若按自然年切分跨年周，同一周会在两年的页上各显示半截，看着像两笔。
 */
export function bucketKeyOfDate(date: string, dimension: PnlDimension): string {
  switch (dimension) {
    case "day":
      return date;
    case "week":
      return mondayOf(date);
    case "month":
      return date.slice(0, 7);
    case "year":
      return date.slice(0, 4);
  }
}

/** 桶 key → 所属页（日历一次展示的范围） */
export function pageOfKey(key: string, dimension: PnlDimension): string {
  switch (dimension) {
    case "day":
      return key.slice(0, 7); // YYYY-MM
    case "week":
      return key.slice(0, 4); // 周一所处的年
    case "month":
      return key.slice(0, 4);
    case "year":
      return ALL_PAGES;
  }
}

/** 日期 → 所属页（= pageOfKey(bucketKeyOfDate(date, dim), dim) 的便捷入口） */
export function pageOfDate(date: string, dimension: PnlDimension): string {
  return pageOfKey(bucketKeyOfDate(date, dimension), dimension);
}

/**
 * 翻页：day 按自然月、week/month 按自然年、year 无页可翻（原样返回）。
 * 超出数据范围的边界由调用方（组件）按首页/末页判断。
 */
export function shiftPage(page: string, dimension: PnlDimension, delta: number): string {
  switch (dimension) {
    case "day":
      return dayjs(`${page}-01`).add(delta, "month").format("YYYY-MM");
    case "week":
    case "month":
      return String(Number(page) + delta);
    case "year":
      return page;
  }
}

/**
 * 区间收益率 = ∏(1 + 日收益率) − 1（复利连乘，不是算术相加）。
 *
 * 为什么连乘：日收益率是「当日资产相对前一日资产」的变动率，多日叠加是复利
 * 关系；直接相加会把每日基数差异忽略掉（且连跌时误差符号还会反向）。
 * 单日传入即原值，因此日粒度与改造前的行为逐位一致。
 *
 * 用 Decimal 连乘而非 JS 浮点：日收益率本身已是浮点（上游 Decimal 除法的
 * .toNumber()），连乘 250 次的浮点尾巴会累积到影响分档阈值，走 Decimal
 * 收在 20 位有效数字内。
 */
export function compoundRate(rates: readonly number[]): number {
  let acc = new Decimal(1);
  for (const r of rates) {
    acc = acc.times(new Decimal(1).plus(r));
  }
  return acc.minus(1).toNumber();
}

/**
 * 逐日条目 → 粒度桶（升序）。空输入返回空数组。
 * day 粒度即原样透传（每桶一天），不额外建 Map，省一次全量遍历。
 */
export function bucketDailyPnl(
  entries: readonly DailyPnlEntry[],
  dimension: PnlDimension,
): PnlBucket[] {
  if (dimension === "day") {
    return entries
      .map(e => ({
        key: e.date,
        startDate: e.date,
        endDate: e.date,
        days: 1,
        pnlCents: e.dayPnlCents,
        pnlRate: e.dayPnlRate,
      }))
      .sort(byKey);
  }

  // 一个桶累加期间的中间态：金额直接加（整数域），收益率先收集再统一连乘
  const acc = new Map<
    string,
    { pnlCents: number; rates: number[]; startDate: string; endDate: string; days: number }
  >();

  for (const e of entries) {
    const key = bucketKeyOfDate(e.date, dimension);
    const b = acc.get(key);
    if (!b) {
      acc.set(key, {
        pnlCents: e.dayPnlCents,
        rates: [e.dayPnlRate],
        startDate: e.date,
        endDate: e.date,
        days: 1,
      });
      continue;
    }
    b.pnlCents += e.dayPnlCents;
    b.rates.push(e.dayPnlRate);
    b.days += 1;
    if (e.date < b.startDate)
      b.startDate = e.date;
    if (e.date > b.endDate)
      b.endDate = e.date;
  }

  return [...acc.entries()]
    .map(([key, b]) => ({
      key,
      startDate: b.startDate,
      endDate: b.endDate,
      days: b.days,
      pnlCents: b.pnlCents,
      pnlRate: compoundRate(b.rates),
    }))
    .sort(byKey);
}

/**
 * 日期 → 各基金收益 的归因表（服务层产物）→ 区间内各基金贡献。
 *
 * 明细区点开某个桶时要看的是「这一个区间里谁在出力」，因此按基金把
 * [startDate, endDate]（闭区间，字符串比较即可，日期串字典序 = 时间序）
 * 内的条目归并起来：金额求和、涨跌幅连乘。
 * 日粒度（start === end）结果与直接取当日数组一致。
 */
export function aggregateFundPnlRange(
  byDate: Record<string, FundDayPnl[]>,
  startDate: string,
  endDate: string,
): FundDayPnl[] {
  const acc = new Map<string, { pnlCents: number; rates: number[] }>();

  for (const [date, list] of Object.entries(byDate)) {
    if (date < startDate || date > endDate)
      continue;
    for (const e of list) {
      const a = acc.get(e.fundCode);
      if (a) {
        a.pnlCents += e.dayPnlCents;
        a.rates.push(e.dayNavRate);
      }
      else {
        acc.set(e.fundCode, { pnlCents: e.dayPnlCents, rates: [e.dayNavRate] });
      }
    }
  }

  return [...acc.entries()].map(([fundCode, a]) => ({
    fundCode,
    dayPnlCents: a.pnlCents,
    dayNavRate: compoundRate(a.rates),
  }));
}
