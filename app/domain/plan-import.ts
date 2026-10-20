import dayjs from "dayjs";
import { yuanToCents } from "./money";
import { isPlanDay } from "./undervalued-plan";

/**
 * 公众号「个基方案」原文的解析（纯函数）。
 *
 * 只做机械解析：日期、品种名、金额。日期是否周二、是否在未来属于**语义校验**，
 * 由 `planDateWarnings` 单独回答——两件事分开，测试才能各自钉住。
 *
 * 原文样例（2026-10-20）：
 *   时间：2026年10月20日
 *   品种：
 *   • 沪港深红利低波动，919元
 *   • 中证白酒 ，1239元     ← 名称与逗号之间可能有空格
 */

/** 原文里的一只品种 */
export interface ParsedPlanItem {
  /** 原文里的品种名（未归一化，别名表的键与页面展示都用它） */
  alias: string;
  /** 申购金额（分） */
  amountCents: number;
}

export interface ParsedPlan {
  /** 原文日期 YYYY-MM-DD；没写或日期不存在时为 null */
  periodDate: string | null;
  items: ParsedPlanItem[];
  /** 不阻断流程的提示，页面按行展示 */
  warnings: string[];
}

/** 日期行：容忍全角/半角冒号、月日不补零 */
const DATE_RE = /时间\s*[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;

/**
 * 行首项目符号：`• · ▪ ● - *` 都可能出现（微信内容复制到不同 App 时会变）。
 */
const BULLET_RE = /^\s*[•·▪●\-*]\s*/;

/**
 * 金额里的千分位逗号：先剥掉再交给 Decimal。
 *
 * 不需要处理空白——反扫在第一个空白处就停了，`head.slice(i)` 里不可能有空格；
 * 「1 239元」这种空格千分位会解析失败并被警告，而不是被猜成 239。
 */
const AMOUNT_STRIP_RE = /,/g;
/** 剥掉千分位后的合法金额：整数，或至多两位小数 */
const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;

/** 品种名的长度守卫：太短的行（一个符号、一个空格）不值得当成品种 */
const MIN_ALIAS_LEN = 2;

/**
 * 从一行里拆出「名称 + 金额」。
 *
 * 为什么不用一条大正则：半角逗号既是名称分隔符、又可能出现在千分位里
 * （`恒生科技，1,060元`），一条正则表达不了这个歧义，还会触发
 * `regexp/no-super-linear-backtracking` 把 commit 拦下。改成从尾部往前吃数字。
 *
 * ⚠️ 反扫会**跨过半角逗号**，所以「沪深300,1000元」会一路吃到名称里的 300，
 * 得到 `300,1000` → 剥成 `3001000`（300 万），名称只剩「沪深」。
 * 品种池里以数字结尾的简称一大把（沪深300、中证500、上证50、优选300），
 * 这是必须挡住的。判据：尾部数字串里含半角逗号时，它必须真的是千分位——
 * 要么整串从行首就是金额（无名称），要么逗号前紧邻分隔符（全角逗号/空白）。
 */
function splitItemLine(body: string): { alias: string; amountText: string } | null {
  if (!body.endsWith("元"))
    return null;

  const head = body.slice(0, -1).trimEnd();
  let i = head.length;
  while (i > 0 && /[\d,.]/.test(head[i - 1]!))
    i--;

  const tail = head.slice(i);
  // 尾部打头的半角逗号是分隔符，不是千分位
  const lead = tail.length - tail.replace(/^,+/, "").length;
  const digits = tail.slice(lead);
  const separated = lead > 0 || i === 0 || /[，,\s]/.test(head[i - 1]!);
  if (digits.includes(",") && !separated)
    return null;

  const amountText = digits.replace(AMOUNT_STRIP_RE, "");
  if (!AMOUNT_RE.test(amountText))
    return null;

  // 名称尾部可能残留分隔逗号（`中证白酒 ，1239元` 会留下全角逗号 + 空格）
  const alias = head.slice(0, i + lead).trimEnd().replace(/[，,]+$/, "").trim();

  // 去掉尾部逗号后名称里仍有逗号 → 行尾那串数字被吞错位了。
  // 典型：「港股科技，1 064元」的反扫会在空格处停下，把「1」留在名称里、
  // 把「064」当金额（64 元）。宁可跳过并警告，也不能悄悄按 64 元下单。
  if (/[，,]/.test(alias))
    return null;

  return { alias, amountText };
}

export function parsePlanText(text: string): ParsedPlan {
  const warnings: string[] = [];
  const periodDate = parseDateLine(text, warnings);

  const items: ParsedPlanItem[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const body = line.replace(BULLET_RE, "").trim();
    if (body === "")
      continue;

    const parsed = splitItemLine(body);
    if (!parsed) {
      // 带「元」却没解析出来：**必须留痕**。静默少一只比报错危险得多——
      // 这个功能的价值就是省掉人工比对，少 1000 元没人会发现。
      if (body.includes("元"))
        warnings.push(`「${body}」没有识别出金额，已跳过`);
      continue;
    }

    const { alias, amountText } = parsed;
    // 金额走 Decimal（精度铁律）：千分位已在 splitItemLine 里剥掉
    const amountCents = yuanToCents(amountText);
    if (alias.length < MIN_ALIAS_LEN) {
      warnings.push(`「${body}」没有认出品种名，已跳过`);
      continue;
    }
    if (amountCents <= 0) {
      warnings.push(`「${alias}」金额不是正数，已跳过`);
      continue;
    }
    // 同一期同一只重复写：只留第一行，别让它变成两笔
    if (seen.has(alias)) {
      warnings.push(`「${alias}」重复出现，只保留第一行`);
      continue;
    }
    seen.add(alias);
    items.push({ alias, amountCents });
  }

  if (items.length === 0)
    warnings.push("没有识别出品种行，请确认格式是「• 品种名，919元」");

  return { periodDate, items, warnings };
}

/**
 * 解析日期行。
 *
 * ⚠️ 必须回写比对：dayjs 会把 `2026-02-30` **静默顺延**成 3 月 2 日，
 * 只看 `isValid()` 会把一个不存在的日期当成真的（`seo.ts` / `undervalued-plan.ts`
 * 同一手法，都踩过）。
 */
function parseDateLine(text: string, warnings: string[]): string | null {
  const m = text.match(DATE_RE);
  if (!m)
    return null;

  const raw = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  if (dayjs(raw).format("YYYY-MM-DD") !== raw) {
    warnings.push(`日期「${raw}」不是有效日期，请确认本期日期`);
    return null;
  }
  return raw;
}

/**
 * 日期的语义校验：必须是周二、不晚于今天。
 *
 * 只提示不阻断——补录上周的期次是正当用法；`today` 由调用方传进来，
 * 这一层才能脱离时钟单测（与 `getPlanPeriod` 同款）。
 */
export function planDateWarnings(periodDate: string | null, today: string): string[] {
  if (periodDate === null) {
    // 提示要能照做：页面上没有日期输入控件，唯一出路是改原文再来一次
    return ["原文里没有「时间：YYYY年M月D日」这一行，请补上后重新解析"];
  }

  const out: string[] = [];
  if (!isPlanDay(periodDate))
    out.push(`${periodDate} 不是周二，请确认这一期日期`);
  if (periodDate > today)
    out.push(`${periodDate} 在未来，请确认这一期日期`);
  return out;
}
