/**
 * SEO 基建（纯函数，不依赖 Fetch / D1）。
 *
 * 搜索引擎要的三件事：
 *   1. robots.txt 告诉爬虫能抓什么、sitemap 在哪
 *   2. sitemap.xml 给出公开页清单（绝对 URL）
 *   3. 每页的 title / description / canonical / OG；私页加 noindex
 *
 * 域名钉死主站 `liujiayii.dpdns.org`：canonical / sitemap / robots 只出这一个 host
 * （全站只服务这一个域名，别处挂第二个 host 会让搜索引擎当两站）。
 */

import type { DcaAdjustMode, DcaFrequency } from "./dca-backtest";
import dayjs from "dayjs";
import { DCA_FREQUENCY_LABELS } from "./dca-backtest";
import { centsToYuan, rateToPercent } from "./money";

/** 主站 origin，无尾斜杠。所有绝对 URL 都从这里拼 */
export const CANONICAL_ORIGIN = "https://liujiayii.dpdns.org";

/** 站点名：首页 title 原样用，其它页当「· 模拟基金」后缀的品牌段 */
export const SITE_NAME = "模拟基金 · 定投系统";

/** 默认分享图：站点 SVG favicon。没有单独 OG 图之前先用它，总比空白好 */
export const DEFAULT_OG_IMAGE = `${CANONICAL_ORIGIN}/favicon.svg`;

/** 首页 / 默认 description，公开页没给自己的文案时回落到这里 */
export const DEFAULT_DESCRIPTION
  = "用真实基金数据玩模拟盘：真实 T+1 撮合、内扣申购费、FIFO 阶梯赎回费，每日签到领本金";

/** sitemap 里的静态公开页（不含基金详情——那些按库里已有代码动态追加） */
export const SITEMAP_STATIC_PATHS = [
  "/",
  "/master",
  "/plan",
  "/leaderboard",
  "/funds",
  "/tools/fee-calculator",
  "/tools/dca-backtest",
  "/login",
  "/register",
] as const;

/** 6 位数字基金代码。sitemap 只收录合法代码，脏数据进索引比漏收更糟 */
const FUND_CODE_RE = /^\d{6}$/;

/**
 * 把站内 path 收成主站绝对 URL。
 * 剥查询串与 hash（canonical 不带它们）；保证以 / 开头；首页是 origin + "/"。
 */
export function canonicalUrl(path: string): string {
  const raw = path.trim() || "/";
  const noHash = raw.split("#")[0] ?? raw;
  const noQuery = noHash.split("?")[0] ?? noHash;
  const withSlash = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  // origin 无尾斜杠，path 必以 / 开头，拼出来不会出现双斜杠（首页恰好是 origin/）
  return `${CANONICAL_ORIGIN}${withSlash}`;
}

/** robots.txt 全文。Allow 全站、Disallow 私页前缀、Sitemap 指向主站 */
export function buildRobotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /me",
    "Disallow: /admin",
    "Disallow: /logout",
    "Disallow: /me/trade",
    "",
    `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

/**
 * 转义 sitemap XML 里的文本节点。loc 是我们自己拼的绝对 URL，
 * 理论上不含 <>&，但基金代码一旦脏了就可能把 XML 弄废——防御性转义。
 */
function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * sitemap 里的一条基金页。
 * 非法（非 6 位数字）代码整条丢弃；lastmod 缺失或格式不对就不输出那行。
 */
export interface SitemapFund {
  /** 6 位基金代码 */
  code: string;
  /** 该基金最新净值日期 YYYY-MM-DD（库里 max(nav_date)）；没有净值行时传 null */
  lastmod?: string | null;
}

/** lastmod 必须是 YYYY-MM-DD——脏数据宁可丢掉，也别把 XML 弄废 */
const LASTMOD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * lastmod 必须是**真实存在**的日期。
 * nav_date 落库前只校验了非空（schema 只有 notNull），东财字段脏了会给到
 * 2026-13-40 / 2026-02-30 这种「格式对但不存在」的值，一路经 max(nav_date)
 * 传到这里——真发出去就是个无效的 lastmod（CodeRabbit 评审 #2）。
 */
function isValidLastmod(value: string): boolean {
  if (!LASTMOD_RE.test(value)) {
    return false;
  }
  const d = dayjs(value);
  // 回写比对：dayjs 对越界日期可能顺延（2026-02-30 → 03-02），顺延过就不是同一个日期
  return d.isValid() && d.format("YYYY-MM-DD") === value;
}

/** 单条 <url>。有 lastmod 才输出那一行：空标签会被爬虫当脏数据 */
function urlTag(loc: string, lastmod: string | null): string {
  const lines = [`    <loc>${xmlEscape(loc)}</loc>`];
  if (lastmod) {
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
  }
  return `  <url>\n${lines.join("\n")}\n  </url>`;
}

/**
 * 生成 sitemap.xml。
 *
 * lastmod 只给**基金详情页**，取各自的 max(nav_date)——那是页面内容真正变动的
 * 时间（每晚净值同步就变）。静态页刻意不猜 lastmod：Google 明确说 lastmod
 * 不准确会被忽略，一致性正确比"看起来新鲜"重要。
 */
export function buildSitemapXml(funds: readonly SitemapFund[]): string {
  const urlTags: string[] = SITEMAP_STATIC_PATHS.map(p => urlTag(canonicalUrl(p), null));
  for (const f of funds) {
    if (!FUND_CODE_RE.test(f.code)) {
      continue;
    }
    const lastmod = f.lastmod && isValidLastmod(f.lastmod) ? f.lastmod : null;
    urlTags.push(urlTag(canonicalUrl(`/funds/${f.code}`), lastmod));
  }
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
    urlTags.join("\n"),
    "</urlset>",
    "",
  ].join("\n");
}

/** React Router `meta()` 返回的条目。字段按 RR8 的约定展开到 <head> */
export type PageMetaTag
  = { title: string }
    | { name: string; content: string }
    | { property: string; content: string }
    | { tagName: "link"; rel: string; href: string };

export interface PageMetaInput {
  /** 页面标题。默认会拼「 · 模拟基金」；首页设 brandSuffix: false 原样用 */
  title: string;
  /** 缺省时公开页用 DEFAULT_DESCRIPTION；私页（index: false）不写 description */
  description?: string;
  /** 站内路径，如 /leaderboard、/funds?type=hh（query 会被剥掉） */
  path: string;
  /** 是否允许索引。默认 true；/me /admin 传 false */
  index?: boolean;
  /** 是否给 title 加品牌后缀。默认 true */
  brandSuffix?: boolean;
}

/** 给 title 加品牌后缀；已经带了「· 模拟基金」或等于站点名的不再叠 */
function withBrand(title: string, brandSuffix: boolean): string {
  if (!brandSuffix || title === SITE_NAME || title.endsWith(" · 模拟基金"))
    return title;
  return `${title} · 模拟基金`;
}

/**
 * 拼一页的 meta 标签。
 * 公开页：title + description + canonical + OG + twitter。
 * 私页：title + robots=noindex,nofollow，不产出 OG / canonical
 * （没必要给搜索引擎一张不该进索引的卡片）。
 */
export function pageMeta(input: PageMetaInput): PageMetaTag[] {
  const index = input.index ?? true;
  const title = withBrand(input.title, input.brandSuffix ?? true);

  if (!index) {
    return [
      { title },
      { name: "robots", content: "noindex, nofollow" },
    ];
  }

  const description = input.description ?? DEFAULT_DESCRIPTION;
  const url = canonicalUrl(input.path);
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: DEFAULT_OG_IMAGE },
    { property: "og:locale", content: "zh_CN" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

/** 基金页 meta 要用到的回测事实（结构类型：不让 seo 依赖回测模块的类型） */
export interface FundBacktestFacts {
  /** 期数 */
  periods: number;
  /** 累计投入（分） */
  investedCents: number;
  /** 期末市值（分） */
  finalValueCents: number;
  /** 累计收益率 ×10000（万分之，可负） */
  returnRate: number;
  /** 最大回撤 ×10000（万分之，正数） */
  maxDrawdown: number;
}

/** buildFundMeta 入参 */
export interface FundMetaInput {
  /** 基金名，如「华夏成长混合」 */
  name: string;
  /** 基金代码，如「000001」；空串（404 兜底）时退化为只用名字 */
  code: string;
  /** 每期投入（分），与回测口径一致——文案里的金额必须与算的一致 */
  amountCents: number;
  /** 回测结果；期数不足时传 null，文案回落到通用版（不装作有回测） */
  backtest?: FundBacktestFacts | null;
}

/**
 * 金额（分）→ 文案里的「元」：整元不带小数（12000 元），有零头保留两位（13560.35 元）。
 * 刻意不加千分位——description 里逗号是噪音。
 */
function yuanText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : centsToYuan(cents);
}

/** 百分比：正数补 +，负数用 rateToPercent 自带的 -（0 不带符号） */
function signedPercent(rate: number): string {
  return `${rate > 0 ? "+" : ""}${rateToPercent(rate)}`;
}

/**
 * 基金详情页的 title / description。
 *
 * 为什么单独一个构造器：这一页是全站唯一能靠长尾词（「<基金名> 定投回测」
 * 「<代码> 定投收益」）拿曝光的地方，描述里必须带上算出来的真数字——
 * 每只基金的期数/市值/收益率都不同，才算「值得被收录的独有内容」
 * （2026-09-17 关键词方向的结论）。数字来自 runDcaBacktest，别手改文案里的口径。
 */
export function buildFundMeta(input: FundMetaInput): { title: string; description: string } {
  const { name, code, amountCents, backtest } = input;
  if (!code) {
    // 404 兜底：拿不到代码，拼不出与代码相关的文案
    return { title: name, description: DEFAULT_DESCRIPTION };
  }

  const prefix = `${name}（${code}）`;
  if (!backtest) {
    return {
      title: `${prefix}净值与费率`,
      description: `${prefix}的模拟盘档案：真实净值、费率与风险等级，可练申购与定投`,
    };
  }

  return {
    title: `${prefix}净值与定投回测`,
    description: `${prefix}定投回测：每月 ${yuanText(amountCents)} 元 × ${backtest.periods} 期，`
      + `累计投入 ${yuanText(backtest.investedCents)} 元、期末市值 ${yuanText(backtest.finalValueCents)} 元、`
      + `收益率 ${signedPercent(backtest.returnRate)}、最大回撤 ${rateToPercent(backtest.maxDrawdown)}`
      + `（含真实申购费，净值口径为累计净值）`,
  };
}

/** buildDcaBacktestMeta 入参 */
export interface DcaBacktestMetaInput {
  /** 基金名，如「华夏成长混合」 */
  name: string;
  /** 基金代码；空串 = 还没选基金（工具页首屏） */
  code: string;
  /** 每期投入（分），必须与回测用的金额一致——文案里的数字不能与算的对不上 */
  amountCents: number;
  /** 定投频率，默认按月；「每月/每周/每日」这个说法由 DCA_FREQUENCY_LABELS 统一给 */
  frequency?: DcaFrequency;
  /** 净值口径，默认 acc（累计净值）；描述里必须与页面实际用的口径一致 */
  adjust?: DcaAdjustMode;
  /** 回测结果；净值历史不足时传 null，文案回落到通用版（不装作有回测） */
  backtest?: FundBacktestFacts | null;
}

/**
 * `/tools/dca-backtest` 的 title / description。
 *
 * 与基金页的 buildFundMeta 分开写：那一页的标题是「净值与定投回测」，
 * 这一页是**工具页**，关键词落在「定投回测」本身（页面能被分享、被收藏，
 * 还带 ?code= 指向别的基金），所以有标的时标题用「<基金名>（代码）定投回测」，
 * 描述带上算出来的真数字；没选标的时回落成工具页的通用文案。
 */
export function buildDcaBacktestMeta(input: DcaBacktestMetaInput): { title: string; description: string } {
  const { name, code, amountCents, frequency = "month", adjust = "acc", backtest } = input;
  if (!code || !name) {
    return {
      title: "基金定投回测",
      description: "按真实历史净值算基金定投回测：累计投入、期末市值、年化收益、最大回撤与逐期明细，"
        + "每期金额、频率（按月/按周/按天）与期数都可调，申购费按站内真实撮合的内扣法计，"
        + "并与同期一次性买入对照",
    };
  }

  const prefix = `${name}（${code}）`;
  if (!backtest) {
    // 净值历史不足 3 期：不装作有回测，改为引导换一只（空数字比没有更糟）
    return {
      title: `${prefix}定投回测`,
      description: `${prefix}的净值历史还不足 3 期，暂时算不出定投回测。可换一只成立更久的基金，`
        + "或用真实费率试算申购与赎回费用",
    };
  }

  // 口径必须与页面实际算的一致：?adjust=unit 时还写「累计净值」就是给搜索引擎
  // 喂错的口径（CodeRabbit 评审 #3）
  const navLabel = adjust === "unit" ? "单位净值（分红不参与再投）" : "累计净值（分红再投）";
  return {
    title: `${prefix}定投回测`,
    description: `${prefix}定投回测：${DCA_FREQUENCY_LABELS[frequency]} ${yuanText(amountCents)} 元 × ${backtest.periods} 期，`
      + `累计投入 ${yuanText(backtest.investedCents)} 元、期末市值 ${yuanText(backtest.finalValueCents)} 元、`
      + `收益率 ${signedPercent(backtest.returnRate)}、最大回撤 ${rateToPercent(backtest.maxDrawdown)}`
      + `（含真实申购费，净值口径：${navLabel}）`,
  };
}

/**
 * `/plan`（低估指数定投计划）的 title / description。
 *
 * 标题刻意**不带期号**：这一页每周都更新，标题跟着churn对搜索引擎没有好处
 * （爬虫每次抓到不同的 title，反而像两页）。要新鲜的证据放 description——
 * 期日、品种数、买入总额都是真的，且每周自动变，正是「定期更新的独有内容」
 * 该有的样子。
 *
 * 主理人一期都没发过车时回落通用版：不装作有计划，也不给爬虫一个「有标题没内容」的页。
 */
export function buildPlanMeta(input: PlanMetaInput): { title: string; description: string } {
  const { period, fundCount, totalCents } = input;
  const title = "低估指数定投计划";
  if (!period || fundCount <= 0) {
    return {
      title,
      description: "主理人的低估指数定投实盘：每周二买入处于低估阶段的宽基、策略与行业指数基金，"
        + "逐期公开品种与金额，并可按自己的跟投比例换算出本期该投多少；附指数基金投资理念",
    };
  }
  return {
    title,
    description: `主理人 ${period} 这一期买入 ${fundCount} 只低估指数基金、合计 ${yuanText(totalCents)} 元，`
      + "品种与金额逐期公开；可按自己的跟投比例一键换算出本期定投金额，"
      + "附「定投品种 / 基金选择 / 定投方法」的投资理念说明",
  };
}

/** `buildPlanMeta` 的入参：本期事实。全来自真实订单，别手改文案里的数字 */
export interface PlanMetaInput {
  /** 本期日期（周二 YYYY-MM-DD）；主理人一期都没发过车时传 null */
  period: string | null;
  /** 本期品种数 */
  fundCount: number;
  /** 主理人本期买入总额（分） */
  totalCents: number;
}

/**
 * JSON-LD 值类型（与 React Router 的 LdJsonValue 同形）。
 * 刻意在 domain 里自己定义一份：domain 层不依赖框架类型。
 */
export type LdJsonValue
  = | string
    | number
    | boolean
    | null
    | LdJsonValue[]
    | { [key: string]: LdJsonValue };

/**
 * 基金详情页的面包屑结构化数据（BreadcrumbList）。
 *
 * 价值不在"多一个富结果"，而在让搜索引擎明确这一页的层级
 * （首页 › 基金 › 该基金）——搜索结果里 URL 那一行会显示层级路径，
 * 比裸 URL 更容易被点。层级用的是真实存在的页（`/`、`/funds`），
 * 别造中间层，不然结构化数据与站内结构对不上。
 */
export function buildFundBreadcrumbJsonLd(input: {
  name: string;
  code: string;
}): { [key: string]: LdJsonValue } {
  const items = [
    { name: "首页", path: "/" },
    { name: "基金", path: "/funds" },
    { name: `${input.name}（${input.code}）`, path: `/funds/${input.code}` },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((it, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": it.name,
      "item": canonicalUrl(it.path),
    })),
  };
}

/**
 * 首页 JSON-LD（WebApplication）。
 * 返回已序列化的 JSON 字符串，路由侧塞进 <script type="application/ld+json">。
 */
export function buildJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": SITE_NAME,
    "url": canonicalUrl("/"),
    "description": DEFAULT_DESCRIPTION,
    "applicationCategory": "FinanceApplication",
    "inLanguage": "zh-CN",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "CNY",
    },
  });
}
