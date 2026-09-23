/**
 * 长历史回填的闸门（纯函数，可脱离运行时单测）。
 *
 * 背景（2026-09-23 线上实测，基金 028439）：基金页与 /tools/dca-backtest 都用
 * 「净值行数 < 阈值」判断历史残缺，但对**生命周期不足 60 个交易日的新基金**
 * 这个条件永久成立（该基金上游总共只有 50 行），于是每次访问都要拉 3 页东财
 * 再写一遍 D1——永不收敛，且失败时把 8s 超时挂在访客的 TTFB 上。
 *
 * 闸门按「上次尝试时间」记忆化：不论成败都记，失败基金也不该被每个访客
 * 反复重试；间隔给的是「数据本来一天才变一次」的事实留出的重试机会。
 */

/** 净值行数低于它就认为历史残缺（≈ 一个季度的交易日） */
export const NAV_BACKFILL_MIN_ROWS = 60;

/** 同一基金两次回填尝试的最小间隔（6 小时 ⇒ 单基金 ≤ 4 次/天） */
export const NAV_BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** shouldBackfillNav 的入参 */
export interface NavBackfillInput {
  /** 库里已有的净值行数 */
  rowCount: number;
  /** 上次回填尝试的时间戳（毫秒）；null = 从未尝试 */
  backfilledAt: number | null;
  /** 当前时间戳（毫秒），注入便于测试 */
  now: number;
  /** 行数阈值（基金页用默认 60，回测页 250） */
  minRows?: number;
  /** 记忆化间隔，默认 NAV_BACKFILL_INTERVAL_MS */
  intervalMs?: number;
}

/** 是否需要为这只基金回填长历史 */
export function shouldBackfillNav(params: NavBackfillInput): boolean {
  const {
    rowCount,
    backfilledAt,
    now,
    minRows = NAV_BACKFILL_MIN_ROWS,
    intervalMs = NAV_BACKFILL_INTERVAL_MS,
  } = params;

  // 历史已经够用
  if (rowCount >= minRows)
    return false;
  // 刚试过（含时钟回拨：尝试时间在未来时 now - backfilledAt 为负，同样落在间隔内）
  if (backfilledAt !== null && now - backfilledAt < intervalMs)
    return false;
  return true;
}
