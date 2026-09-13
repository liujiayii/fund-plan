/**
 * SEO 基建（纯函数，不依赖 Fetch / D1）。
 *
 * 搜索引擎要的三件事：
 *   1. robots.txt 告诉爬虫能抓什么、sitemap 在哪
 *   2. sitemap.xml 给出公开页清单（绝对 URL）
 *   3. 每页的 title / description / canonical / OG；私页加 noindex
 *
 * 域名钉死主站 `liujiayii.dpdns.org`。备用域 `liujiayi.dpdns.org` 不进
 * canonical / sitemap / robots——双域名互抢权重，搜索引擎会把它们当两站。
 */

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
  "/leaderboard",
  "/funds",
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
 * 生成 sitemap.xml。
 * `fundCodes` 是库里已落档的基金代码；非法（非 6 位数字）一律丢弃。
 */
export function buildSitemapXml(fundCodes: readonly string[]): string {
  const urls: string[] = SITEMAP_STATIC_PATHS.map(p => canonicalUrl(p));
  for (const code of fundCodes) {
    if (FUND_CODE_RE.test(code))
      urls.push(canonicalUrl(`/funds/${code}`));
  }
  const urlTags = urls.map(loc =>
    `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n  </url>`,
  ).join("\n");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
    urlTags,
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
