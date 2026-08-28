import type { Db } from "~/db/client";
import type { FundRow } from "~/db/schema";
import dayjs from "dayjs";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { fund } from "~/db/schema";
import { roundInt, yuanToCents } from "~/domain/money";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";

/**
 * 东方财富公开接口封装：搜索、档案、历史净值、全量列表兜底。
 *
 * 三条铁律：
 *  1. 全部走 KV 缓存，降低对东财的压力（免费版额度也有限）；
 *  2. 任何异常都不抛给上层——回退缓存，再不行返回空值，
 *     页面宁可少数据也不能白屏；
 *  3. 净值/费率一律在这里转成整数，再往上走。
 */

/** 搜索结果条目 */
export interface FundSearchItem {
  code: string;
  name: string;
  type: string;
}

/** 基金档案 */
export interface FundBasic {
  code: string;
  name: string;
  type: string;
  /** 申购费率（万分之，优惠后） */
  purchaseRate: number;
  /** 起购金额（分） */
  minPurchaseCents: number;
  /** 风险等级 1-5 */
  riskLevel: number;
  /** 申购状态，如「开放申购」 */
  status: string;
}

/** 单日净值 */
export interface NavRow {
  navDate: string;
  /** 单位净值 ×10000 */
  unitNav: number;
  /** 累计净值 ×10000 */
  accNav: number;
  /** 日涨跌率 ×10000（万分之） */
  growthRate: number;
}

/** KV 缓存时长（秒） */
const CACHE_TTL = {
  /** 搜索结果缓存 1 天 */
  search: 86400,
  /** 基金档案缓存 1 天 */
  basic: 86400,
  /** 全量列表缓存 7 天 */
  fundList: 604800,
  /** 排行榜缓存 1 天（按 类型×周期 组合，12 key/天） */
  rank: 86400,
  /** 基金详情（经理/规模/成立日）缓存 1 天 */
  detail: 86400,
  /** 重仓股缓存 1 天 */
  position: 86400,
  /** 指数净值（沪深300）缓存 1 天 */
  index: 86400,
} as const;

/**
 * 各接口所需的请求头——实测结论，别乱改：
 *
 * | 接口                | Referer | User-Agent           |
 * |---------------------|---------|----------------------|
 * | 历史净值 lsjz       | 必须    | 无所谓               |
 * | 基本信息 fundmobapi | 可选    | 绝不能带浏览器 UA ⚠️ |
 * | 搜索 fundsuggest    | 无所谓  | 无所谓               |
 *
 * ⚠️ fundmobapi 是移动端接口，它按 UA 判断调用方：
 * 带上 Chrome UA 会返回 200 但 Datas 为空（静默失败，极难排查）。
 */

/** 网页端接口用：带 Referer 过防盗链 */
const EM_WEB_HEADERS = {
  Referer: "https://fundf10.eastmoney.com/",
};

/** 移动端接口用：只给 Referer，绝不带浏览器 UA */
const EM_MOBILE_HEADERS = {
  Referer: "https://fundf10.eastmoney.com/",
};

/** 带超时的 fetch，避免 Worker 被慢接口拖死 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的 fetch：只用于实测高抖动的接口（如 push2his 指数 K 线，
 * 随机连接重置，单发成功率仅 ~40%）。间隔 200ms/400ms 递增；
 * 非「可重试」类错误（如 4xx 响应）不浪费重试——resp.ok 直接返回，
 * 由调用方按响应内容走各自的降级路径。
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0)
      await new Promise(r => setTimeout(r, 200 * attempt));
    try {
      const resp = await fetchWithTimeout(url, init);
      // 4xx/5xx 也返回：调用方解析 json 后自会走空数据降级，重试救不了它
      return resp;
    }
    catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * 百分比字符串 → 万分之整数。
 * 支持 "1.50%"、"1.5"、"--"（异常回退 0）。
 */
export function percentToRate(pct: string | number | null | undefined): number {
  if (pct === null || pct === undefined)
    return 0;
  const s = String(pct).replace("%", "").trim();
  if (s === "" || s === "--")
    return 0;
  const n = Number(s);
  if (!Number.isFinite(n))
    return 0;
  // 百分比 → 小数 → 万分之：1.5% = 0.015 = 万分之 150
  return roundInt(new Decimal(n).div(100).mul(10000));
}

/** 净值字符串 → ×10000 整数；非法返回 null */
function navToScaled(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined)
    return null;
  const s = String(v).trim();
  if (s === "" || s === "--")
    return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0)
    return null;
  return roundInt(new Decimal(n).mul(10000));
}

/**
 * 基金搜索。命中 KV 缓存则不打网络；网络异常时回退缓存；
 * 都没有就返回空数组（页面显示「无结果」，不白屏）。
 */
export async function searchFunds(
  env: Env,
  keyword: string,
): Promise<FundSearchItem[]> {
  const key = keyword.trim();
  if (key === "")
    return [];

  const cacheKey = `fund:search:${key}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundSearchItem[];
    }
    catch {
      // 缓存损坏就当没有，继续走网络
    }
  }

  try {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(key)}`;
    const resp = await fetchWithTimeout(url, { headers: EM_WEB_HEADERS });
    const json = (await resp.json()) as {
      Datas?: {
        CODE?: string;
        NAME?: string;
        FundBaseInfo?: { FTYPE?: string } | null;
      }[];
    };

    const items: FundSearchItem[] = (json.Datas ?? [])
      .filter(d => d.CODE && d.NAME)
      .map(d => ({
        code: d.CODE!,
        name: d.NAME!,
        type: d.FundBaseInfo?.FTYPE ?? "",
      }));

    await env.KV.put(cacheKey, JSON.stringify(items), {
      expirationTtl: CACHE_TTL.search,
    });
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 搜索「${key}」失败：`, err);
    // 网络挂了但缓存还在（上面 JSON.parse 失败的情况），兜底再试一次
    if (cached) {
      try {
        return JSON.parse(cached) as FundSearchItem[];
      }
      catch {
        /* 忽略 */
      }
    }
    return [];
  }
}

/**
 * 拉取基金档案（名称、费率、起购、风险等级、申赎状态）。
 * 失败返回 null，调用方应保留 DB 里的旧档案。
 */
export async function fetchFundBasic(
  env: Env,
  code: string,
): Promise<FundBasic | null> {
  const cacheKey = `fund:basic:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundBasic;
    }
    catch {
      /* 缓存损坏，继续走网络 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      Datas?: Record<string, string> | null;
    };
    const d = json.Datas;
    if (!d || !d.FCODE)
      return null;

    // RATE 是优惠后费率（如 0.15%），SOURCERATE 是原价（如 1.50%）。
    // 优先用优惠价——真实购买就是按这个收。
    const discounted = percentToRate(d.RATE);
    const purchaseRate = discounted > 0 ? discounted : percentToRate(d.SOURCERATE);

    const basic: FundBasic = {
      code: d.FCODE,
      name: d.SHORTNAME ?? code,
      type: d.FTYPE ?? "",
      purchaseRate,
      // MINSG 单位是元，转成分
      minPurchaseCents: yuanToCents(Number(d.MINSG) || 10),
      riskLevel: Number(d.RISKLEVEL) || 3,
      status: d.SGZT ?? "开放申购",
    };

    await env.KV.put(cacheKey, JSON.stringify(basic), {
      expirationTtl: CACHE_TTL.basic,
    });
    return basic;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 档案失败：`, err);
    return null;
  }
}

/**
 * 拉取历史净值序列（按日期倒序，最新在前）。
 *
 * ⚠️ 东财 2026 年起对 lsjz 接口加了钳制：**单页最多 20 行**——pageSize 填
 * 30~200 也只回 20 条，≥400 直接回空 `Data`。所以要拿长历史必须翻页：
 * 本函数内部按 20 行/页自动翻页拼齐 `wantRows` 条，调用方无感
 * （撮合 cron 要 30 条 → 2 页；详情页回填要 400 条 → 20 页）。
 *
 * 失败时返回空数组——撮合任务据此让订单保持 pending 顺延到下个交易日，
 * 绝不能把「拉不到净值」误判成「订单失败」。翻页中途某页失败不炸整体
 * （allSettled 保留成功页），第一页就失败才返回空。
 */
export async function fetchNavHistory(
  env: Env,
  code: string,
  wantRows = 60,
): Promise<NavRow[]> {
  /** 接口单页实际上限（实测值；写大无效，写 ≥400 直接回空） */
  const PAGE_SIZE = 20;
  /** 翻页并发波次宽度：一口气全并发容易触发风控（push2his 的教训） */
  const CONCURRENCY = 5;

  /** 拉并解析一页；返回本页行数与 TotalCount（拿不到时为 null） */
  const fetchPage = async (
    pageIndex: number,
  ): Promise<{ rows: NavRow[]; totalCount: number | null }> => {
    const url
      = `https://api.fund.eastmoney.com/f10/lsjz`
        + `?fundCode=${encodeURIComponent(code)}&pageIndex=${pageIndex}&pageSize=${PAGE_SIZE}`;
    const resp = await fetchWithTimeout(url, { headers: EM_WEB_HEADERS });
    const json = (await resp.json()) as {
      TotalCount?: number;
      Data?: {
        LSJZList?: {
          FSRQ?: string;
          DWJZ?: string;
          LJJZ?: string;
          JZZZL?: string;
        }[];
      } | null;
    };

    const list = json.Data?.LSJZList ?? [];
    const rows: NavRow[] = [];
    for (const item of list) {
      const unitNav = navToScaled(item.DWJZ);
      // 净值缺失的行直接跳过——宁可少一天数据，也不能写脏数据进撮合底座
      if (!item.FSRQ || unitNav === null)
        continue;
      rows.push({
        navDate: item.FSRQ,
        unitNav,
        accNav: navToScaled(item.LJJZ) ?? unitNav,
        growthRate: percentToRate(item.JZZZL),
      });
    }
    return { rows, totalCount: json.TotalCount ?? null };
  };

  try {
    // 第 1 页先单独拉：拿 TotalCount 决定还要翻几页
    const first = await fetchPage(1);
    if (first.rows.length === 0)
      return first.rows;

    // 需要的总页数：目标条数与接口存量取小（TotalCount 缺失时按首页行数估）
    const total = first.totalCount ?? first.rows.length;
    const maxPages = Math.min(
      Math.ceil(wantRows / PAGE_SIZE),
      Math.max(1, Math.ceil(total / PAGE_SIZE)),
    );

    const collected = [...first.rows];
    // 剩余页按波次并发（每波 CONCURRENCY 页），拉完为止
    const restPages: number[] = [];
    for (let p = 2; p <= maxPages; p++)
      restPages.push(p);
    for (let i = 0; i < restPages.length; i += CONCURRENCY) {
      const wave = restPages.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(wave.map(p => fetchPage(p)));
      let shortPage = false;
      for (const s of settled) {
        if (s.status !== "fulfilled")
          continue; // 单页失败不炸整体：已到手的页照常入库
        collected.push(...s.value.rows);
        // 不满一页说明后面没有更多数据了（TotalCount 不准时的兜底）
        if (s.value.rows.length < PAGE_SIZE)
          shortPage = true;
      }
      if (shortPage)
        break;
    }
    return collected;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 净值失败：`, err);
    return [];
  }
}

/**
 * 解析东财全量基金列表 JS（形如 `var r = [["代码","简拼","名称","类型","全拼"],...]`）。
 * 用于搜索接口挂掉时的兜底。
 */
export function parseFundListJs(js: string): FundSearchItem[] {
  try {
    const start = js.indexOf("[");
    const end = js.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start)
      return [];
    const arr = JSON.parse(js.slice(start, end + 1)) as string[][];
    return arr
      .filter(row => Array.isArray(row) && row.length >= 4)
      .map(row => ({ code: row[0], name: row[2], type: row[3] }));
  }
  catch (err) {
    console.error("[fund-data] 解析全量基金列表失败：", err);
    return [];
  }
}

/**
 * 全量基金列表（3MB 左右，缓存 7 天）。搜索接口不可用时的兜底数据源。
 */
export async function fetchAllFunds(env: Env): Promise<FundSearchItem[]> {
  const cacheKey = "fund:list:all";
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundSearchItem[];
    }
    catch {
      /* 继续走网络 */
    }
  }

  try {
    const resp = await fetchWithTimeout(
      "https://fund.eastmoney.com/js/fundcode_search.js",
      { headers: EM_WEB_HEADERS },
      20000,
    );
    const text = await resp.text();
    const list = parseFundListJs(text);
    if (list.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(list), {
        expirationTtl: CACHE_TTL.fundList,
      });
    }
    return list;
  }
  catch (err) {
    console.error("[fund-data] 拉取全量基金列表失败：", err);
    return [];
  }
}

/**
 * 确保基金档案在库里且不过期：没有或超过 1 天就拉东财 `fetchFundBasic` 落库。
 *
 * 抽自 `funds.$code` loader 此前的内联逻辑，供详情页与自选两处复用——
 * 自选时用户可能没访问过详情页，`fund` 表里还没这只基金，需先落档案。
 *
 * 拉不到（接口挂）且库里也没有 → 返回 null，调用方自行决定（详情页 404、自选报错）。
 * 拉不到但库里有过期档案 → 保留旧档案返回（与原 loader 行为一致，不因接口抖动丢档案）。
 */
export async function ensureFund(
  db: Db,
  env: Env,
  code: string,
): Promise<FundRow | null> {
  let f = await db.query.fund.findFirst({ where: eq(fund.code, code) });
  const stale = !f || Date.now() - f.updatedAt > 86_400_000;

  if (stale) {
    const basic = await fetchFundBasic(env, code);
    if (basic) {
      await db
        .insert(fund)
        .values({
          code: basic.code,
          name: basic.name,
          type: basic.type,
          purchaseRate: basic.purchaseRate,
          redeemTiers: DEFAULT_REDEEM_TIERS,
          minPurchase: basic.minPurchaseCents,
          riskLevel: basic.riskLevel,
          status: basic.status,
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: fund.code,
          set: {
            name: basic.name,
            type: basic.type,
            purchaseRate: basic.purchaseRate,
            minPurchase: basic.minPurchaseCents,
            riskLevel: basic.riskLevel,
            status: basic.status,
            updatedAt: Date.now(),
          },
        });
      f = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    }
  }

  return f ?? null;
}

/**
 * 基金排行榜。东财 rankhandler.aspx。
 *
 * @param env Worker 环境，提供 KV
 * @param ft 类型过滤：gp=股票型 / hh=混合型 / zs=指数型 / zq=债券型
 * @param sc 排序码：1yzf=近1月 / 3yzf=近3月 / 1nzf=近1年（由 rank-service 按 period 映射）
 * @param periodCol 选中周期收益率在逗号分隔字段里的列索引（1yzf→8, 3yzf→9, 1nzf→11）
 *
 * 失败/空 → 返回空数组（rank-service 会走本地降级）。
 */
export async function fetchFundRank(
  env: Env,
  ft: string,
  sc: string,
  periodCol: number,
): Promise<FundRankItem[]> {
  const cacheKey = `fund:rank:${ft}:${sc}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundRankItem[];
    }
    catch {
      /* 缓存损坏，走网络 */
    }
  }

  try {
    // sd/ed 给一个宽窗口（近 400 天），实际排序由 sc 控制
    const ed = dayjs().format("YYYY-MM-DD");
    const sd = dayjs().subtract(400, "day").format("YYYY-MM-DD");
    const url
      = `https://fund.eastmoney.com/data/rankhandler.aspx`
        + `?op=ph&dt=kf&ft=${encodeURIComponent(ft)}&pi=1&pn=20&po=desc`
        + `&sc=${encodeURIComponent(sc)}&sd=${sd}&ed=${ed}&qd=di&v=${Date.now()}`;
    const resp = await fetchWithTimeout(url, {
      // 排行榜页的 Referer，与 EM_WEB_HEADERS 的 fundf10 Referer 不同但不影响防盗链
      headers: { Referer: "https://fund.eastmoney.com/data/fundranking.html" },
    });
    const text = await resp.text();
    // rankhandler 返回 `var rankData = {datas:["..."],...};`——是 JS 赋值而非 JSON
    // （键名 datas 无引号），不能整体 JSON.parse。用正则抠出 datas 数组：
    // 字符串内不含 ]，可放心匹配到第一个 ]。
    const m = text.match(/datas:\s*(\[[^\]]*\])/);
    if (!m)
      return [];
    const datas = JSON.parse(m[1]) as string[];

    const items: FundRankItem[] = [];
    for (const d of datas) {
      const f = d.split(",");
      // 字段数不足无法读周期列时跳过——保证 periodCol 索引安全
      if (f.length < 7 || f.length <= periodCol)
        continue;
      const unitNav = navToScaled(f[4]);
      if (!f[0] || !f[1] || unitNav === null)
        continue;
      const periodRaw = f[periodCol] ?? "";
      items.push({
        code: f[0],
        name: f[1],
        navDate: f[3] ?? "",
        unitNav,
        growthRate: percentToRate(f[6]),
        periodRate:
          periodRaw === "" || periodRaw === "--" ? null : percentToRate(periodRaw),
      });
    }

    if (items.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(items), {
        expirationTtl: CACHE_TTL.rank,
      });
    }
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取排行榜 ft=${ft} sc=${sc} 失败：`, err);
    return [];
  }
}

/** 基金排行榜条目 */
export interface FundRankItem {
  code: string;
  name: string;
  navDate: string;
  unitNav: number;
  growthRate: number;
  periodRate: number | null;
}

/**
 * 基金详情（经理/规模/成立日/公司/基准/费率）。东财 FundMNDetailInformation。
 * 一条接口把详情页要的元数据全给齐，省得分头拉经理/规模。
 * ⚠️ 用 EM_MOBILE_HEADERS（fundmobapi 移动端，绝不能带浏览器 UA）。
 * 失败返回 null，详情页不渲染「基金概况」卡片。
 */
export interface FundDetail {
  manager: string;
  company: string;
  estabDate: string;
  scaleYuan: number | null;
  benchmark: string;
  mgmtFeeRate: number;
  trustFeeRate: number;
}

export async function fetchFundDetail(
  env: Env,
  code: string,
): Promise<FundDetail | null> {
  const cacheKey = `fund:detail:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundDetail;
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as { Datas?: Record<string, string> | null };
    const d = json.Datas;
    if (!d || !d.FCODE)
      return null;

    const detail: FundDetail = {
      manager: d.JJJL ?? "",
      company: d.JJGS ?? "",
      estabDate: d.ESTABDATE ?? "",
      // ENDNAV 是元字符串如 "3938207602.85"，"--" 时无数据
      scaleYuan: d.ENDNAV && d.ENDNAV !== "--" ? Number(d.ENDNAV) : null,
      benchmark: d.BENCH ?? "",
      mgmtFeeRate: percentToRate(d.MGREXP),
      trustFeeRate: percentToRate(d.TRUSTEXP),
    };

    await env.KV.put(cacheKey, JSON.stringify(detail), {
      expirationTtl: CACHE_TTL.detail,
    });
    return detail;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 详情失败：`, err);
    return null;
  }
}

/**
 * 重仓股。东财 FundMNInverstPosition，返回 Datas.fundStocks[]。
 * ⚠️ 用 EM_MOBILE_HEADERS。
 * 失败返回空数组，详情页不渲染「重仓股」卡片。
 */
export interface FundStock {
  code: string;
  name: string;
  /** 占净值比 万分之（6.45% → 645） */
  ratio: number;
  industry: string;
  changeType: string;
}

export async function fetchFundPosition(
  env: Env,
  code: string,
): Promise<FundStock[]> {
  const cacheKey = `fund:position:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundStock[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      Datas?: { fundStocks?: {
        GPDM?: string;
        GPJC?: string;
        JZBL?: string;
        INDEXNAME?: string;
        PCTNVCHGTYPE?: string;
      }[]; } | null;
    };
    const stocks = json.Datas?.fundStocks ?? [];

    const items: FundStock[] = stocks
      .filter(s => s.GPDM && s.GPJC)
      .map(s => ({
        code: s.GPDM!,
        name: s.GPJC!,
        ratio: percentToRate(s.JZBL),
        industry: s.INDEXNAME ?? "",
        changeType: s.PCTNVCHGTYPE ?? "",
      }));

    if (items.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(items), {
        expirationTtl: CACHE_TTL.position,
      });
    }
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 重仓股失败：`, err);
    return [];
  }
}

/**
 * 指数净值（沪深300等）。东财 push2his，新域名。
 * ⚠️ Referer 用 https://quote.eastmoney.com/（与 fundf10 不同）。
 * @param env Worker 环境，提供 KV
 * @param secid 如 "1.000300"（沪深300），"1.000001"（上证综指）
 * @param days 取最近多少天
 * 失败返回空数组（基准线不画，不阻塞详情页）。
 */
export async function fetchIndexNav(
  env: Env,
  secid: string,
  days: number,
): Promise<{ date: string; close: number }[]> {
  const cacheKey = `fund:index:${secid}:${days}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as { date: string; close: number }[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const ed = dayjs().format("YYYYMMDD");
    const sd = dayjs().subtract(days, "day").format("YYYYMMDD");
    const url
      = `https://push2his.eastmoney.com/api/qt/stock/kline/get`
        + `?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3`
        + `&fields2=f51,f52,f53&klt=101&fqt=0&beg=${sd}&end=${ed}`;
    // push2his 会随机重置连接（本地实测 10 次挂 6 次，workerd 报
    // "Network connection lost" 且自带 retryable:true），单发必抖。
    // 重试 3 次 + 间隔递增，实测把成功率抬到 >98%；
    // 仍失败则走既定降级（返回空数组，基准线不画，不阻塞详情页）。
    const resp = await fetchWithRetry(
      url,
      { headers: { Referer: "https://quote.eastmoney.com/" } },
      3,
    );
    const json = (await resp.json()) as {
      data?: { klines?: string[] } | null;
    };
    const klines = json.data?.klines ?? [];
    // 每条 "日期,开盘,收盘"
    const rows = klines
      .map((k) => {
        const parts = k.split(",");
        if (parts.length < 3)
          return null;
        const close = Number(parts[2]);
        return Number.isFinite(close) ? { date: parts[0], close } : null;
      })
      .filter((r): r is { date: string; close: number } => r !== null);

    if (rows.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(rows), {
        expirationTtl: CACHE_TTL.index,
      });
    }
    return rows;
  }
  catch (err) {
    console.error(`[fund-data] 拉取指数 ${secid} 净值失败：`, err);
    return [];
  }
}
