import type { Route } from "./+types/glossary._index";
import type { GlossaryCategory } from "~/domain/glossary";
import { Input, Typography } from "antd";
import { useState } from "react";
import { GlossaryModal } from "~/components/GlossaryModal";
import { GlossaryTermItem } from "~/components/ui/GlossaryTermItem";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import {
  getTermBySlug,
  GLOSSARY_CATEGORIES,
  GLOSSARY_TERMS,
} from "~/domain/glossary";
import { pageMeta } from "~/domain/seo";

const { Title, Paragraph, Text } = Typography;

/** 分类筛选的键:全部 + 五类 */
type FilterKey = "all" | GlossaryCategory;

export function meta(_: Route.MetaArgs) {
  return pageMeta({
    title: "基金词典",
    description:
      "基金专有名词速查:估值财务(PE/PB/ROE)、指数策略(宽基/红利/低波)、基金类型(ETF/LOF/QDII)、交易费用(申购赎回/费率)、风险收益(回撤/夏普/波动率),人话解释 + 公式 + 例子。",
    path: "/glossary",
  });
}

/** 分类筛选胶囊:全部在前,其余按 GLOSSARY_CATEGORIES 顺序 */
const FILTER_CHIPS: readonly { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  ...GLOSSARY_CATEGORIES.map(c => ({ key: c.key as FilterKey, label: c.label })),
];

/**
 * 基金词典首页(公开页,/glossary)。
 *
 * 数据是 domain 常量(90+ 条),SSR 全量进 HTML,爬虫不跑 JS 也能读;
 * 搜索与分类筛选都是纯客户端过滤,无需 loader、无需 D1。
 *
 * 版式(2026-10-13 重做):一张玻璃壳装「搜索 + 分类胶囊」,另一张装词条网格——
 * 取代原先五张卡各堆一列长列表(信息堆满、无重点)。词条是内井格而非独立玻璃,
 * 守「一卡多格」的玻璃节点预算(见 docs/liquid-glass.md §4)。
 *
 * 点词条不跳页:居中弹窗原地看定义,弹窗里顺着「相关词条」继续点
 * (主人 2026-10-13:「详情别跳页,效率太低」)。
 */
export default function GlossaryIndex(_: Route.ComponentProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  // 当前弹窗里展示的 slug;null = 弹窗关闭
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const keyword = query.trim().toLowerCase();
  // 关键词优先(跨分类),否则按分类筛选;「全部」= 不过滤
  const terms = GLOSSARY_TERMS.filter((t) => {
    if (keyword) {
      const hay = [t.name, t.abbr ?? "", t.slug, ...(t.aliases ?? [])].join(" ").toLowerCase();
      return hay.includes(keyword);
    }
    return filter === "all" || t.category === filter;
  });

  /** 各筛选键下的词条数(「全部」= 总数) */
  const countOf = (key: FilterKey): number =>
    key === "all" ? GLOSSARY_TERMS.length : GLOSSARY_TERMS.filter(t => t.category === key).length;

  const openTerm = openSlug ? getTermBySlug(openSlug) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      {/* 身份块:标题 × 数量,出卡直接压在色雾上(与 /funds 页头同手法) */}
      <div className="animate-fade-up">
        <Title level={3} className="mb-1">
          基金词典
          <Text type="secondary" className="ml-2 align-middle font-num text-[15px]">
            {GLOSSARY_TERMS.length}
            {" "}
            条
          </Text>
        </Title>
        <Paragraph type="secondary" className="mb-0">
          基金专有名词速查。点词条原地看解释、公式与例子,顺着相关词条继续读。
        </Paragraph>
      </div>

      {/* 一张玻璃壳装搜索 + 分类胶囊(filter,不占词条网格的卡) */}
      <SectionCard className="animate-fade-up animate-delay-[60ms]">
        <Input.Search
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜术语名、缩写或别名,如 市盈率 / PE / ROE"
          allowClear
          size="large"
        />
        {/* 关键词搜索时隐藏分类胶囊,避免两套筛选同时生效的歧义 */}
        {keyword
          ? null
          : (
              <div className="fp-h-scroll mt-3 flex gap-2 pb-1">
                {FILTER_CHIPS.map((chip) => {
                  const active = filter === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => setFilter(chip.key)}
                      className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full border-0 px-3 py-1.5 text-[13px] transition-colors duration-[150ms] ${
                        active
                          ? "bg-primary-bg text-primary"
                          : "bg-well text-muted hover:text-ink"
                      }`}
                    >
                      {chip.label}
                      <span className="ml-1 font-num text-[11px] opacity-70">{countOf(chip.key)}</span>
                    </button>
                  );
                })}
              </div>
            )}
      </SectionCard>

      {/* 一张玻璃壳装词条网格(内井格) */}
      <SectionCard
        title={keyword ? `「${query.trim()}」的搜索结果` : "词条"}
        extra={(
          <span className="font-num text-[12px] text-muted">
            {terms.length}
            {" "}
            条
          </span>
        )}
        className="animate-fade-up animate-delay-[120ms]"
      >
        {terms.length === 0
          ? <Paragraph type="secondary" className="mb-0">没找到相关词条,换个关键词试试。</Paragraph>
          : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {terms.map(t => (
                  <GlossaryTermItem key={t.slug} term={t} onClick={() => setOpenSlug(t.slug)} />
                ))}
              </div>
            )}
      </SectionCard>

      <SectionCard className="animate-fade-up animate-delay-[180ms]">
        <div className="flex flex-wrap gap-3">
          <NavButton to="/funds">去挑一只基金</NavButton>
          <NavButton to="/tools/fee-calculator">算算交易费用</NavButton>
          <NavButton to="/tools/dca-backtest">试算定投回测</NavButton>
        </div>
      </SectionCard>

      {/* 词条弹窗:点词条原地开,不跳页 */}
      <GlossaryModal
        term={openTerm}
        onClose={() => setOpenSlug(null)}
        onJump={setOpenSlug}
      />
    </div>
  );
}
