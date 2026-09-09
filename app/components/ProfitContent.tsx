import type { ProfitDetailView } from "~/services/asset-service";
import { Typography } from "antd";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { ProfitCalendarCard } from "~/components/ProfitCalendarCard";
import { EmptyState } from "~/components/ui/EmptyState";

const { Paragraph } = Typography;

export interface ProfitContentProps {
  /** 全量收益明细（getProfitDetail 的产物：逐日序列 + 各基金归因） */
  detail: ProfitDetailView;
}

/**
 * 收益明细内容体：资产走势图 + 收益日历（2026-09-09 随 DCA 同款手法收拢）。
 *
 * 两个消费方一份真相：/me 的「收益明细」tab（MeTabsPanels.ProfitPanel
 * 懒加载 /me/profit 的 loader）、/me/profit 深链页（自带 loader）。
 * 口径（spec §2/§8）：累计收益 = Σ dayPnl，含已实现盈亏与全部费用、
 * 剔除净入金——与资产走势曲线、收益日历逐日同口径。
 *
 * 摘要两格（单日/累计收益）已删（2026-09-09 主理人定夺）：/me tab 里
 * 与顶部 AssetOverviewCard 四小格重复；曲线末点恒等于累计收益、
 * tooltip 悬停可见单日，两格信息曲线全都有。
 */
export function ProfitContent({ detail }: ProfitContentProps) {
  const { daily } = detail;

  if (daily.length === 0) {
    return <EmptyState description="买入第一只基金后，这里会展示每日收益" />;
  }

  return (
    <div>
      <AssetTrendChart data={daily} />
      <div className="mt-6" />
      <ProfitCalendarCard detail={detail} />
      <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
        点击日期切换查看当日各基金收益明细
      </Paragraph>
    </div>
  );
}
