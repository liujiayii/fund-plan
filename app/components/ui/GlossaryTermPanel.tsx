import type { ReactNode } from "react";
import type { GlossaryTerm } from "~/domain/glossary";
import { Tag, Typography } from "antd";
import {
  getTermBySlug,
  GLOSSARY_CATEGORIES,
  listTermsByCategory,
} from "~/domain/glossary";

const { Title, Paragraph, Text } = Typography;

/** 分类 key → 中文名(从元数据查,不另写一份) */
export function categoryLabel(key: GlossaryTerm["category"]): string {
  return GLOSSARY_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

/**
 * 定义里的一段补充(公式 / 例子 / 注意)。内井格而非独立卡片。
 * tone="warn" 时用待办三语义色(「注意」里的坑值得一眼看到)。
 */
function Note({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "warn";
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-well p-3">
      <div className={`mb-1 text-[12px] font-medium ${tone === "warn" ? "text-pending" : "text-tertiary"}`}>
        {label}
      </div>
      <div className="text-[14px] leading-[1.6] text-ink">{children}</div>
    </div>
  );
}

export interface GlossaryTermPanelProps {
  term: GlossaryTerm;
  /** 点相关词条:原地切换成另一条词条(不跳页) */
  onJump: (slug: string) => void;
}

/**
 * 词条正文:定义 + 公式/例子/注意内井块 + 相关词条。
 * 由 GlossaryModal 渲染(2026-10-13:详情走居中弹窗,不再有独立页)。
 *
 * 外框(玻璃壳)不在这里——本组件只出内容,宿主决定皮。
 */
export function GlossaryTermPanel({ term, onJump }: GlossaryTermPanelProps) {
  const related = (term.related ?? [])
    .map(slug => getTermBySlug(slug))
    .filter((t): t is GlossaryTerm => Boolean(t));

  // 「同类其他词条」兜底:相关词一栏空了就退到同分类,保证弹窗里永远有下一站
  // (新手才不会「点进去发现没得继续点」)。相关词非空时不追加,避免一栏塞太多。
  const sameCategory = related.length > 0
    ? []
    : listTermsByCategory(term.category).filter(t => t.slug !== term.slug);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Title level={4} className="!mb-0">
            {term.name}
          </Title>
          {term.abbr ? <Text type="secondary" className="font-num text-[13px]">{term.abbr}</Text> : null}
          <Tag>{categoryLabel(term.category)}</Tag>
        </div>
        <Paragraph type="secondary" className="mb-0 mt-1">
          {term.oneLiner}
        </Paragraph>
      </div>

      <Paragraph className="!mb-0 text-[15px] leading-[1.7]">{term.definition}</Paragraph>

      {(term.formula || term.example || term.caveats)
        ? (
            <div className="grid gap-2">
              {term.formula ? <Note label="公式 / 口径">{term.formula}</Note> : null}
              {term.example ? <Note label="例子">{term.example}</Note> : null}
              {term.caveats ? <Note label="注意" tone="warn">{term.caveats}</Note> : null}
            </div>
          )
        : null}

      {related.length > 0
        ? (
            <div>
              <div className="mb-2 text-[13px] font-medium text-ink">相关词条</div>
              <div className="flex flex-wrap gap-2">
                {related.map(rel => <RelChip key={rel.slug} rel={rel} onJump={onJump} />)}
              </div>
            </div>
          )
        : null}

      {sameCategory.length > 0
        ? (
            <div>
              <div className="mb-2 text-[13px] font-medium text-ink">
                同类其他(
                {categoryLabel(term.category)}
                )
              </div>
              <div className="flex flex-wrap gap-2">
                {sameCategory.slice(0, 8).map(rel => <RelChip key={rel.slug} rel={rel} onJump={onJump} />)}
              </div>
            </div>
          )
        : null}
    </div>
  );
}

/** 相关词胶囊:点了原地换成该词条 */
function RelChip({ rel, onJump }: { rel: GlossaryTerm; onJump: (slug: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump(rel.slug)}
      className="cursor-pointer rounded-full border-0 bg-well px-3 py-1.5 text-[13px] text-muted no-underline transition-colors duration-[150ms] hover:bg-primary-bg hover:text-primary"
    >
      {rel.name}
    </button>
  );
}
