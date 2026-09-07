import Decimal from "decimal.js";
import { fundMarketValueCents } from "./portfolio";

/**
 * 按基金归因的当日收益（纯函数，domain 层，零运行时依赖）。
 *
 * 归因公式（全整数域，无浮点）：
 *   某基金当日收益 = 当日市值 − 前一日市值 − 当日买单现金支出 + 当日卖单净到账
 *
 * 语义展开：
 *   - 申购确认日 = −申购费（份额按当日净值入账，当日无净值差）
 *   - 赎回确认日 = −赎回费（已实现盈亏已在持有期间的逐日净值变动里记过，MTM 口径）
 *   - 普通持有日 = 持有份额 × 净值变动
 *
 * ⚠️ 不变量：对本函数与 replayDailyAssets 的任意公共输入，逐日
 *   Σ各基金当日收益 === 当日 dayPnlCents——现金/在途/净入金在代数上
 *   全部对冲（含撤单退款路径）。fund-pnl.test.ts 的不变量测试守护它：
 *   改任何一个函数都必须让那组测试保持全绿。
 */

/** 归因输入：重放输入的子集——现金账本/在途/净入金都不需要 */
export interface FundPnlInput {
  /** 参与归因的日期轴（升序去重），与重放共用同一条 */
  dateAxis: string[];
  /** 各基金净值序列（升序），前向填充语义与重放一致 */
  navSeries: Map<string, { navDate: string; unitNav: number }[]>;
  confirmedOrders: {
    fundCode: string;
    side: "buy" | "sell";
    confirmDate: string;
    /** 成交份额 ×10000 */
    dealShares: number;
    /**
     * 订单现金流（分）。买单 = amount（含费全额，内扣法冻结口径）；
     * 卖单 = dealAmount（扣费后净到账）。费用由此隐含在归因里，无需单独喂 fee。
     */
    cashCents: number;
  }[];
}

/** 单只基金单日收益 */
export interface FundDayPnl {
  fundCode: string;
  /** 当日收益（分，含当日费用） */
  dayPnlCents: number;
  /** 当日净值涨跌幅（普通小数，如 0.0123 = +1.23%）。展示辅助，不参与不变量 */
  dayNavRate: number;
}

/** 全量归因：日期 → 当日有份额/现金流的各基金收益（含收益为 0 的条目） */
export function attributeFundPnlByDate(
  input: FundPnlInput,
): Map<string, FundDayPnl[]> {
  const { dateAxis, navSeries, confirmedOrders } = input;

  // 与 replayDailyAssets 同款排序契约：按确认日升序（稳定排序，同日保持
  // service 层 (placeDate, id) 序）——前向扫描游标要求有序
  const orders = [...confirmedOrders].sort((a, b) =>
    a.confirmDate < b.confirmDate ? -1 : a.confirmDate > b.confirmDate ? 1 : 0);

  // 各基金净值游标 + 前向填充（与 replayDailyAssets 步骤 3 同款）
  const navIdxMap = new Map<string, number>();
  const lastNavMap = new Map<string, number>();
  for (const code of navSeries.keys()) {
    navIdxMap.set(code, 0);
    lastNavMap.set(code, -1); // -1 表示还没见过任何净值
  }

  // 当日收盘份额 与 前一日收盘市值
  const sharesMap = new Map<string, number>();
  const prevMvMap = new Map<string, number>();

  const result = new Map<string, FundDayPnl[]>();
  let orderIdx = 0;

  for (const date of dateAxis) {
    // ── 步骤 1：并入当日确认订单（改份额、记当日现金流）──
    const dayCashMap = new Map<string, { buy: number; sell: number }>();
    while (
      orderIdx < orders.length
      && orders[orderIdx].confirmDate === date
    ) {
      const o = orders[orderIdx];
      const prev = sharesMap.get(o.fundCode) ?? 0;
      const next = o.side === "buy"
        ? prev + o.dealShares
        : prev - o.dealShares;
      // 份额归零删 key，与重放同款
      if (next === 0) {
        sharesMap.delete(o.fundCode);
      }
      else {
        sharesMap.set(o.fundCode, next);
      }
      const c = dayCashMap.get(o.fundCode) ?? { buy: 0, sell: 0 };
      if (o.side === "buy") {
        c.buy += o.cashCents;
      }
      else {
        c.sell += o.cashCents;
      }
      dayCashMap.set(o.fundCode, c);
      orderIdx++;
    }

    // ── 步骤 2：当日有份额 / 当日有现金流 / 昨日有市值的基金才出条目 ──
    // （清仓退出的基金当日没有份额，但 −赎回费 必须记在它头上）
    const codes = new Set<string>([...sharesMap.keys(), ...dayCashMap.keys()]);
    for (const [code, prevMv] of prevMvMap) {
      if (prevMv !== 0) {
        codes.add(code);
      }
    }
    if (codes.size === 0) {
      continue;
    }

    const entries: FundDayPnl[] = [];
    for (const fundCode of codes) {
      const sharesScaled = sharesMap.get(fundCode) ?? 0;

      // 推进净值游标（前向填充与重放同款）；prevNav 在推进前取，用于涨跌幅
      const navList = navSeries.get(fundCode);
      const prevNav = lastNavMap.get(fundCode) ?? -1;
      if (navList && navList.length > 0) {
        let idx = navIdxMap.get(fundCode) ?? 0;
        while (idx < navList.length && navList[idx].navDate <= date) {
          lastNavMap.set(fundCode, navList[idx].unitNav);
          idx++;
        }
        navIdxMap.set(fundCode, idx);
      }
      const lastNav = lastNavMap.get(fundCode) ?? -1;

      // 市值与重放同源取整；无净值不计市值（让不变量在任何数据下都成立）
      const mv = sharesScaled !== 0 && lastNav >= 0
        ? fundMarketValueCents(sharesScaled, lastNav)
        : 0;

      const cash = dayCashMap.get(fundCode) ?? { buy: 0, sell: 0 };
      // 归因公式：Δ市值 − 买支出 + 卖到账
      const dayPnlCents
        = mv - (prevMvMap.get(fundCode) ?? 0) - cash.buy + cash.sell;

      // 当日净值涨跌幅：首见净值日（prevNav < 0）与前向填充日均记 0
      const dayNavRate = prevNav > 0
        ? new Decimal(lastNav - prevNav).div(prevNav).toNumber()
        : 0;

      entries.push({ fundCode, dayPnlCents, dayNavRate });
      // 收盘市值滚入「昨日市值」；0 也写入（次日 union 判断会跳过）
      prevMvMap.set(fundCode, mv);
    }

    result.set(date, entries);
  }

  return result;
}
