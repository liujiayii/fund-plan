import type { Db } from "~/db/client";
import type { FundRow } from "~/db/schema";
import dayjs from "dayjs";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { fund } from "~/db/schema";
import { roundInt, yuanToCents } from "~/domain/money";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { lastClosedTradingDay } from "~/domain/trading-calendar";

/**
 * 东方财富公开接口封装：搜索、档案、历史净值、全量列表兜底。
 *
 * 四条铁律：
 *  1. 全部走 KV 缓存，降低对东财的压力（免费版额度也有限）——
 *     空结果同样要写（"null"/"[]" 哨兵，见 fetchInvestStyle 的论证），
 *     否则无数据的基金每次访问都实打东财；瞬时故障除外，不落盘；
 *  2. 任何异常都不抛给上层——回退缓存，再不行返回空值，
 *     页面宁可少数据也不能白屏；
 *  3. 净值/费率一律在这里转成整数，再往上走；
 *  4. **KV 自身不可用不算业务失败**：读走 safeGet（当未命中，继续回源），
 *     写走 safePut（只记日志）。缓存是旁路，它挂了只该让页面变慢，
 *     不该让页面变空或 500。
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
   * （FundMNDetailInformation 没有这个键），所以赎回状态从这里产出。
   *
   * ⚠️ 它曾经被顺手塞进 7 天档的 detail 缓存里，于是「赎回状态」（冻 7 天）与旁边的
   * 「申购状态」（来自 D1，3 天档）时间差对不上。现在由基金页 loader 直接读本函数
   * （2026-09-23 对抗式 review 修正）。
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

/**
 * KV 缓存时长（秒）。
 *
 * ⚠️ 这里的每个 key 都是**一次 KV 写**，而免费版只有 1000 次写/天（读有 10 万次），
 * 是全站最紧的一环。基金详情页对**每一只基金**写 7 个 key，所以这些 TTL 直接决定
 * 「一天能承接多少只基金」：7 个全在 1 天档时 1000 ÷ 7 ≈ 143 只/天就写满，而线上库
 * 已有 113 只基金、sitemap 又把它们全量投给爬虫——2026-09-23 收到了 CF 的 50% 告警。
 *
 * ⚠️ 长 TTL 只摊薄「反复访问」的稳态成本，**不降低单日峰值**：TTL 从写入时刻起算、
 * 且只在未命中时才写，所以「首次全量抓取」或「6 个长 key 齐过期后重抓」的那一天
 * 仍是一次 7 写/只（113 只 = 791 ≈ 79% 额度），只是从「每天如此」变成「每 7 天一次」。
 * 要压峰值只能动结构（把纯东财镜像挪出 KV、或减少每只基金的 key 数），别指望再拉长 TTL。
 *
 * 分档原则：**按数据自身的变动频率**分，不按页面上的重要性分：
 *  - 1 天档：档案（费率/申赎状态会随公告变，且与 ensureFund 的 1 天节奏同源）、
 *    搜索词（key 空间无界，每个词一条）、排行榜（用户直接看数字，要新鲜）
 *  - 7 天档：季度级披露（重仓股、资产配置、规模）与几乎只增不改的历史
 *    （分红、基金经理、投资风格）
 *
 * 改动后的写量预算由 `tests/domain/fund-data.test.ts` 的「写入预算守卫」钉住：
 * 单只基金冷启动的均摊成本必须 **< 2 次/天**（当前 ≈ 1.19）。阈值只是粗线，精确的
 * 锁是另外两条：key 集合断言（新增 key 必须显式登记）与源码守卫（基金页新增取数
 * 调用就红）。
 */
const CACHE_TTL = {
  /** 搜索结果缓存 1 天（key 空间无界：一个词一条，别把存量垃圾也拉长；空结果不落缓存） */
  search: 86400,
  /**
   * 基金档案缓存 3 天：费率与起购金额**会**参与下单（试算与起购校验，见 trade.ts），
   * 只是这两项都是公告级变动、不常改；申赎状态目前只展示。窗口与 ensureFund 绑定
   * （FUND_PROFILE_FRESH_MS），改这里要一起改。
   */
  basic: 259200,
  /** 全量列表缓存 7 天 */
  fundList: 604800,
  /** 排行榜缓存 1 天（按 类型×周期 组合，12 key/天——量小，且用户直接看数字） */
  rank: 86400,
  /** 基金详情（经理/规模/成立日）缓存 7 天：规模按季披露 */
  detail: 604800,
  /** 重仓股缓存 7 天（position:v2 三视图共用）：按季披露 */
  position: 604800,
  /** 指数净值（沪深300）缓存 7 天（400 天序列做基准线，旧几天无妨） */
  index: 604800,
  /** 资产配置缓存 7 天：按季披露 */
  alloc: 604800,
  /** 历史分红缓存 7 天：只增量追加 */
  bonus: 604800,
  /** 基金经理详情缓存 7 天：换人极少见 */
  manager: 604800,
  /** 投资风格缓存 7 天：几乎不变 */
  style: 604800,
} as const;

/**
 * 基金档案的新鲜度窗口（毫秒）：与 `CACHE_TTL.basic` **同一个节奏**。
 *
 * `ensureFund` 过了这个窗口就去调 `fetchFundBasic`，而后者只在 KV 缓存过期时才真的
 * 打东财——两边若不同步，就会出现「每天刷一次、但每次都拿到同一份三天前的缓存」，
 * 白写一次 D1（2026-09-23 对抗式 review 的发现，守卫测试钉住了这个窗口）。
 */
const FUND_PROFILE_FRESH_MS = CACHE_TTL.basic * 1000;

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

/**
 * 单页普通请求超时（毫秒）。默认档给「有人等着」的路径用：失败要快。
 */
export const NAV_FETCH_TIMEOUT_MS = 8000;

/**
 * 没人等的路径（撮合 cron、页面后台回填）的超时。
 *
 * 2026-09-23 实测：从 CF 边缘打 lsjz 单页要 7~8s（4 次探针 TTFB 6.8~8.5s），
 * 正贴着默认的 8s 线——偶尔一页被掐断就是「今晚订单整晚顺延」或
 * 「基准线/历史缺一段」。这些路径没有用户等着，给足余量。
 */
export const NAV_FETCH_TIMEOUT_BACKGROUND_MS = 12000;

/**
 * 页面侧回填的行数上限 = **一次翻页波**（CONCURRENCY × PAGE_SIZE = 5 × 20）。
 *
 * 2026-09-23 对抗 review 修正：原先基金页在 `ctx.waitUntil` 里做 400 行回填
 * （20 页 = 首页 + 4 波 ≈ 5 个串行阶段），而平台硬顶是 **响应发出后 30 秒**
 * （所有 waitUntil 共享）、CPU 还与 SSR 共享 Free 档的 10ms——实测 lsjz 单页
 * 7~8s ⇒ 35~60s，会被平台**掐死且什么都没写**（闸门却已经烧掉）。
 * 所以页面只补「最近一段」（≤100 行，够补齐新鲜度），长历史（400 行）
 * 不在请求里做——留给回测页（用户主动等）与后续的 cron/队列任务。
 */
export const NAV_PAGE_BACKFILL_MAX_ROWS = 100;

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
 * KV「尽力而为」写入：缓存是旁路，写失败绝不能连累已经抓到的数据。
 *
 * 2026-09-23 收到 CF「Workers KV 操作数接近每日上限」告警后加固。额度打满时
 * KV 的 put 会 429 抛错，而原先 put 与抓取共用同一个 try/catch ——写缓存失败
 * 被当成抓取失败，页面把已经到手的数据全丢了：详情页 7 张卡集体变空、库里还没有
 * 的基金直接 404。写不进去最多是下次再回源，不该是这个后果。
 */
async function safePut(
  env: Env,
  key: string,
  value: string,
  options?: KVNamespacePutOptions,
): Promise<void> {
  try {
    await env.KV.put(key, value, options);
  }
  catch (err) {
    // 留痕：额度打满与上游挂掉是两回事，线上要能一眼区分
    console.error(`[fund-data] KV 写入 ${key} 失败（缓存本轮不落盘，数据照常返回）：`, err);
  }
}

/**
 * KV 读取的容错包装（与 safePut 对称）。
 *
 * 「读不到缓存」与「缓存里没有」对调用方应该是同一个结果：回源。原先 `env.KV.get`
 * 全在 try 之外，KV 一侧抖动或 5xx 就会把异常一路抛到 loader——基金页整页 500，
 * 而缓存本来就是旁路（2026-09-23 对抗式 review 指出读写不对称）。
 */
async function safeGet(env: Env, key: string): Promise<string | null> {
  try {
    return await env.KV.get(key);
  }
  catch (err) {
    console.error(`[fund-data] KV 读取 ${key} 失败（当作未命中，照常回源）：`, err);
    return null;
  }
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
 * 搜索关键词归一化：折叠空白 + 统一小写 + 截断到 32 字符。
 *
 * 关键词直接进 KV key（`fund:search:{词}`），而 key 空间是**无界**的——用户与爬虫
 * 都能随手造新词。前两件事把「同一意图的不同写法」收成一个 key（少写一次），
 * 截断则堵住超长串把 key 撑爆（KV key 上限 512 字节，超了 put 直接抛错）。
 * 归一化后的词同时用于上游查询：基金代码是数字、名称是中文，这两类占绝大多数输入，
 * 本来就不受大小写与空白影响。
 */
const SEARCH_KEY_MAX_LEN = 32;
function normalizeSearchKeyword(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, SEARCH_KEY_MAX_LEN);
}

/**
 * 基金搜索。命中 KV 缓存则不打网络；网络异常时回退缓存；
 * 都没有就返回空数组（页面显示「无结果」，不白屏）。
 * **空结果不落缓存**——理由见函数体内注释（搜索是无界的写通道）。
 */
export async function searchFunds(
  env: Env,
  keyword: string,
): Promise<FundSearchItem[]> {
  const key = normalizeSearchKeyword(keyword);
  if (key === "")
    return [];

  const cacheKey = `fund:search:${key}`;
  const cached = await safeGet(env, cacheKey);
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

    // 空结果不落缓存：搜索是目前**唯一无界**的写通道（每个新关键词一个 key），
    // 一个遍历 ?q=<随机词> 的爬虫一轮就能造出上千次写、把当日 1000 次额度吃光。
    // 代价是空结果每次回源——上游是廉价的搜索接口（不像 lsjz 对海外 IP 敌对），
    // 拿它换掉这个悬崖很划算（2026-09-23 对抗式 review 的结论）。
    if (items.length > 0) {
      await safePut(env, cacheKey, JSON.stringify(items), {
        expirationTtl: CACHE_TTL.search,
      });
    }
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
  const cached = await safeGet(env, cacheKey);
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

    await safePut(env, cacheKey, JSON.stringify(basic), {
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
 * 长历史拉取的结果：行 + 「完整度」信号。
 *
 * 为什么需要 complete（2026-09-23 CodeRabbit 评审）：翻页中途**一整波全败**时
 * 会收手并返回已到手的部分行——首页那 20 行也算「非空」。调用方若只看
 * `rows.length !== 0` 就记「拉取成功」，记忆化闸门就会锁满 6 小时
 * （NAV_BACKFILL_INTERVAL_MS），而库里其实只有二十来行：回测页这 6 小时里
 * 静默按短窗口计算。拉取失败只锁短冷却，部分成功同理。
 *
 * 完整 = 计划内的页都拿到了（翻完、TotalCount 取尽，或遇到短页 = 上游没有更多）。
 * 不完整 = 首屏失败，或中途一整波全败。
 */
export interface NavHistoryFetch {
  rows: NavRow[];
  complete: boolean;
}

/**
 * 拉取历史净值序列（按日期倒序，最新在前）+ 完整度信号。
 *
 * ⚠️ 东财 2026 年起对 lsjz 接口加了钳制：**单页最多 20 行**——pageSize 填
 * 30~200 也只回 20 条，≥400 直接回空 `Data`。所以要拿长历史必须翻页：
 * 本函数内部按 20 行/页自动翻页拼齐 `wantRows` 条，调用方无感
 * （撮合 cron 要 30 条 → 2 页；详情页回填要 400 条 → 20 页）。
 *
 * 失败时返回空数组——撮合任务据此让订单保持 pending 顺延到下个交易日，
 * 绝不能把「拉不到净值」误判成「订单失败」。翻页中途某页失败不炸整体
 * （allSettled 保留成功页），**某一波全败就收手**（上游此刻不可用，继续翻页
 * 只是把超时一笔笔重复付掉），第一页就失败才返回空。
 *
 * `timeoutMs` 是单页超时：有人等着的路径用默认值（失败要快），
 * cron / 页面后台回填传 NAV_FETCH_TIMEOUT_BACKGROUND_MS。
 */
export async function fetchNavHistoryDetailed(
  env: Env,
  code: string,
  wantRows = 60,
  timeoutMs = NAV_FETCH_TIMEOUT_MS,
): Promise<NavHistoryFetch> {
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
    const resp = await fetchWithTimeout(url, { headers: EM_WEB_HEADERS }, timeoutMs);
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
    // 首屏就空：可能上游挂了，也可能这只基金确实没有历史。两种都拿不到
    // 计划内的页，一律算不完整（调用方按 rows.length === 0 分支）
    if (first.rows.length === 0)
      return { rows: first.rows, complete: false };

    // 需要的总页数：目标条数与接口存量取小（TotalCount 缺失时按首页行数估）
    const total = first.totalCount ?? first.rows.length;
    const maxPages = Math.min(
      Math.ceil(wantRows / PAGE_SIZE),
      Math.max(1, Math.ceil(total / PAGE_SIZE)),
    );

    const collected = [...first.rows];
    // 默认完整；只有「中途整波全败」才翻成 false（遇到短页是上游没数据了，仍算完整）
    let complete = true;
    // 剩余页按波次并发（每波 CONCURRENCY 页），拉完为止
    const restPages: number[] = [];
    for (let p = 2; p <= maxPages; p++)
      restPages.push(p);
    for (let i = 0; i < restPages.length; i += CONCURRENCY) {
      const wave = restPages.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(wave.map(p => fetchPage(p)));
      let shortPage = false;
      let fulfilled = 0;
      for (const s of settled) {
        if (s.status !== "fulfilled")
          continue; // 单页失败不炸整体：已到手的页照常入库
        fulfilled++;
        collected.push(...s.value.rows);
        // 不满一页说明后面没有更多数据了（TotalCount 不准时的兜底）
        if (s.value.rows.length < PAGE_SIZE)
          shortPage = true;
      }
      // 一整波全败 = 上游此刻不可用（跨境链路抖动）。继续翻页只会把超时
      // 一笔笔重复付掉，把 cron / 后台任务的时间预算耗光——收手
      if (fulfilled === 0) {
        complete = false;
        break;
      }
      if (shortPage)
        break;
    }
    return { rows: collected, complete };
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 净值失败：`, err);
    return { rows: [], complete: false };
  }
}

/**
 * 只要行的薄包装：撮合 cron 等「拉不到就顺延」的调用方用这个
 * （完整度对它们没有意义）。需要区分「部分成功」的调用方
 * ——回填闸门——请直接用 fetchNavHistoryDetailed。
 */
export async function fetchNavHistory(
  env: Env,
  code: string,
  wantRows = 60,
  timeoutMs = NAV_FETCH_TIMEOUT_MS,
): Promise<NavRow[]> {
  return (await fetchNavHistoryDetailed(env, code, wantRows, timeoutMs)).rows;
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
  const cached = await safeGet(env, cacheKey);
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
      await safePut(env, cacheKey, JSON.stringify(list), {
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
 * 确保基金档案在库里且不过期：没有、或超过 `FUND_PROFILE_FRESH_MS`（=KV 缓存 TTL）
 * 就拉东财 `fetchFundBasic` 落库。
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
  const stale = !f || Date.now() - f.updatedAt > FUND_PROFILE_FRESH_MS;

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
  const cached = await safeGet(env, cacheKey);
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
      await safePut(env, cacheKey, JSON.stringify(items), {
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
}

export async function fetchFundDetail(
  env: Env,
  code: string,
): Promise<FundDetail | null> {
  const cacheKey = `fund:detail:${code}`;
  const cached = await safeGet(env, cacheKey);
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
      // 稳健档新增（2026-09-08 实测）：
      // 评级字段是 RLEVEL_SZ（上证星级，"--" 或 "1"~"5"；移动端 H5 的
      // fundGrade 就是读它拼「上证X星评级」），计划预期的 JJPJ 不存在；
      // 拉不到给 0，页面显示 —，缓存到期后自然刷新带上真值（7 天档，见 CACHE_TTL）。
      // 钳到 0~5（CodeRabbit 评审）：负数会让 "★".repeat 在渲染期抛
      // RangeError 白屏，超界值会把概况卡撑破——钳在解析处，消费方全保护
      rating: Math.min(5, Math.max(0, Number(d.RLEVEL_SZ) || 0)),
      // 投资风格：实测 FundMNDetailInformation 没有风格字段（网页版 f10 的
      // 「投资风格」九宫格是一张静态图片，移动端 API 家族无文本源）——
      // 保留两个解析位兜底，当前恒为空串，页面显示 —
      investStyle: d.FUNDINVESTSTYLE ?? d.INVESTSTYLE ?? "",
    };

    await safePut(env, cacheKey, JSON.stringify(detail), {
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
  // 旧 key 到期后 TTL 自然过期，无需清理（7 天档，见 CACHE_TTL）
  const cacheKey = `fund:position:v2:${code}`;
  const cached = await safeGet(env, cacheKey);
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
      await safePut(env, cacheKey, JSON.stringify(view), {
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

/** 指数净值点：date=交易日，close=收盘点数（未缩放，直接画线用） */
export interface IndexNavPoint {
  date: string;
  close: number;
}

/**
 * 指数净值（沪深300等）。东财 push2his，新域名。
 * ⚠️ Referer 用 https://quote.eastmoney.com/（与 fundf10 不同）。
 * @param env Worker 环境，提供 KV
 * @param secid 如 "1.000300"（沪深300），"1.000001"（上证综指）
 * @param days 取最近多少天
 * @param now 取数时刻（默认当前）。注入是为了覆盖「盘中 / 盘后」两种窗口
 * 失败降级顺序：陈旧兜底缓存（无 TTL 的 last-known-good）→ 空数组
 * （基准线不画，不阻塞详情页）。
 */
export async function fetchIndexNav(
  env: Env,
  secid: string,
  days: number,
  now: Date = new Date(),
): Promise<IndexNavPoint[]> {
  const cacheKey = `fund:index:${secid}:${days}`;
  // 陈旧兜底 key：无过期，成功时随主缓存一起双写，只在拉取失败时救场
  // ——基准线是 400 天序列，旧几个缓存周期无妨，总比不画强
  // （2026-09-14 实测：边缘节点打 push2his 失败率远高于本地的 <2%，
  // 线上 24h 刷了 14 条拉取失败日志，缓存过期窗口内基准线整段消失）
  const staleKey = `${cacheKey}:stale`;
  const cached = await safeGet(env, cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as IndexNavPoint[];
    }
    catch {
      /* 缓存损坏 */
    }
  }

  /**
   * 统一降级出口：「抛异常」与「HTTP 200 但没数据」两条失败路都走这里。
   *
   * 日志分层（2026-09-23）：有兜底 → warn（数据在变旧但页面照常，末日期供排障）；
   * 无兜底 → error（用户真的看不到基准线）。
   * err 一律 String() 进模板：走 `console.error(msg, err)` 时 CF 日志管线会丢掉
   * err 的 message、只留 stack（2026-09-23 线上日志实测），那样排障时分不清
   * 「连接被重置」和「我们自己的 8s 超时」。
   */
  const fallbackToStale = async (
    reason: string,
    err?: unknown,
  ): Promise<IndexNavPoint[]> => {
    // 读兜底缓存：KV 自己炸了也不能连累页面（safeGet 内部吞异常并留日志）
    const stale = await safeGet(env, staleKey);
    if (stale) {
      try {
        const rows = JSON.parse(stale) as IndexNavPoint[];
        console.warn(
          `[fund-data] 指数 ${secid} ${reason}；改用陈旧兜底（末日期 ${rows.at(-1)?.date ?? "未知"}），基准线暂用旧数据`,
        );
        return rows;
      }
      catch {
        /* 兜底也损坏，落到下面报 error */
      }
    }
    // 原因进模板（CF 日志管线可能只留 stack），原始 err 仍作第二参传下去（保 stack）
    console.error(
      `[fund-data] 指数 ${secid} ${reason}；无兜底数据，本次不画基准线`,
      err,
    );
    return [];
  };

  try {
    // 右端取「最后已收盘的交易日」：盘中抓取会把当天实时价当 K 线返回，
    // 被 7 天 TTL 冻住（2026-09-23 线上实测），且与基金线末端错位
    const edDay = lastClosedTradingDay(now);
    const ed = dayjs(edDay).format("YYYYMMDD");
    const sd = dayjs(edDay).subtract(days, "day").format("YYYYMMDD");
    const url
      = `https://push2his.eastmoney.com/api/qt/stock/kline/get`
        + `?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3`
        + `&fields2=f51,f52,f53&klt=101&fqt=0&beg=${sd}&end=${ed}`;
    // push2his 会随机重置连接（本地实测 10 次挂 6 次，workerd 报
    // "Network connection lost" 且自带 retryable:true），单发必抖。
    // 重试 3 次 + 间隔递增，本地实测把成功率抬到 >98%；
    // 但从 Cloudflare 海外边缘访问时基本打不通（东财对海外数据中心 IP
    // 不友好）：2026-09-23 线上实测**单次 HTTP 成功率仅 ~4%**（7 个批次里
    // 6 败 1 成反推；4 次重试把一轮抬到 ~14%——两个量纲别混）。重试救不了它，
    // 只是让失败别直接砸在访客身上；根治要换源或离线预抓（见开发文档）。
    // 所以失败后还要走 stale 兜底。
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
      .filter((r): r is IndexNavPoint => r !== null);

    // HTTP 200 但一根 K 线都没有（限流 / 被挡）：与抛异常同一条降级路径。
    // 原先这条出口直接 return 空数组——基准线静默消失且不留日志，比报错更隐蔽
    if (rows.length === 0)
      return await fallbackToStale(`返回空数据（HTTP ${resp.status}）`);

    // 双写：主缓存（带 TTL）+ 陈旧兜底（无过期）。
    // KV 无原子批量，两笔分开写最坏差一拍，兜底旧一个周期而已，无害
    await safePut(env, cacheKey, JSON.stringify(rows), {
      expirationTtl: CACHE_TTL.index,
    });
    await safePut(env, staleKey, JSON.stringify(rows));
    return rows;
  }
  catch (err) {
    // 拉取全灭：退而求其次用上次成功的数据画基准线；冷启动（兜底也没有）才报 error
    return await fallbackToStale(`拉取失败：${String(err)}`, err);
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
  const cached = await safeGet(env, cacheKey);
  if (cached) {
    try {
      // 命中哨兵 "null" 时 JSON.parse 天然还原 null（非空串判真，链路自洽）
      return JSON.parse(cached) as AssetAllocation | null;
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
    // 取最新报告期（首行）。无报告期（新基金）或三项全 0（全 "--"）都算
    // 无数据：alloc 置 null，但空结果也写 KV（"null" 哨兵）——不写的话
    // 这类基金每次访问都实打东财，违背顶注「全部走 KV 缓存」铁律
    // （评审修正，与 bonus/style 的空哨兵范式对齐）
    let alloc: AssetAllocation | null = null;
    const row = json.Datas?.[0];
    if (row) {
      // percentToRate 百分比→万分之，这里再回百分数，
      // 顺手把 "--"/空串归一成 0
      const pct = (v: string | undefined): number => percentToRate(v ?? null) / 100;
      alloc = {
        stocks: pct(row.GP),
        bonds: pct(row.ZQ),
        cash: pct(row.HB),
      };
      // 三项全 0 视为无数据（货币基金 GP="--" 也会被归一成 0，但 ZQ/HB 有值）
      if (alloc.stocks <= 0 && alloc.bonds <= 0 && alloc.cash <= 0)
        alloc = null;
    }

    await safePut(env, cacheKey, JSON.stringify(alloc), {
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
  const cached = await safeGet(env, cacheKey);
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
    await safePut(env, cacheKey, JSON.stringify(items), {
      expirationTtl: CACHE_TTL.bonus,
    });
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 分红记录失败：`, err);
    return null;
  }
}

/**
 * 基金经理条目。字段口径如实描述（Task 8 评审 Minor 修正，2026-09-08）：
 * profit 由 PENAVGROWTH 格式化为百分号串（如 "70.49%"），不是原样透传；
 * fundSize / resume 在本接口（FundMNMangerList）无数据源、恒为空串，
 * 页面按空值隐藏对应行。
 */
export interface FundManager {
  name: string;
  /** 任职起始（如 "2019-05-20"） */
  workTime: string;
  /** 在管规模（本接口无此数据源，恒为空串；字段保留供 UI 兜底链） */
  fundSize: string;
  /** 任期回报（由 PENAVGROWTH 格式化为 "70.49%" 形态的百分号串） */
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
  const cached = await safeGet(env, cacheKey);
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

    // 空列表也写缓存（"[]" 哨兵）：无现任经理的基金（如指数基金）不写的话
    // 每次访问都实打东财，违背顶注「全部走 KV 缓存」铁律
    // （评审修正，与 bonus/style 的空哨兵范式对齐）
    await safePut(env, cacheKey, JSON.stringify(items), {
      expirationTtl: CACHE_TTL.manager,
    });
    return items;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 经理详情失败：`, err);
    return null;
  }
}

/**
 * 投资风格。东财 FundMNTagList——移动端唯一有文本风格的源
 * （FundMNDetailInformation 的 FUNDINVESTSTYLE/INVESTSTYLE 实测不存在，
 * 2026-09-08 主人裁决换源）。
 * ⚠️ 用 EM_MOBILE_HEADERS；失败返回 null，概况卡显示 —。
 *
 * 2026-09-08 实测（16 只基金采样）：Datas 是数组（每行 { FEATYPE, TAGLIST[] }），
 * 标签文本在 TAGLIST[].FEANAME——骨架假设的「Datas 上的单字段」不存在。且标签
 * 混装：「十年优秀基 / 夏普高 / 优秀基金经理 / 长期绩优基金」等是质量标签，
 * 风格标签全族以「投资」开头（如「投资大盘股」）——「投资」前缀过滤是
 * 采样归纳的启发式，不是接口契约；多标签基金里质量标签可能排在前面，
 * 取首标签不可行。无风格标签（纯质量标签，或债券基金直接回 Datas:null）
 * 返回 null，概况卡显示 —。
 */
export async function fetchInvestStyle(
  env: Env,
  code: string,
): Promise<string | null> {
  const cacheKey = `fund:style:${code}`;
  const cached = await safeGet(env, cacheKey);
  if (cached) {
    try {
      // 命中哨兵 "null" 时 JSON.parse 天然还原 null（非空串判真，链路自洽）
      return JSON.parse(cached) as string | null;
    }
    catch {
      /* 缓存损坏 */
    }
  }

  try {
    const url
      = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNTagList`
        + `?FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.8`;
    const resp = await fetchWithTimeout(url, { headers: EM_MOBILE_HEADERS });
    const json = (await resp.json()) as {
      Datas?: { TAGLIST?: { FEANAME?: string }[] }[] | null;
    };
    // 摊平所有分组的标签，只留「投资X」风格文本（启发式的实测证据见顶注）
    const styles = (json.Datas ?? [])
      .flatMap(d => d.TAGLIST ?? [])
      .map(t => (t.FEANAME ?? "").trim())
      .filter(name => name.startsWith("投资"));
    // 多枚风格标签（如「投资大盘股」+ 未来的「投资港股」类）用「 / 」串联
    const style = styles.length > 0 ? styles.join(" / ") : null;
    // 无风格也写缓存：JSON.stringify(null) 就是 "null"，作哨兵——不写的话
    // 这类基金每次访问都实打东财，违背顶注「全部走 KV 缓存」铁律。
    // TTL 7 天：到期后有一次重试拿真值的机会（哨兵方案的附带优点）
    await safePut(env, cacheKey, JSON.stringify(style), {
      expirationTtl: CACHE_TTL.style,
    });
    return style;
  }
  catch (err) {
    console.error(`[fund-data] 拉取基金 ${code} 投资风格失败：`, err);
    return null;
  }
}
