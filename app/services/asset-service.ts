import type { Db } from "~/db/client";
import type { DailyAsset, ReplayInput } from "~/domain/asset-timeline";
import { asc, eq } from "drizzle-orm";
import { orders, transactions } from "~/db/schema";
import { replayDailyAssets } from "~/domain/asset-timeline";
import { toBeijing } from "~/domain/trading-calendar";
import { getNavSeries } from "~/services/portfolio-service";

/**
 * 资产时间线 service：查 D1 拼 ReplayInput，调领域层重放逐日资产。
 * 被 /me 与 /master 的曲线图共用（Task 5 消费）。
 *
 * 五步查询均为 load-bearing——少查或查错，重放结果必错。
 * 任何一步查不到数据都不抛：空数据让 domain 返回空数组、latest=null，页面渲染空态。
 */

/**
 * 查询用户资产时间线。
 *
 * @param db   Drizzle 实例（由 loader 传入）
 * @param userId 用户 ID
 * @returns daily 逐日资产快照；latest 最新一天（页面可标注日期）
 */
export async function getAssetTimeline(
  db: Db,
  userId: number,
): Promise<{ daily: DailyAsset[]; latest: DailyAsset | null }> {
  // ── 查询 1 & 2：全部订单 + 现金账本（互相独立，一波并行）──────────
  // 订单取全量（不只 confirmed）：份额重放只用 confirmed，但「在途申购」
  // 事件流需要每笔买单的完整生命周期（下单/改单/撤销/失败）。
  // transactions 按 createdAt asc, id asc 取全量，映射成 { date, balance }。
  // 日期转换是关键：createdAt 是 UTC 毫秒，fund_nav.navDate 是北京日历日，
  // 必须用 toBeijing 转成北京日期串才能与净值日期对齐（与 checkin-service 同款）。
  const [orderRows, txRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        fundCode: orders.fundCode,
        side: orders.side,
        status: orders.status,
        amount: orders.amount,
        placeDate: orders.placeDate,
        confirmDate: orders.confirmDate,
        dealShares: orders.dealShares,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(asc(orders.placeDate), asc(orders.id)),
    db
      .select({
        type: transactions.type,
        amount: transactions.amount,
        balance: transactions.balance,
        createdAt: transactions.createdAt,
        orderId: transactions.orderId,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.createdAt), asc(transactions.id)),
  ]);

  // 映射成 ReplayInput.confirmedOrders 的形状（份额重放只用已成交单）。
  // 上面主排序是 placeDate，这里必须按 (confirmDate, id) 重排——
  // domain 前向扫描游标要求按确认日有序
  const confirmedOrders: ReplayInput["confirmedOrders"] = [];
  const fundCodeSet = new Set<string>();
  for (const row of orderRows) {
    if (row.status !== "confirmed" || row.dealShares === null)
      continue;
    confirmedOrders.push({
      fundCode: row.fundCode,
      side: row.side,
      confirmDate: row.confirmDate,
      dealShares: row.dealShares,
    });
    fundCodeSet.add(row.fundCode);
  }
  confirmedOrders.sort((a, b) =>
    a.confirmDate < b.confirmDate ? -1 : a.confirmDate > b.confirmDate ? 1 : 0,
  );
  const fundCodes = [...fundCodeSet];

  const cashLedger: ReplayInput["cashLedger"] = [];
  // ── 查询 3：净入金按日聚合 ─────────────────────────────────────────
  // 遍历同一批 transactions，仅 type 为 checkin 或 init 的 amount 按 date 累加。
  // buy/sell/fee 不算净入金：买入是现金换份额、赎回是份额换现金、fee 是成本，都不是外部入金。
  // checkin/init 的 amount 是正数（入账），直接加。
  const netDepositByDate = new Map<string, number>();
  // 收集现金账本日期，后面并进 dateAxis
  const cashDates = new Set<string>();

  // ── 在途事件流的辅助索引（同批流水的二次消费）─────────────────────
  // 改单流水（type='amend'）：amount = −差额，在途变化 = +差额 = −amount。
  // 撤销（type='cancel'）/失败退款（type='buy' 且 amount>0——下单流水
  // 只会是负数，正数 buy 必是 failOrder 的退款）的流水日期 = 在途归零日。
  const amendEventsByOrderId = new Map<number, { date: string; deltaCents: number }[]>();
  const closeDateByOrderId = new Map<number, string>();

  for (const row of txRows) {
    // createdAt 是 UTC 毫秒，转北京日期串对齐净值日历
    const date = toBeijing(new Date(row.createdAt)).format("YYYY-MM-DD");

    cashLedger.push({ date, balance: row.balance });
    cashDates.add(date);

    // 仅 checkin / init 算净入金
    if (row.type === "checkin" || row.type === "init") {
      const prev = netDepositByDate.get(date) ?? 0;
      netDepositByDate.set(date, prev + row.amount);
    }

    if (row.orderId == null)
      continue;
    if (row.type === "amend") {
      const list = amendEventsByOrderId.get(row.orderId) ?? [];
      list.push({ date, deltaCents: -row.amount });
      amendEventsByOrderId.set(row.orderId, list);
    }
    else if (row.type === "cancel" || (row.type === "buy" && row.amount > 0)) {
      closeDateByOrderId.set(row.orderId, date);
    }
  }

  // ── 在途事件流：每笔买单的生命周期 ────────────────────────────────
  //   下单日 +初始委托额（= 终值 − Σ改单差额），改单日 ±差额，
  //   确认日 −终值（换成市值）、撤销/失败日 −终值（现金已退回）。
  // pending 单不归零：它真正成交/退回后（状态翻转、流水落库），
  // 下次重算时间线自然带上归零事件——今天下单今天未撮合，在途持续到今晚。
  // 没有这条流，在途窗口里「钱已扣、份额未有」，单日收益会把申购额
  // 误记成亏损（2026-09-01 主理人实测 -8942 元即 9 笔申购总额）。
  const transitEvents: ReplayInput["transitEvents"] = [];
  for (const o of orderRows) {
    if (o.side !== "buy" || o.amount === null)
      continue;
    const amends = amendEventsByOrderId.get(o.id) ?? [];
    const amendSum = amends.reduce((s, e) => s + e.deltaCents, 0);
    transitEvents.push({ date: o.placeDate, deltaCents: o.amount - amendSum });
    transitEvents.push(...amends);
    if (o.status === "confirmed") {
      transitEvents.push({ date: o.confirmDate, deltaCents: -o.amount });
    }
    else if (o.status === "cancelled" || o.status === "failed") {
      // 归零日 = 退款流水日期；兜底 confirmDate（理论不可达：撤销/失败必留退款流水）
      const closeDate = closeDateByOrderId.get(o.id) ?? o.confirmDate;
      transitEvents.push({ date: closeDate, deltaCents: -o.amount });
    }
  }
  transitEvents.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // ── 查询 4：净值序列 ──────────────────────────────────────────────
  // 对每只有确认订单的基金调 getNavSeries(db, code) 取全部净值。
  // ⚠️ 不传 days 参数！传了会截断到最近 N 天，可能丢掉某笔老订单 confirmDate 那天的 nav，
  // 导致该订单被 domain 静默跳过、份额永久不计（契约：confirmDate 必在 dateAxis 中有对应净值）。
  // getNavSeries 默认 3650 cap，对模拟盘足够。
  const navSeries = new Map<string, { navDate: string; unitNav: number }[]>();
  // 收集所有 navDate，后面并进 dateAxis
  const navDates = new Set<string>();

  // 各基金的净值序列互相独立，Promise.all 一波并行——
  // 旧写法逐基金串行 await，N 只基金就是 N 次串行往返
  const seriesList = await Promise.all(
    fundCodes.map(code => getNavSeries(db, code)),
  );
  for (let i = 0; i < fundCodes.length; i++) {
    const series = seriesList[i];
    // 丢掉 growthRate，只留 navDate + unitNav（重放不需要涨跌幅）
    const mapped = series.map(s => ({ navDate: s.navDate, unitNav: s.unitNav }));
    navSeries.set(fundCodes[i], mapped);
    for (const s of series) {
      navDates.add(s.navDate);
    }
  }

  // ── 查询 5：日期轴 ──────────────────────────────────────────────
  // dateAxis = 所有基金 navDate 的并集 ∪ 所有现金账本日期，升序去重。
  //
  // ⚠️ 并上现金账本日期的原因（对 spec §5.2 的刻意修正）：
  //    spec 原文只说 nav_date 并集，但周末签到时当天没有净值（非交易日），
  //    签到产生的现金变动会漏到下一个交易日才出现在 dateAxis 上，
  //    造成假收益——例如周五签到 +100，下周一才在 dateAxis 出现，
  //    收益算成周一赚了 100，违反期二核心断言「签到日不显示为收益」。
  //    把流水日期也并进来，签到日才有自己的 dateAxis 条目，
  //    domain 在那天能扣掉净入金（dayPnl = Δ资产 − 净入金 = 0），不显示假收益。
  const dateSet = new Set<string>();
  for (const d of navDates) dateSet.add(d);
  for (const d of cashDates) dateSet.add(d);
  const dateAxis = [...dateSet].sort();

  // ── 拼 ReplayInput 喂领域层 ─────────────────────────────────────
  const input: ReplayInput = {
    dateAxis,
    cashLedger,
    netDepositByDate,
    confirmedOrders,
    navSeries,
    transitEvents,
  };

  const daily = replayDailyAssets(input);
  const latest = daily.length > 0 ? daily[daily.length - 1] : null;

  return { daily, latest };
}
