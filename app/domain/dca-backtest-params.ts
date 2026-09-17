import type { DcaAdjustMode, DcaFrequency } from "./dca-backtest";
import {
  DCA_BACKTEST_AMOUNT_CENTS,
  DCA_BACKTEST_DEFAULT_PERIODS,
  DCA_BACKTEST_MIN_PERIODS,
  DCA_FREQUENCY_LABELS,
} from "./dca-backtest";
import { yuanToCents } from "./money";

/**
 * `/tools/dca-backtest` 的 query 口径（纯函数，不依赖框架）。
 *
 * 为什么单独一个模块：URL 是公开页的**用户输入**（还能被分享、被爬虫改），
 * 各参数的默认值、边界与回落文案就是这一页的对外契约。放在路由里内联
 * 就只能靠 workerd 集成测试覆盖，抽出来才能秒级单测（与 anon-page-cache
 * 同一手法：把「判定」与「取参数」解耦，测试传个最小 getter 就行）。
 *
 * 纪律：非法值一律**回落默认值 + 留一条提示**。既不把页面打成 500，
 * 也不静默改口径——用户填了 50 元却看到按 1000 元算的数字，比报错更糟。
 */

/** 默认每期金额：1000 元（与基金页那张回测卡同口径，方便对照） */
export const DCA_PAGE_DEFAULT_AMOUNT_CENTS = DCA_BACKTEST_AMOUNT_CENTS;

/** 每期金额下限：100 元。再低就不是「定投」了，结果也不足以说明问题 */
export const DCA_PAGE_AMOUNT_MIN_CENTS = 10_000;

/** 每期金额上限：100 万元。挡住误加两个零的输入，也挡住溢出风险 */
export const DCA_PAGE_AMOUNT_MAX_CENTS = 100_000_000;

/**
 * 期数默认值随频率走（月 12 / 周 52 / 天 250，都是「一年」的量）。
 * 切频率时就该换成该频率的默认期数——沿用 12 期去按天定投只剩 12 天，
 * 那不是用户想要的「按天定投一年」。
 */
export const DCA_PAGE_DEFAULT_PERIODS = DCA_BACKTEST_DEFAULT_PERIODS;

/**
 * 期数硬上限：只防手滑与滥用（库里最多约 400 个交易日净值，这是它的两倍多）。
 * 真正的上限是「该频率的可用期数」，由 loader 用 countDcaPeriods 算出来提示。
 */
export const DCA_PAGE_PERIOD_HARD_MAX = 1000;

/**
 * 频率档（页面 Segmented 的选项，顺序即 UI 顺序）。
 * 默认的「按月」放最前：最常见、也是基金页那张固定卡的口径。
 */
export const DCA_PAGE_FREQUENCY_OPTIONS: readonly { value: DcaFrequency; label: string }[] = [
  { value: "month", label: "按月" },
  { value: "week", label: "按周" },
  { value: "day", label: "按天" },
];

/** 口径默认值：累计净值（分红再投），与基金页展示的一致 */
export const DCA_PAGE_DEFAULT_ADJUST: DcaAdjustMode = "acc";

/** 解析结果：全是可直接用的值，另附被回落时的提示文案 */
export interface DcaBacktestQuery {
  /** 6 位基金代码；空串 = 还没选基金（页面展示选择列表） */
  code: string;
  /** 每期投入（分） */
  amountCents: number;
  /** 定投频率 */
  frequency: DcaFrequency;
  /** 最近 N 期 */
  periods: number;
  /** 净值口径 */
  adjust: DcaAdjustMode;
  /** 参数被回落时的提示（空数组 = 一切正常），页面按行展示 */
  notices: string[];
}

/** 分 → 文案里的元。这几个常量都是整元，直接除即可 */
function yuan(cents: number): string {
  return String(cents / 100);
}

/** 6 位数字基金代码（与 seo.ts 的 sitemap 同一口径） */
const FUND_CODE_RE = /^\d{6}$/;

/** 只解析 query 的取值，避免 domain 依赖 URL / Request 这些宿主对象 */
export interface QueryGetter {
  get: (name: string) => string | null;
}

export function parseDcaBacktestQuery(params: QueryGetter): DcaBacktestQuery {
  const notices: string[] = [];

  // 基金代码：只认 6 位数字。缺失（null）是「还没选基金」，不是错误——
  // 首屏本来就要展示基金选择列表，那种情况不该弹提示
  const rawCode = params.get("code");
  const code = rawCode === null ? "" : rawCode.trim();
  if (code !== "" && !FUND_CODE_RE.test(code)) {
    notices.push("基金代码要填 6 位数字，已回到基金选择");
  }

  // 每期金额：元 → 分。Decimal 解析非法文本会抛，兜住转成提示
  const rawAmount = params.get("amount");
  let amountCents = DCA_PAGE_DEFAULT_AMOUNT_CENTS;
  if (rawAmount !== null) {
    let parsed: number | null = null;
    try {
      parsed = yuanToCents(rawAmount.trim());
    }
    catch {
      parsed = null;
    }
    // decimal.js 会接受 "NaN" / "Infinity"（返回非有限值，不抛），只判 null 挡不住：
    // 它一路传进 calcPurchase 会抛，把公开页打成 500（CodeRabbit 评审 #1）
    if (parsed === null || !Number.isFinite(parsed)) {
      notices.push(`每期金额请填数字，已按 ${yuan(DCA_PAGE_DEFAULT_AMOUNT_CENTS)} 元试算`);
    }
    else if (parsed < DCA_PAGE_AMOUNT_MIN_CENTS || parsed > DCA_PAGE_AMOUNT_MAX_CENTS) {
      notices.push(
        `每期金额请在 ${yuan(DCA_PAGE_AMOUNT_MIN_CENTS)} ~ ${yuan(DCA_PAGE_AMOUNT_MAX_CENTS)} 元之间，`
        + `已按 ${yuan(DCA_PAGE_DEFAULT_AMOUNT_CENTS)} 元试算`,
      );
    }
    else {
      amountCents = parsed;
    }
  }

  // 频率：只有三种，页面文案与之一一对应
  const rawFreq = params.get("freq");
  let frequency: DcaFrequency = "month";
  if (rawFreq !== null) {
    const text = rawFreq.trim();
    if (text === "day" || text === "week" || text === "month") {
      frequency = text;
    }
    else {
      notices.push("定投频率只有按月 / 按周 / 按天三种，已按按月试算");
    }
  }

  // 期数：整数且不少于下限才认（上限先由硬顶挡、再由可用期数截断）。
  // 回落的默认值随频率走，所以频率必须先解析完
  const rawPeriods = params.get("periods");
  let periods = DCA_PAGE_DEFAULT_PERIODS[frequency];
  if (rawPeriods !== null) {
    const text = rawPeriods.trim();
    const parsed = /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
    if (
      !Number.isInteger(parsed)
      || parsed < DCA_BACKTEST_MIN_PERIODS
      || parsed > DCA_PAGE_PERIOD_HARD_MAX
    ) {
      notices.push(
        `回测期数请填 ${DCA_BACKTEST_MIN_PERIODS} ~ ${DCA_PAGE_PERIOD_HARD_MAX} 的整数`
        + `（${DCA_FREQUENCY_LABELS[frequency]}），已按 ${periods} 期试算`,
      );
    }
    else {
      periods = parsed;
    }
  }

  // 口径：只有两种，页面文案与之一一对应
  const rawAdjust = params.get("adjust");
  let adjust: DcaAdjustMode = DCA_PAGE_DEFAULT_ADJUST;
  if (rawAdjust !== null) {
    const text = rawAdjust.trim();
    if (text === "acc" || text === "unit") {
      adjust = text;
    }
    else {
      notices.push("净值口径只有「累计净值」与「单位净值」两种，已按累计净值试算");
    }
  }

  return {
    code: FUND_CODE_RE.test(code) ? code : "",
    amountCents,
    frequency,
    periods,
    adjust,
    notices,
  };
}
