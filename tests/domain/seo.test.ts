import { describe, expect, it } from "vitest";
import {
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
  it("canonical 钉死主站，不含尾斜杠、不含备用域名", () => {
    expect(CANONICAL_ORIGIN).toBe("https://liujiayii.dpdns.org");
    expect(CANONICAL_ORIGIN.endsWith("/")).toBe(false);
    expect(CANONICAL_ORIGIN).not.toContain("liujiayi.dpdns.org");
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

  it("不把备用域名写进 robots", () => {
    expect(buildRobotsTxt()).not.toContain("liujiayi.dpdns.org");
  });
});

describe("buildSitemapXml", () => {
  it("静态公开页按固定清单输出绝对 URL", () => {
    const xml = buildSitemapXml([]);
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("<urlset");
    for (const path of ["/", "/master", "/leaderboard", "/funds", "/login", "/register"]) {
      expect(xml).toContain(`<loc>https://liujiayii.dpdns.org${path === "/" ? "/" : path}</loc>`);
    }
    // 首页 loc 必须是 origin + "/"，不能丢斜杠也不能写成双斜杠
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/</loc>");
  });

  it("基金详情按代码追加，非法代码丢弃", () => {
    const xml = buildSitemapXml(["000001", "bad", "110022", ""]);
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/funds/000001</loc>");
    expect(xml).toContain("<loc>https://liujiayii.dpdns.org/funds/110022</loc>");
    expect(xml).not.toContain("/funds/bad");
    expect(xml).not.toContain("/funds/<loc>");
  });

  it("私页路径绝不能出现在 sitemap 里", () => {
    const xml = buildSitemapXml(["000001"]);
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
