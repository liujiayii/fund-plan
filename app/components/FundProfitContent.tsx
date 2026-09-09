import type { FundProfitDetailView } from "~/services/asset-service";
import { FundPnlChart } from "~/components/FundPnlChart";
import { FUND_RATE_TIERS, ProfitCalendar } from "~/components/ProfitCalendar";
import { EmptyState } from "~/components/ui/EmptyState";

export interface FundProfitContentProps {
  /** 单基金收益明细（getFundProfitDetail 的产物：逐日收益 + 累计盈亏序列） */
  detail: FundProfitDetailView;
}

/**
 * 单基金收益明细内容体：累计盈亏曲线（近 1 月 / 持有以来）+ 单基金收益日历。
 *
 * 消费方：/me/holdings/:code 的「收益明细」tab。数据由宿主页 loader 的
 * getFundProfitDetail 直接传入（复用同一份全量重放，不再另发请求），
 * 口径与页面顶部「昨日收益」严格同源——含已实现盈亏与全部费用。
 *
 * 摘要两格（单日收益/累计盈亏）已删（2026-09-09 主理人定夺）：单日收益与
 * 持仓总览的「昨日收益」重复，「自 X 持有以来」标注挪去了持仓总览；
 * 日历下方点击日期的当日明细区一并删除——格子里的金额已够读。
 *
 * 与全局版 ProfitContent（/me tab、/me/profit 深链页）刻意分开：
 * 两边数据形状与语义都不同（单基金 vs 全组合），共用只会互相凑合。
 */
export function FundProfitContent({ detail }: FundProfitContentProps) {
  const { dailyPnl, cumulative } = detail;

  if (dailyPnl.length === 0) {
    return <EmptyState description="该基金暂无收益数据" />;
  }

  return (
    <div>
      {/* 累计盈亏曲线：近 1 月 / 持有以来，窗口只裁剪显示范围不重置基准 */}
      <FundPnlChart cumulative={cumulative} />
      <div className="mt-6" />

      {/* 单基金收益日历：dailyPnl 的 dayNavRate 就是该基金当日涨跌幅，
          映射成日历要的 dayPnlRate 形状后直喂。
          rateTiers 用单基金分档：基金净值单日波动天然比全组合大，套全组合
          阈值会把日历染得太深、文字看不清（2026-09-09 主理人反馈） */}
      <ProfitCalendar
        data={dailyPnl.map(d => ({
          date: d.date,
          dayPnlCents: d.dayPnlCents,
          dayPnlRate: d.dayNavRate,
        }))}
        rateTiers={FUND_RATE_TIERS}
      />
    </div>
  );
}
