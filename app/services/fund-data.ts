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
  /**
   * 赎回状态（SHZT，如「开放赎回」）。加法字段：旧 KV 缓存缺省为 undefined。
   * 2026-09-08 实测：SHZT 只在 FundMNNBasicInformation 响应里
   * （FundMNDetailInformation 没有这个键），所以赎回状态从这里产出，
   * fetchFundDetail 复用本函数取值。
   */
  redeemStatus: string;
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
  /** 重仓股缓存 1 天（position:v2 三视图共用） */
  position: 86400,
  /** 指数净值（沪深300）缓存 1 天 */
  index: 86400,
  /** 资产配置缓存 1 天 */
  alloc: 86400,
  /** 历史分红缓存 1 天 */
  bonus: 86400,
  /** 基金经理详情缓存 1 天 */
  manager: 86400,
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
      redeemStatus: d.SHZT ?? "",
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
  /** 基金评级（上证星级 1~5；0 = 无评级）。加法字段：旧缓存缺省为 undefined，页面显示 — */
  rating: number;
  /** 投资风格（如「大盘成长型」）。加法字段，同上 */
  investStyle: string;
  /** 赎回状态（SHZT，如「开放赎回」）。加法字段，同上 */
  redeemStatus: string;
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
    // SHZT（赎回状态）2026-09-08 实测在 FundMNNBasicInformation 而非本接口——
    // 复用 fetchFundBasic（自带 fund:basic KV，1 天 TTL）补齐。详情页 loader 的
    // ensureFund 前脚刚刷过它，这里几乎必命中缓存，不新增 KV key 也不多打网络
    const [resp, basic] = await Promise.all([
      fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS }),
      fetchFundBasic(env, code),
    ]);
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
      // 稳健档新增（2026-09-08 实测）：
      // 评级字段是 RLEVEL_SZ（上证星级，"--" 或 "1"~"5"；移动端 H5 的
      // fundGrade 就是读它拼「上证X星评级」），计划预期的 JJPJ 不存在；
      // 拉不到给 0，页面显示 —，缓存 1 天后自然刷新带上真值
      rating: Number(d.RLEVEL_SZ) || 0,
      // 投资风格：实测 FundMNDetailInformation 没有风格字段（网页版 f10 的
      // 「投资风格」九宫格是一张静态图片，移动端 API 家族无文本源）——
      // 保留两个解析位兜底，当前恒为空串，页面显示 —
      investStyle: d.FUNDINVESTSTYLE ?? d.INVESTSTYLE ?? "",
      redeemStatus: basic?.redeemStatus ?? "",
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
 * 投资组合（原「重仓股」扩展）。东财 FundMNInverstPosition 同一响应里带
 * fundStocks（股票）/ fundboods（债券，接口拼写就是 boods）两块，此前只取了股票。
 * ⚠️ 用 EM_MOBILE_HEADERS。
 * 失败返回三空数组，详情页不渲染「投资组合」卡片。
 */
export interface FundStock {
  code: string;
  name: string;
  /** 占净值比 万分之（6.45% → 645） */
  ratio: number;
  industry: string;
  changeType: string;
}

/** 债券持仓条目 */
export interface FundBond {
  code: string;
  name: string;
  /** 占净值比 万分之（6.45% → 645） */
  ratio: number;
}

/** 行业配置条目 */
export interface FundIndustry {
  name: string;
  /** 占净值比 万分之 */
  ratio: number;
}

/** 投资组合视图：股票/债券/行业三块。股票+债券出自 FundMNInverstPosition，行业出自 FundMNSectorAllocation */
export interface FundPositionView {
  stocks: FundStock[];
  bonds: FundBond[];
  industries: FundIndustry[];
}

export async function fetchFundPosition(
  env: Env,
  code: string,
): Promise<FundPositionView> {
  // v2：返回形状从裸 FundStock[] 改为 {stocks,bonds,industries}——
  // 旧缓存（fund:position:{code}）存的是数组，形状不兼容必须换 key；
  // 旧 key 一天后 TTL 自然过期，无需清理
  const cacheKey = `fund:position:v2:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundPositionView;
    }
    catch {
      /* 缓存损坏 */
    }
  }

  // 行业配置单独拉（2026-09-08 实测：FundMNInverstPosition 响应里只有
  // fundStocks/fundboods/fundfofs，没有行业数据；行业在独立的
  // FundMNSectorAllocation，Datas[] 每行 {HYMC, SZ, ZJZBL}）。
  // 自带 try：行业拉挂不拖垮股票/债券，退化为空数组即可
  const fetchIndustries = async (): Promise<FundIndustry[]> => {
    try {
      const url
        = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNSectorAllocation`
          + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
      const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
      const json = (await resp.json()) as {
        Datas?: { HYMC?: string; ZJZBL?: string }[] | null;
      };
      return (json.Datas ?? [])
        .filter(i => i.HYMC)
        .map(i => ({
          name: i.HYMC!,
          ratio: percentToRate(i.ZJZBL),
        }));
    }
    catch (err) {
      console.error(`[fund-data] 拉取基金 ${code} 行业配置失败：`, err);
      return [];
    }
  };

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    // 两路并行：股票+债券（InverstPosition）与行业（SectorAllocation）
    const [resp, industries] = await Promise.all([
      fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS }),
      fetchIndustries(),
    ]);
    const json = (await resp.json()) as {
      Datas?: {
        fundStocks?: {
          GPDM?: string;
          GPJC?: string;
          JZBL?: string;
          INDEXNAME?: string;
          PCTNVCHGTYPE?: string;
        }[];
        // 2026-09-08 实测：债券键名是 fundboods（接口自己的拼写），字段
        // ZQDM（代码）/ZQMC（名称）/ZJZBL（占净值比）；拉不到就是空数组，
        // Segmented 自动隐藏对应选项（优雅降级）
        fundboods?: { ZQDM?: string; ZQMC?: string; ZJZBL?: string }[];
      } | null;
    };
    const d = json.Datas;

    const stocks: FundStock[] = (d?.fundStocks ?? [])
      .filter(s => s.GPDM && s.GPJC)
      .map(s => ({
        code: s.GPDM!,
        name: s.GPJC!,
        ratio: percentToRate(s.JZBL),
        industry: s.INDEXNAME ?? "",
        changeType: s.PCTNVCHGTYPE ?? "",
      }));

    const bonds: FundBond[] = (d?.fundboods ?? [])
      .filter(b => b.ZQDM && b.ZQMC)
      .map(b => ({
        code: b.ZQDM!,
        name: b.ZQMC!,
        ratio: percentToRate(b.ZJZBL),
      }));

    const view: FundPositionView = { stocks, bonds, industries };
    if (stocks.length + bonds.length + industries.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(view), {
        expirationTtl: CACHE_TTL.position,
      });
    }
    return view;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 投资组合失败：`, err);
    return { stocks: [], bonds: [], industries: [] };
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

/** 资产配置（股票/债券/现金占净值比） */
export interface AssetAllocation {
  /** 占净值比，百分数（85.2 表示 85.2%）。展示数据不是钱，不走精度铁律 */
  stocks: number;
  bonds: number;
  cash: number;
}

/**
 * 资产配置。东财 FundMNAssetAllocationNew。
 * ⚠️ 用 EM_MOBILE_HEADERS；失败返回 null，详情页不渲染「资产配置」卡片。
 * 2026-09-08 实测：Datas 是数组（按报告期，最新在前），字段是
 * GP（股票）/ZQ（债券）/HB（货币=现金）——计划预期的 STOCKNAV 系列不存在。
 */
export async function fetchAssetAllocation(
  env: Env,
  code: string,
): Promise<AssetAllocation | null> {
  const cacheKey = `fund:alloc:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as AssetAllocation;
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNAssetAllocationNew`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      Datas?: { GP?: string; ZQ?: string; HB?: string }[] | null;
    };
    // 取最新报告期（首行）；无报告期（新基金）返回 null
    const row = json.Datas?.[0];
    if (!row)
      return null;

    // percentToRate 百分比→万分之，这里再回百分数，
    // 顺手把 "--"/空串归一成 0
    const pct = (v: string | undefined): number => percentToRate(v ?? null) / 100;
    const alloc: AssetAllocation = {
      stocks: pct(row.GP),
      bonds: pct(row.ZQ),
      cash: pct(row.HB),
    };
    // 三项全 0 视为无数据（货币基金 GP="--" 也会被归一成 0，但 ZQ/HB 有值）
    if (alloc.stocks <= 0 && alloc.bonds <= 0 && alloc.cash <= 0)
      return null;

    await env.KV.put(cacheKey, JSON.stringify(alloc), {
      expirationTtl: CACHE_TTL.alloc,
    });
    return alloc;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 资产配置失败：`, err);
    return null;
  }
}

/** 历史分红条目 */
export interface FundBonus {
  /** 分红年度标签（自除息日取年份，如 "2025"；同年多次分红会出现重复标签） */
  year: string;
  /** 每 10 份派现（元） */
  per10Shares: number;
  /** 除息日 YYYY-MM-DD（可能缺失） */
  recordDate: string;
}

/**
 * 历史分红。东财 FundMNBonusDetail。
 * ⚠️ 用 EM_MOBILE_HEADERS；失败返回 null，无记录返回空数组——
 * 两种情况详情页都不渲染「历史分红」卡。
 * 2026-09-08 实测：计划预期的 FundMNBonus 端点 404，真名是 FundMNBonusDetail
 * （天天基金 H5 官方 bundle 里的 getFundMNBonusDetail）；记录在 Datas.FHINFO[]，
 * FHFCZ 是「每份派现（元）」，无分红基金回 Datas:null。
 */
export async function fetchBonusHistory(
  env: Env,
  code: string,
): Promise<FundBonus[] | null> {
  const cacheKey = `fund:bonus:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundBonus[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBonusDetail`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      // FHINFO：分红记录；FCINFO：份额拆分记录（本卡不展示）
      Datas?: { FHINFO?: { FSRQ?: string; FHFCZ?: string }[] } | null;
    };
    const items: FundBonus[] = (json.Datas?.FHINFO ?? [])
      .filter(b => b.FSRQ)
      .map(b => ({
        year: b.FSRQ!.slice(0, 4),
        // FHFCZ 是「每份派现（元）」，展示口径是每 10 份 → ×10。
        // 用 Decimal 吃字符串再乘，避免 0.07*10 这类浮点尾差；"--"/非法按 0 兜底
        per10Shares: b.FHFCZ && Number.isFinite(Number(b.FHFCZ))
          ? Number(new Decimal(b.FHFCZ).mul(10))
          : 0,
        // FSRQ 是除息日；接口另有 DJR（登记日）/FFR（发放日），展示取主日期即可
        recordDate: b.FSRQ ?? "",
      }));

    // 空列表也写缓存：防止无分红基金每次访问都打网络
    await env.KV.put(cacheKey, JSON.stringify(items), {
      expirationTtl: CACHE_TTL.bonus,
    });
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 分红记录失败：`, err);
    return null;
  }
}

/** 基金经理条目（fundSize/profit 为东财原样展示字符串，透传不加工） */
export interface FundManager {
  name: string;
  /** 任职起始（如 "2019-05-20"） */
  workTime: string;
  /** 在管规模（如 "132.66亿元"） */
  fundSize: string;
  /** 任期回报（如 "82.35%"） */
  profit: string;
  /** 简介 */
  resume: string;
}

/**
 * 基金经理详情。东财 FundMNMangerList。
 * ⚠️ 用 EM_MOBILE_HEADERS；失败返回 null，详情页「基金经理」卡退化为概况里的名字。
 * 2026-09-08 实测：计划预期的 FundMNManagerInformation 端点 404，真名是
 * FundMNMangerList（接口自己拼错 Manager，天天基金 H5 官方 bundle 同款拼写）。
 * 每行是一段「管理团队任期」，只取现任（LEMPDATE="--"）；本接口没有
 * FUNDSIZE/RESUME（在按经理 ID 查的详情端点里），相应字段恒为空串，
 * 页面按空值隐藏对应行。
 */
export async function fetchManagerInfo(
  env: Env,
  code: string,
): Promise<FundManager[] | null> {
  const cacheKey = `fund:manager:${code}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundManager[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNMangerList`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      Datas?: Record<string, string>[] | null;
    };
    const items: FundManager[] = (json.Datas ?? [])
      // 只取现任管理团队（离任段 LEMPDATE 是具体日期，现任是 "--"）
      .filter(m => m.MGRNAME && m.LEMPDATE === "--")
      .map((m) => {
        // PENAVGROWTH 是任期回报百分数（如 "70.492"）；"--"/非法归空串
        const growth = Number(m.PENAVGROWTH);
        return {
          name: m.MGRNAME ?? "",
          workTime: m.FEMPDATE ?? "",
          fundSize: "",
          profit: Number.isFinite(growth) ? `${growth.toFixed(2)}%` : "",
          resume: "",
        };
      });

    if (items.length > 0) {
      await env.KV.put(cacheKey, JSON.stringify(items), {
        expirationTtl: CACHE_TTL.manager,
      });
    }
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 经理详情失败：`, err);
    return null;
  }
}
