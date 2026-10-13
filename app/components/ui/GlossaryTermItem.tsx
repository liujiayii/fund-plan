import type { GlossaryTerm } from "~/domain/glossary";

export interface GlossaryTermItemProps {
  term: GlossaryTerm;
  /** 点击 → 由宿主打开词条弹窗 */
  onClick: () => void;
}

/**
 * 词典网格里的一格(内井格,非玻璃——「一卡多格」纪律见 liquid-glass.md §4)。
 * 上:术语名 + 缩写;下:一句话记忆(最多两行,省略)。
 *
 * 刻意是 <button> 而非 <a>:索引页点它开弹窗原地看,不跳页。
 */
export function GlossaryTermItem({ term, onClick }: GlossaryTermItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex cursor-pointer flex-col rounded-xl border-0 bg-well p-3 text-left outline-none transition-colors duration-[150ms] hover:bg-primary-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="flex w-full items-baseline gap-2">
        <span className="text-[15px] font-medium text-ink group-hover:text-primary">{term.name}</span>
        {term.abbr ? <span className="font-num text-[11px] text-tertiary">{term.abbr}</span> : null}
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-muted">{term.oneLiner}</div>
    </button>
  );
}
