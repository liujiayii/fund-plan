import Decimal from 'decimal.js';
import { roundInt, yuanToCents } from '~/domain/money';

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
} as const;

/** 东财接口要求带 Referer，否则防盗链会挡 */
const EM_HEADERS = {
  Referer: 'https://fundf10.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
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
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 百分比字符串 → 万分之整数。
 * 支持 "1.50%"、"1.5"、"--"（异常回退 0）。
 */
export function percentToRate(pct: string | number | null | undefined): number {
  if (pct === null || pct === undefined) return 0;
  const s = String(pct).replace('%', '').trim();
  if (s === '' || s === '--') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  // 百分比 → 小数 → 万分之：1.5% = 0.015 = 万分之 150
  return roundInt(new Decimal(n).div(100).mul(10000));
}

/** 净值字符串 → ×10000 整数；非法返回 null */
function navToScaled(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '--') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
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
  if (key === '') return [];

  const cacheKey = `fund:search:${key}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundSearchItem[];
    } catch {
      // 缓存损坏就当没有，继续走网络
    }
  }

  try {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(key)}`;
    const resp = await fetchWithTimeout(url, { headers: EM_HEADERS });
    const json = (await resp.json()) as {
      Datas?: {
        CODE?: string;
        NAME?: string;
        FundBaseInfo?: { FTYPE?: string } | null;
      }[];
    };

    const items: FundSearchItem[] = (json.Datas ?? [])
      .filter((d) => d.CODE && d.NAME)
      .map((d) => ({
        code: d.CODE!,
        name: d.NAME!,
        type: d.FundBaseInfo?.FTYPE ?? '',
      }));

    await env.KV.put(cacheKey, JSON.stringify(items), {
      expirationTtl: CACHE_TTL.search,
    });
    return items;
  } catch (err) {
    console.error(`[fund-data] 搜索「${key}」失败：`, err);
    // 网络挂了但缓存还在（上面 JSON.parse 失败的情况），兜底再试一次
    if (cached) {
      try {
        return JSON.parse(cached) as FundSearchItem[];
      } catch {
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
    } catch {
      /* 缓存损坏，继续走网络 */
    }
  }

  try {
    const url =
      `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation` +
      `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_HEADERS });
    const json = (await resp.json()) as {
      Datas?: Record<string, string> | null;
    };
    const d = json.Datas;
    if (!d || !d.FCODE) return null;

    // RATE 是优惠后费率（如 0.15%），SOURCERATE 是原价（如 1.50%）。
    // 优先用优惠价——真实购买就是按这个收。
    const discounted = percentToRate(d.RATE);
    const purchaseRate = discounted > 0 ? discounted : percentToRate(d.SOURCERATE);

    const basic: FundBasic = {
      code: d.FCODE,
      name: d.SHORTNAME ?? code,
      type: d.FTYPE ?? '',
      purchaseRate,
      // MINSG 单位是元，转成分
      minPurchaseCents: yuanToCents(Number(d.MINSG) || 10),
      riskLevel: Number(d.RISKLEVEL) || 3,
      status: d.SGZT ?? '开放申购',
    };

    await env.KV.put(cacheKey, JSON.stringify(basic), {
      expirationTtl: CACHE_TTL.basic,
    });
    return basic;
  } catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 档案失败：`, err);
    return null;
  }
}

/**
 * 拉取历史净值序列（按日期倒序，最新在前）。
 *
 * 失败时返回空数组——撮合任务据此让订单保持 pending 顺延到下个交易日，
 * 绝不能把「拉不到净值」误判成「订单失败」。
 */
export async function fetchNavHistory(
  env: Env,
  code: string,
  pageSize = 60,
): Promise<NavRow[]> {
  try {
    const url =
      `https://api.fund.eastmoney.com/f10/lsjz` +
      `?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=${pageSize}`;
    const resp = await fetchWithTimeout(url, { headers: EM_HEADERS });
    const json = (await resp.json()) as {
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
      if (!item.FSRQ || unitNav === null) continue;
      rows.push({
        navDate: item.FSRQ,
        unitNav,
        accNav: navToScaled(item.LJJZ) ?? unitNav,
        growthRate: percentToRate(item.JZZZL),
      });
    }
    return rows;
  } catch (err) {
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
    const start = js.indexOf('[');
    const end = js.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    const arr = JSON.parse(js.slice(start, end + 1)) as string[][];
    return arr
      .filter((row) => Array.isArray(row) && row.length >= 4)
      .map((row) => ({ code: row[0], name: row[2], type: row[3] }));
  } catch (err) {
    console.error('[fund-data] 解析全量基金列表失败：', err);
    return [];
  }
}

/**
 * 全量基金列表（3MB 左右，缓存 7 天）。搜索接口不可用时的兜底数据源。
 */
export async function fetchAllFunds(env: Env): Promise<FundSearchItem[]> {
  const cacheKey = 'fund:list:all';
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FundSearchItem[];
    } catch {
      /* 继续走网络 */
    }
  }

  try {
    const resp = await fetchWithTimeout(
      'https://fund.eastmoney.com/js/fundcode_search.js',
      { headers: EM_HEADERS },
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
  } catch (err) {
    console.error('[fund-data] 拉取全量基金列表失败：', err);
    return [];
  }
}
