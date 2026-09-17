import { describe, expect, it } from "vitest";
import {
  buildFundBreadcrumbJsonLd,
  buildFundMeta,
  buildJsonLd,
  buildRobotsTxt,
  buildSitemapXml,
  CANONICAL_ORIGIN,
  DEFAULT_OG_IMAGE,
  pageMeta,
  SITE_NAME,
} from "~/domain/seo";

/**
 * SEO 基建的钉子：canonical 域名、robots 白名单、sitemap 条目、
 * 公开页 OG / 私页 noindex。抓错域名或把 /me 放进 sitemap 就是脏索引。
 */

describe("SEO 常量", () => {
  it("canonical 钉死主站，不含尾斜杠", () => {
    expect(CANONICAL_ORIGIN).toBe("https://liujiayii.dpdns.org");
    expect(CANONICAL_ORIGIN.endsWith("/")).toBe(false);
  });

  it("站点名与默认 OG 图走主站绝对地址", () => {
    expect(SITE_NAME).toBe("模拟基金 · 定投系统");
    expect(DEFAULT_OG_IMAGE).toBe(`${CANONICAL_ORIGIN}/favicon.svg`);
  });
});

describe("buildRobotsTxt", () => {
  it("允许全站、指向主站 sitemap，并 Disallow 私页前缀", () => {
    const txt = buildRobotsTxt();
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://liujiayii.dpdns.org/sitemap.xml");
    // 登录后的盘、后台、登出、交易 action 都不该被爬
    expect(txt).toContain("Disallow: /me");
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /logout");
    expect(txt).toContain("Disallow: /me/trade");
  });

  it("robots 里出现的 URL 只有主站域名", () => {
    const hosts = [...buildRobotsTxt().matchAll(/https?:\/\/([^\s/]+)/g)].map(m => m[1]);
    expect(hosts).toEqual(["liujiayii.dpdns.org"]);
  });
});

describe("buildSitemapXml", () => {
  it("静态公开页按固定清单输出绝对 URL", () => {
    const xml = buildSitemapXml([]);
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("<urlset");
    for (const path of ["/", "/master", "/leaderboard", "/funds", "/tools/fee-calculator", "/login", "/register"]) {
      expect(xml).toContain(`<loc>https://liujiayii.dpdns.org${path === "/" ? "/" : path}</loc>`);
    }
    // 首页 loc 必须是 origin + "/"，不能丢斜杠也不能写成双斜杠
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/</loc>");
  });

  it("基金详情按代码追加，非法代码丢弃", () => {
    const xml = buildSitemapXml([
      { code: "000001" },
      { code: "bad" },
      { code: "110022" },
      { code: "" },
    ]);
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/funds/000001</loc>");
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/funds/110022</loc>");
    expect(xml).not.toContain("/funds/bad");
    expect(xml).not.toContain("/funds/<loc>");
  });

  it("基金页带 lastmod（自己的最新净值日期），静态页不带", () => {
    const xml = buildSitemapXml([
      { code: "000001", lastmod: "2026-09-16" },
      { code: "110022" },
    ]);
    // 基金页：loc 后紧跟 lastmod，成对出现
    expect(xml).toContain(
      "<loc>https://liujiayii.dpdns.org/funds/000001</loc>\n    <lastmod>2026-09-16</lastmod>",
    );
    // 没有净值行（lastmod 为 null/缺省）的基金只出 loc，绝不出空 lastmod
    expect(xml).not.toMatch(/<lastmod>\s*<\/lastmod>/);
    // 静态页不猜 lastmod：Google 明确表示不准确的 lastmod 会被忽略甚至反噬
    const staticBlock = xml.split("<loc>https://liujiayii.dpdns.org/</loc>")[1] ?? "";
    expect(staticBlock.slice(0, 40)).not.toContain("<lastmod>");
  });

  it("lastmod 格式不合法（脏数据）一律丢掉，不把 XML 弄废", () => {
    const xml = buildSitemapXml([
      { code: "000001", lastmod: "2026/09/16" },
      { code: "110022", lastmod: "</lastmod><script>" },
    ]);
    expect(xml).not.toContain("2026/09/16");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/funds/000001</loc>");
  });

  it("私页路径绝不能出现在 sitemap 里", () => {
    const xml = buildSitemapXml([{ code: "000001" }]);
    expect(xml).not.toContain("/me");
    expect(xml).not.toContain("/admin");
    expect(xml).not.toContain("/logout");
  });
});

describe("pageMeta", () => {
  it("公开页产出 title / description / canonical / og / twitter", () => {
    const tags = pageMeta({
      title: "收益排行榜",
      description: "全站模拟盘收益率榜",
      path: "/leaderboard",
    });
    expect(tags).toEqual(expect.arrayContaining([
      { title: "收益排行榜 · 模拟基金" },
      { name: "description", content: "全站模拟盘收益率榜" },
      { tagName: "link", rel: "canonical", href: "https://liujiayii.dpdns.org/leaderboard" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: "收益排行榜 · 模拟基金" },
      { property: "og:description", content: "全站模拟盘收益率榜" },
      { property: "og:url", content: "https://liujiayii.dpdns.org/leaderboard" },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { property: "og:locale", content: "zh_CN" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "收益排行榜 · 模拟基金" },
      { name: "twitter:description", content: "全站模拟盘收益率榜" },
    ]));
    expect(tags.some(t => "name" in t && t.name === "robots")).toBe(false);
  });

  it("首页 title 不加后缀，canonical 是 origin/", () => {
    const tags = pageMeta({
      title: SITE_NAME,
      description: "用真实基金数据玩模拟盘",
      path: "/",
      brandSuffix: false,
    });
    expect(tags).toEqual(expect.arrayContaining([
      { title: SITE_NAME },
      { tagName: "link", rel: "canonical", href: "https://liujiayii.dpdns.org/" },
      { property: "og:url", content: "https://liujiayii.dpdns.org/" },
    ]));
  });

  it("私页带 noindex, nofollow，不产出 og", () => {
    const tags = pageMeta({
      title: "我的仪表盘",
      path: "/me",
      index: false,
    });
    expect(tags).toEqual(expect.arrayContaining([
      { title: "我的仪表盘 · 模拟基金" },
      { name: "robots", content: "noindex, nofollow" },
    ]));
    expect(tags.some(t => "property" in t && t.property === "og:url")).toBe(false);
    expect(tags.some(t => "tagName" in t && t.tagName === "link")).toBe(false);
  });

  it("path 带查询串时 canonical 剥掉 query", () => {
    const tags = pageMeta({
      title: "发现基金",
      description: "搜索与排行榜",
      path: "/funds?type=hh",
    });
    const canonical = tags.find(t => "rel" in t && t.rel === "canonical");
    expect(canonical).toMatchObject({ href: "https://liujiayii.dpdns.org/funds" });
  });
});

describe("buildFundBreadcrumbJsonLd", () => {
  it("三级面包屑：首页 › 基金 › 该基金，item 全是主站绝对 URL", () => {
    const ld = buildFundBreadcrumbJsonLd({ name: "华夏成长混合", code: "000001" });
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", "position": 1, "name": "首页", "item": "https://liujiayii.dpdns.org/" },
      { "@type": "ListItem", "position": 2, "name": "基金", "item": "https://liujiayii.dpdns.org/funds" },
      {
        "@type": "ListItem",
        "position": 3,
        "name": "华夏成长混合（000001）",
        "item": "https://liujiayii.dpdns.org/funds/000001",
      },
    ]);
  });

  it("能直接 JSON.stringify 塞进 <script type=application/ld+json>", () => {
    const json = buildFundBreadcrumbJsonLd({ name: "易方达消费", code: "110022" });
    const parsed = JSON.parse(JSON.stringify(json));
    expect(parsed["@type"]).toBe("BreadcrumbList");
    expect(parsed.itemListElement).toHaveLength(3);
  });
});

describe("buildJsonLd", () => {
  it("首页 WebApplication JSON-LD 钉死主站 URL 与中文描述", () => {
    const json = JSON.parse(buildJsonLd());
    expect(json["@context"]).toBe("https://schema.org");
    expect(json["@type"]).toBe("WebApplication");
    expect(json.name).toBe(SITE_NAME);
    expect(json.url).toBe("https://liujiayii.dpdns.org/");
    expect(json.applicationCategory).toBe("FinanceApplication");
    expect(json.inLanguage).toBe("zh-CN");
    expect(typeof json.description).toBe("string");
    expect(json.description.length).toBeGreaterThan(10);
    expect(json.offers).toMatchObject({ "@type": "Offer", "price": "0", "priceCurrency": "CNY" });
  });
});

describe("buildFundMeta", () => {
  /** 一份手算过的回测事实：12000 投入 → 13560.35 市值、+13.00%、回撤 8.20% */
  const facts = {
    name: "华夏成长混合",
    code: "000001",
    amountCents: 100_000,
    backtest: {
      periods: 12,
      investedCents: 1_200_000,
      finalValueCents: 1_356_035,
      returnRate: 1300,
      maxDrawdown: 820,
    },
  };

  it("有回测时，title 带代码与「定投回测」，description 全是真数字", () => {
    const { title, description } = buildFundMeta(facts);
    expect(title).toBe("华夏成长混合（000001）净值与定投回测");
    // 关键词与数字都要在：这是基金页唯一的「独家内容」入口
    expect(description).toContain("华夏成长混合（000001）");
    expect(description).toContain("每月 1000 元 × 12 期");
    expect(description).toContain("累计投入 12000 元");
    expect(description).toContain("期末市值 13560.35 元");
    expect(description).toContain("收益率 +13.00%");
    expect(description).toContain("最大回撤 8.20%");
  });

  it("收益率为负时带负号（不带多余正号）", () => {
    const { description } = buildFundMeta({
      ...facts,
      backtest: { ...facts.backtest, returnRate: -432 },
    });
    expect(description).toContain("收益率 -4.32%");
  });

  it("期数不足（backtest 为 null）回落通用文案，且不提「定投回测」", () => {
    const { title, description } = buildFundMeta({ ...facts, backtest: null });
    expect(title).toBe("华夏成长混合（000001）净值与费率");
    expect(description).not.toContain("定投回测");
    expect(description).toContain("真实净值");
  });

  it("没有基金代码（404 兜底）时 title 退化为名字本身", () => {
    const { title } = buildFundMeta({ name: "基金详情", code: "", amountCents: 100_000 });
    expect(title).toBe("基金详情");
  });

  it("金额非整元时保留两位小数，不出现多余逗号", () => {
    const { description } = buildFundMeta({
      ...facts,
      amountCents: 100_050,
      backtest: { ...facts.backtest, investedCents: 1_200_600 },
    });
    expect(description).toContain("每月 1000.50 元");
    expect(description).toContain("累计投入 12006 元");
  });
});
