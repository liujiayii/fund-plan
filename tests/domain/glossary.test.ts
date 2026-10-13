import { describe, expect, it } from "vitest";
import {
  getTermBySlug,
  GLOSSARY_CATEGORIES,
  GLOSSARY_TERMS,
  listTermsByCategory,
  searchTerms,
} from "~/domain/glossary";

/**
 * 词典数据守卫:slug 唯一、必填非空、related 无死链、分类合法、
 * 搜索命中。数据是手写的,靠测试钉住这些不变量,谁改坏谁红。
 */

const CATEGORY_KEYS = GLOSSARY_CATEGORIES.map(c => c.key);

describe("词典数据不变量", () => {
  it("词条数量足够(≥ 55 条,防止误删整段)", () => {
    expect(GLOSSARY_TERMS.length).toBeGreaterThanOrEqual(55);
  });

  it("slug 全局唯一且非空", () => {
    const slugs = GLOSSARY_TERMS.map(t => t.slug);
    expect(slugs.every(s => s.length > 0)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slug 是 kebab-case 英文/缩写(URL 安全)", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(t.slug, t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("必填字段非空(name / oneLiner / definition)", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(t.name.trim().length, `${t.slug}.name`).toBeGreaterThan(0);
      expect(t.oneLiner.trim().length, `${t.slug}.oneLiner`).toBeGreaterThan(0);
      expect(t.definition.trim().length, `${t.slug}.definition`).toBeGreaterThan(0);
    }
  });

  it("category 合法(∈ 五类)", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(CATEGORY_KEYS, t.slug).toContain(t.category);
    }
  });

  it("related 引用的 slug 全部真实存在(无死链)", () => {
    const slugs = new Set(GLOSSARY_TERMS.map(t => t.slug));
    for (const t of GLOSSARY_TERMS) {
      for (const rel of t.related ?? []) {
        expect(slugs.has(rel), `${t.slug} → ${rel}`).toBe(true);
      }
    }
  });

  it("每个分类至少 1 条词条", () => {
    for (const c of GLOSSARY_CATEGORIES) {
      expect(listTermsByCategory(c.key).length, c.key).toBeGreaterThan(0);
    }
  });
});

describe("getTermBySlug", () => {
  it("命中返回词条,落空返回 undefined", () => {
    expect(getTermBySlug("pe")?.name).toBe("市盈率");
    expect(getTermBySlug("no-such-term")).toBeUndefined();
  });
});

describe("searchTerms", () => {
  it("按名称中文命中", () => {
    expect(searchTerms("市盈率").some(t => t.slug === "pe")).toBe(true);
  });

  it("按缩写命中且大小写无关", () => {
    expect(searchTerms("roe").some(t => t.slug === "roe")).toBe(true);
    expect(searchTerms("ROE").some(t => t.slug === "roe")).toBe(true);
  });

  it("空串返回全部", () => {
    expect(searchTerms("").length).toBe(GLOSSARY_TERMS.length);
    expect(searchTerms("   ").length).toBe(GLOSSARY_TERMS.length);
  });

  it("无命中返回空数组", () => {
    expect(searchTerms("zzzz不存在zzzz")).toEqual([]);
  });
});
