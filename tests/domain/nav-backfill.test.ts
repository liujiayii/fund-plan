import { describe, expect, it } from "vitest";
import {
  NAV_BACKFILL_INTERVAL_MS,
  NAV_BACKFILL_MIN_ROWS,
  shouldBackfillNav,
} from "~/domain/nav-backfill";

/**
 * 长历史回填的闸门。
 *
 * 修的是一个线上实测缺陷（2026-09-23，028439 银华中小盘混合C）：
 * 判据「净值行数 < 60」对**生命周期不足 60 个交易日的新基金**永久成立
 * （该基金上游总共只有 50 行），于是每次访问都白拉 3 页东财 + 写一遍 D1，
 * 永不收敛。闸门按「上次尝试时间」记忆化，单基金 ≤ 4 次/天。
 */
describe("shouldBackfillNav 回填闸门", () => {
  const now = new Date("2026-09-23T14:00:00+08:00").getTime();

  it("行数够（≥ minRows）就不回填", () => {
    expect(shouldBackfillNav({ rowCount: NAV_BACKFILL_MIN_ROWS, backfilledAt: null, now }))
      .toBe(false);
    expect(shouldBackfillNav({ rowCount: 400, backfilledAt: null, now }))
      .toBe(false);
  });

  it("行数不足且从未尝试过（NULL）→ 回填", () => {
    expect(shouldBackfillNav({ rowCount: 43, backfilledAt: null, now })).toBe(true);
  });

  it("刚尝试过（间隔内）→ 不再回填", () => {
    expect(
      shouldBackfillNav({
        rowCount: 43,
        backfilledAt: now - NAV_BACKFILL_INTERVAL_MS + 1000,
        now,
      }),
    ).toBe(false);
  });

  it("距上次尝试超过间隔 → 再试一次（数据会变旧，得留重试机会）", () => {
    expect(
      shouldBackfillNav({
        rowCount: 43,
        backfilledAt: now - NAV_BACKFILL_INTERVAL_MS - 1000,
        now,
      }),
    ).toBe(true);
  });

  it("一行都没有（从未落库）在间隔内也等——同一把闸门，不搞特例", () => {
    // 特例化会让「上游一直拉不到」的基金退回「每次访问拉一次」的老毛病
    expect(shouldBackfillNav({ rowCount: 0, backfilledAt: now, now })).toBe(false);
  });

  it("时钟回拨（尝试时间在未来）视为间隔内，不炸也不放行", () => {
    expect(shouldBackfillNav({ rowCount: 43, backfilledAt: now + 60_000, now }))
      .toBe(false);
  });
});
