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

/** 同一基金同一目标下两次尝试的最小间隔（成功档，6 小时 ⇒ 单基金 ≤ 4 次/天） */
export const NAV_BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 失败后的短冷却。
 *
 * 为什么失败不能记满 6 小时（2026-09-23 对抗 review 修正）：上游抖一下
 * （跨境链路 7~8s 贴着超时线）就把数据停一整天，比「每个访客重试一次」
 * 还糟——而且后台任务还可能被平台的 30s waitUntil 预算掐死（见 fund-data 的
 * 回填预算注释），那时根本没写成任何数据，却已经锁死 6 小时。
 */
export const NAV_BACKFILL_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

/** shouldBackfillNav 的入参 */
export interface NavBackfillInput {
  /** 库里已有的净值行数 */
  rowCount: number;
  /** 上次回填尝试的时间戳（毫秒）；null = 从未尝试 */
  backfilledAt: number | null;
  /**
   * 上次尝试针对的行数目标（即当时的 minRows）；null = 迁移前的旧戳，视为未知。
   *
   * 为什么需要它：基金页要 60 行、回测页要 250 行，共用同一只基金。
   * 只看时间戳的话，基金页那次 60 行的尝试会把回测页连坐 6 小时——
   * 回测会静默按短窗口计算（正是回测页注释里要防的事）。
   */
  backfilledTarget: number | null;
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
    backfilledTarget,
    now,
    minRows = NAV_BACKFILL_MIN_ROWS,
    intervalMs = NAV_BACKFILL_INTERVAL_MS,
  } = params;

  // 历史已经够用
  if (rowCount >= minRows)
    return false;
  // 刚试过（含时钟回拨：尝试时间在未来时 now - backfilledAt 为负，同样落在间隔内）。
  // 例外：本次目标比上次大（回测页 250 > 基金页 60）就放行——那不是「重复劳动」
  if (
    backfilledAt !== null
    && now - backfilledAt < intervalMs
    && (backfilledTarget ?? 0) >= minRows
  ) {
    return false;
  }
  return true;
}

/**
 * 记一笔回填尝试。
 *
 * 成功 → 时间戳记 `now`（满间隔后才允许再试）；
 * 失败 → 把时间戳**往回拨**成「冷却期后的那一刻」，于是闸门只锁
 * `cooldownMs` 就重新放行，不必新增一列记状态。
 */
export function navBackfillStamp(params: {
  now: number;
  minRows: number;
  succeeded: boolean;
  intervalMs?: number;
  cooldownMs?: number;
}): { at: number; target: number } {
  const {
    now,
    minRows,
    succeeded,
    intervalMs = NAV_BACKFILL_INTERVAL_MS,
    cooldownMs = NAV_BACKFILL_FAILURE_COOLDOWN_MS,
  } = params;
  return {
    at: succeeded ? now : now - intervalMs + cooldownMs,
    target: minRows,
  };
}
