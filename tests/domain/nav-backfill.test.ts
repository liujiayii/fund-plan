import { describe, expect, it } from "vitest";
import {
  NAV_BACKFILL_FAILURE_COOLDOWN_MS,
  NAV_BACKFILL_INTERVAL_MS,
  NAV_BACKFILL_MIN_ROWS,
  navBackfillStamp,
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
    expect(
      shouldBackfillNav({
        rowCount: NAV_BACKFILL_MIN_ROWS,
        backfilledAt: null,
        backfilledTarget: null,
        now,
      }),
    ).toBe(false);
    expect(
      shouldBackfillNav({
        rowCount: 400,
        backfilledAt: null,
        backfilledTarget: null,
        now,
      }),
    ).toBe(false);
  });

  it("行数不足且从未尝试过（NULL）→ 回填", () => {
    expect(
      shouldBackfillNav({
        rowCount: 43,
        backfilledAt: null,
        backfilledTarget: null,
        now,
      }),
    ).toBe(true);
  });

  it("刚尝试过（间隔内）→ 不再回填", () => {
    expect(
      shouldBackfillNav({
        rowCount: 43,
        backfilledAt: now - NAV_BACKFILL_INTERVAL_MS + 1000,
        backfilledTarget: NAV_BACKFILL_MIN_ROWS,
        now,
      }),
    ).toBe(false);
  });

  it("距上次尝试超过间隔 → 再试一次（数据会变旧，得留重试机会）", () => {
    expect(
      shouldBackfillNav({
        rowCount: 43,
        backfilledAt: now - NAV_BACKFILL_INTERVAL_MS - 1000,
        backfilledTarget: NAV_BACKFILL_MIN_ROWS,
        now,
      }),
    ).toBe(true);
  });

  it("一行都没有（从未落库）在间隔内也等——同一把闸门，不搞特例", () => {
    // 特例化会让「上游一直拉不到」的基金退回「每次访问拉一次」的老毛病
    expect(
      shouldBackfillNav({
        rowCount: 0,
        backfilledAt: now,
        backfilledTarget: NAV_BACKFILL_MIN_ROWS,
        now,
      }),
    ).toBe(false);
  });

  it("时钟回拨（尝试时间在未来）视为间隔内，不炸也不放行", () => {
    expect(
      shouldBackfillNav({
        rowCount: 43,
        backfilledAt: now + 60_000,
        backfilledTarget: NAV_BACKFILL_MIN_ROWS,
        now,
      }),
    ).toBe(false);
  });
});

/**
 * 「记一笔尝试」与「该不该再试」是一对：失败不能锁满 6 小时（上游抖一下
 * 不该让数据停一天），而且**目标更大**的调用方（回测页要 250 行）不该被
 * 基金页那次 60 行的尝试连坐 6 小时。
 */
describe("navBackfillStamp 记账 + 目标维度", () => {
  const now = new Date("2026-09-23T14:00:00+08:00").getTime();
  const gate = (over: Partial<Parameters<typeof shouldBackfillNav>[0]> = {}) =>
    shouldBackfillNav({
      rowCount: 43,
      backfilledAt: null,
      backfilledTarget: null,
      now,
      ...over,
    });

  it("成功：记满间隔（6 小时内不再试）", () => {
    const s = navBackfillStamp({ now, minRows: 60, succeeded: true });
    expect(s.target).toBe(60);
    expect(gate({ backfilledAt: s.at, backfilledTarget: s.target })).toBe(false);
    expect(
      gate({
        backfilledAt: s.at,
        backfilledTarget: s.target,
        now: now + NAV_BACKFILL_INTERVAL_MS + 1,
      }),
    ).toBe(true);
  });

  it("失败：只锁短冷却（30 分钟后自愈，不锁满 6 小时）", () => {
    const s = navBackfillStamp({ now, minRows: 60, succeeded: false });
    expect(gate({ backfilledAt: s.at, backfilledTarget: s.target })).toBe(false);
    expect(
      gate({
        backfilledAt: s.at,
        backfilledTarget: s.target,
        now: now + NAV_BACKFILL_FAILURE_COOLDOWN_MS + 1,
      }),
    ).toBe(true);
    expect(NAV_BACKFILL_FAILURE_COOLDOWN_MS).toBeLessThan(NAV_BACKFILL_INTERVAL_MS);
  });

  it("目标更大时放行：基金页那次 60 行不连坐回测页的 250 行", () => {
    const s = navBackfillStamp({ now, minRows: NAV_BACKFILL_MIN_ROWS, succeeded: true });
    expect(
      gate({ backfilledAt: s.at, backfilledTarget: s.target, minRows: 250 }),
    ).toBe(true);
    // 同一目标仍然拦住
    expect(
      gate({ backfilledAt: s.at, backfilledTarget: s.target, minRows: 60 }),
    ).toBe(false);
  });

  it("存量数据（target 为 NULL，迁移前的旧戳）视为未知目标，放行一次", () => {
    expect(gate({ backfilledAt: now, backfilledTarget: null })).toBe(true);
  });
});
