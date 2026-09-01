import Decimal from "decimal.js";
import { navToDecimal, roundInt, sharesToDecimal, YUAN } from "./money";

/**
 * 账本重放：沿日期轴逐日回放现金流水与确认订单，算出每日资产快照。
 * 纯函数，零运行时依赖（domain 层），可脱离 D1/node 跑单测。
 */

/** 重放输入 */
export interface ReplayInput {
  /** 参与重放的日期轴（升序去重）。service 层取 nav_date 并集 ∪ 流水日期 */
  dateAxis: string[];
  /** 现金账本：升序，每条为「该时刻变动后余额（分）」 */
  cashLedger: { date: string; balance: number }[];
  /** 当日净入金（分）：仅 checkin / init 之和，按日聚合 */
  netDepositByDate: Map<string, number>;
  /** 已确认订单：按 confirmDate 升序，buy 加份额、sell 减份额 */
  confirmedOrders: {
    fundCode: string;
    side: "buy" | "sell";
    confirmDate: string;
    /** ×10000 整数 */
    dealShares: number;
  }[];
  /** 各基金净值序列（升序），键为基金代码 */
  navSeries: Map<string, { navDate: string; unitNav: number }[]>;
  /**
   * 在途申购事件流（升序，可乱序由 service 排好）：买单冻结的现金在
   * 「下单 → 确认/撤销/失败」期间仍属资产。每条 = 该日在途额的增减：
   *   下单 +amount、改单 ±差额、确认/撤销/失败日 −终值。
   * 没有它，在途窗口里「钱已扣、份额未有」，单日收益会把申购额
   * 误记成亏损（2026-09-01 主理人实测 -8942 元即 9 笔申购总额）。
   */
  transitEvents: { date: string; deltaCents: number }[];
}

/** 每日资产快照 */
export interface DailyAsset {
  date: string;
  /** 当日现金（分） */
  cashCents: number;
  /** 当日持仓市值合计（分） */
  marketValueCents: number;
  /** 当日在途申购金额（分）：已冻结未成交的钱 */
  transitCents: number;
  /** 当日总资产（分）= 现金 + 市值 + 在途 */
  totalAssetCents: number;
  /** 当日收益（分），已扣净入金 */
  dayPnlCents: number;
  /** 当日收益率 = dayPnlCents / 前一日总资产；前一日为 0 或首日 → 0（避免除零） */
  dayPnlRate: number;
}

/**
 * 账本重放主函数（spec §5.2，单趟扫描，O(天数 + 订单数)）。
 *
 * 沿 dateAxis 前进，维护四个游标：
 *   - 现金账本游标 cashIdx（前向填充：取最后一条 date <= 当日的 balance）
 *   - 订单游标 orderIdx（confirmDate === 当日 则并入份额 Map）
 *   - 在途事件游标 transitIdx（date <= 当日 全部并入，维护在途 level）
 *   - 各基金净值游标 navIdxMap（前向填充：取最后一条 navDate <= 当日的 unitNav）
 * 持仓份额 Map<fundCode, sharesScaled> 随订单进出。
 */
export function replayDailyAssets(input: ReplayInput): DailyAsset[] {
  const { dateAxis, cashLedger, netDepositByDate, confirmedOrders, navSeries, transitEvents } = input;

  // 空日期轴直接返回空数组
  if (dateAxis.length === 0)
    return [];

  // 持仓份额：fundCode → sharesScaled（×10000 整数）
  const sharesMap = new Map<string, number>();

  // 各基金净值游标：fundCode → 当前在 navSeries 里的索引位置
  const navIdxMap = new Map<string, number>();
  // 各基金上次有效净值：fundCode → unitNav（×10000 整数），用于前向填充
  const lastNavMap = new Map<string, number>();
  for (const code of navSeries.keys()) {
    navIdxMap.set(code, 0);
    lastNavMap.set(code, -1); // -1 表示还没见过任何净值
  }

  let cashIdx = 0; // 现金账本游标
  let orderIdx = 0; // 订单游标
  let transitIdx = 0; // 在途事件游标
  let transitCents = 0; // 在途申购 level（分）
  let prevTotalAssetCents = 0; // 前一日总资产（首日为 0）
  let isFirstDay = true;

  const result: DailyAsset[] = [];

  for (const date of dateAxis) {
    // ── 步骤 1：推进订单游标，把 confirmDate === 当日 的订单并入份额 Map ──
    while (
      orderIdx < confirmedOrders.length
      && confirmedOrders[orderIdx].confirmDate === date
    ) {
      const order = confirmedOrders[orderIdx];
      const prev = sharesMap.get(order.fundCode) ?? 0;
      const next = order.side === "buy"
        ? prev + order.dealShares
        : prev - order.dealShares;
      // 份额归零时删除 key，避免残留 0 在后续遍历时产生无效估值
      if (next === 0) {
        sharesMap.delete(order.fundCode);
      }
      else {
        sharesMap.set(order.fundCode, next);
      }
      orderIdx++;
    }

    // ── 步骤 1.5：推进在途事件游标（date <= 当日 全部并入，含当日）──
    // 与现金前向填充同款语义：事件落在不在日期轴上的日子（理论上不该
    // 发生——下单/改单/撤销日必有流水），也会在下个轴日被消费
    while (
      transitIdx < transitEvents.length
      && transitEvents[transitIdx].date <= date
    ) {
      transitCents += transitEvents[transitIdx].deltaCents;
      transitIdx++;
    }

    // ── 步骤 2：推进现金游标，前向填充（取最后一条 date <= 当日的 balance）──
    // 只要下一条现金账本的 date <= 当日就前进，停在最后一条满足条件的
    while (
      cashIdx < cashLedger.length
      && cashLedger[cashIdx].date <= date
    ) {
      cashIdx++;
    }
    // cashIdx 现在指向第一条 date > 当日 的条目（或越界），
    // 最后被消费掉的是 cashIdx - 1
    const cashCents = cashIdx > 0 ? cashLedger[cashIdx - 1].balance : 0;

    // ── 步骤 3：遍历持仓份额，用净值前向填充算市值 ──
    // 每只基金各自 roundInt 后累加（与 valuateHolding 粒度一致）
    let marketValueCents = 0;
    for (const [fundCode, sharesScaled] of sharesMap) {
      if (sharesScaled === 0)
        continue;

      // 推进该基金的净值游标：navDate <= 当日 的全部跳过，停在最后一条满足条件的
      const navList = navSeries.get(fundCode);
      if (navList && navList.length > 0) {
        let idx = navIdxMap.get(fundCode) ?? 0;
        while (idx < navList.length && navList[idx].navDate <= date) {
          lastNavMap.set(fundCode, navList[idx].unitNav);
          idx++;
        }
        navIdxMap.set(fundCode, idx);
      }

      const lastNav = lastNavMap.get(fundCode) ?? -1;
      // 该基金在当日之前还没有任何净值 → 此时分额必为 0（确认日必然有净值），跳过
      if (lastNav < 0)
        continue;

      // 市值公式与 valuateHolding 一致：
      //   roundInt(sharesToDecimal(shares).mul(navToDecimal(nav)).mul(YUAN))
      const mv = roundInt(
        sharesToDecimal(sharesScaled).mul(navToDecimal(lastNav)).mul(YUAN),
      );
      marketValueCents += mv;
    }

    // ── 步骤 4：总资产 = 现金 + 市值 + 在途 ──
    const totalAssetCents = cashCents + marketValueCents + transitCents;

    // ── 步骤 5：日收益 = 当日总资产 − 前一日总资产 − 当日净入金 ──
    // 首日无前一日 → 0。必须扣净入金：签到不是赚了，买入/赎回不算净入金。
    const netDeposit = netDepositByDate.get(date) ?? 0;
    const dayPnlCents = isFirstDay ? 0 : totalAssetCents - prevTotalAssetCents - netDeposit;

    // ── 步骤 6：日收益率 ──
    // 前一日总资产为 0 或首日 → 0（避免除零得 NaN/Infinity）
    let dayPnlRate = 0;
    if (!isFirstDay && prevTotalAssetCents !== 0) {
      dayPnlRate = new Decimal(dayPnlCents).div(prevTotalAssetCents).toNumber();
    }

    // ── 步骤 7：推前一日总资产，进下一天 ──
    result.push({
      date,
      cashCents,
      marketValueCents,
      transitCents,
      totalAssetCents,
      dayPnlCents,
      dayPnlRate,
    });

    prevTotalAssetCents = totalAssetCents;
    isFirstDay = false;
  }

  return result;
}
