import dayjs from "dayjs";
import Decimal from "decimal.js";
import { roundInt } from "./money";

/**
 * 阶段涨幅（近1周/1月/3月/6月/1年/今年来/成立来）。
 *
 * 全部以**万分之整数**表示（沿用费率表示法，1.5% = 150），
 * 直接喂 `rateToPercent` 即得 "1.50%"。数据不足为 null，页面渲染「—」。
 */
export interface PeriodReturns {
  /** 近 1 周 */
  w1: number | null;
  /** 近 1 月 */
  m1: number | null;
  /** 近 3 月 */
  m3: number | null;
  /** 近 6 月 */
  m6: number | null;
  /** 近 1 年 */
  y1: number | null;
  /** 今年来（YTD） */
  ytd: number | null;
  /** 成立来 */
  all: number | null;
}

type NavPoint = { navDate: string; unitNav: number };

/**
 * 取 navDate ≤ target 的最后一条（前向填充）。series 必须升序。
 * 命中非交易日/停牌/净值未同步时自动回退到最近一条有净值的交易日。
 */
function floorNav(series: NavPoint[], target: string): NavPoint | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].navDate <= target)
      return series[i];
  }
  return null;
}

/**
 * 单个周期的收益率。target 为按自然日回推的目标日。
 *
 * target ≥ end.navDate → 目标日不早于末值，无区间 → null。
 * floorNav(target) 找不到（target 早于首条） → null。
 * 否则 = (end − start)/start ×10000，HALF_UP 取整。
 */
function periodReturn(series: NavPoint[], target: string, end: NavPoint): number | null {
  if (target >= end.navDate)
    return null;
  const start = floorNav(series, target);
  if (!start)
    return null;
  return roundInt(
    new Decimal(end.unitNav).minus(start.unitNav).div(start.unitNav).mul(10000),
  );
}

/**
 * 计算阶段涨幅。series 升序（旧→新），unitNav 为 ×10000 整数。
 *
 * 算法（spec §6）：以末条为 end，对每个周期按**自然日**回推目标日，
 * 取 navDate ≤ 目标日的最后一条为 start（前向填充），收益 = (end−start)/start。
 * YTD 取当年 1 月 1 日**之前**的最后一条（即上一年最后一日）。
 * 运算走 decimal.js，万分之整数回填。
 */
export function calcPeriodReturns(series: NavPoint[]): PeriodReturns {
  if (series.length === 0) {
    return { w1: null, m1: null, m3: null, m6: null, y1: null, ytd: null, all: null };
  }

  const end = series[series.length - 1];
  const endDate = dayjs(end.navDate);

  const all
    = series.length < 2
      ? null
      : roundInt(
          new Decimal(end.unitNav).minus(series[0].unitNav)
            .div(series[0].unitNav)
            .mul(10000),
        );

  return {
    w1: periodReturn(series, endDate.subtract(7, "day").format("YYYY-MM-DD"), end),
    m1: periodReturn(series, endDate.subtract(1, "month").format("YYYY-MM-DD"), end),
    m3: periodReturn(series, endDate.subtract(3, "month").format("YYYY-MM-DD"), end),
    m6: periodReturn(series, endDate.subtract(6, "month").format("YYYY-MM-DD"), end),
    y1: periodReturn(series, endDate.subtract(1, "year").format("YYYY-MM-DD"), end),
    // YTD：上一年最后一日（当年1月1日之前）
    ytd: periodReturn(
      series,
      endDate.startOf("year").subtract(1, "day").format("YYYY-MM-DD"),
      end,
    ),
    all,
  };
}
