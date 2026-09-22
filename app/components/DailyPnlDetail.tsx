import type { DailyAsset } from "~/domain/asset-timeline";
import type { FundDayPnl } from "~/domain/fund-pnl";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtRate, fmtSignedYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlBadge } from "~/components/ui/PnlBadge";
import { PnlText } from "~/components/ui/PnlText";
import { StatBig } from "~/components/ui/StatBig";
import { COLOR, pnlColor } from "~/theme";

export interface DailyPnlDetailProps {
  /**
   * 区间标题（不含「收益」二字），由 ProfitCalendar 的 bucketTitleLabel 产出：
   * 「9 月 5 日」（日）/「9 月 14 日 – 9 月 20 日」（周）/「2026 年 9 月」（月）
   */
  label: string;
  /**
   * 区间快照；理论上选中格必有（clickable 已限定 hasData），null 是防御。
   * 字段收窄成 Pick：字段语义随粒度变——日粒度是当日收益与当日收益率，
   * 周/月/年粒度是区间合计收益与区间收益率（复利，见 domain/pnl-buckets）。
   * 总资产等组合字段对明细区没有意义，故不收
   */
  day: Pick<DailyAsset, "dayPnlCents" | "dayPnlRate"> | null;
  /** 区间合并的逐日条目数（>1 时在收益率旁标注，说明这是区间合计而非单日） */
  days?: number;
  /** 区间内各基金收益（原样传入，组件内按收益降序排） */
  entries: FundDayPnl[];
  /** fundCode → 基金名（含已清仓基金的历史条目） */
  fundNames: Record<string, string>;
}

/**
 * 某个区间的收益明细（固定展示区，取代旧弹窗）：合计 + 各基金贡献。
 * 内容与交互原样来自 me.profit 旧 Modal——搬家不是重设计（ux-polish spec §4④）；
 * 2026-09-18 起区间由调用方按粒度给出（周/月/年 = 区间合计）。
 */
export function DailyPnlDetail({ label, day, days, entries, fundNames }: DailyPnlDetailProps) {
  // 按当日收益降序：赚得最多的排最前，一眼看到「今天谁在出力」
  const sorted = [...entries].sort((a, b) => b.dayPnlCents - a.dayPnlCents);

  return (
    <div>
      {/* 当日金额走 PnlBadge 浅底胶囊（visual-refresh §6.5 强调位）：
          徽章自带「元」与红绿浅底，StatBig 的 suffix/color 不再传；日期标题与收益率副行保持原样。
          收益率的分母是「前一日总资产」，与总览卡「选基收益率」的「累计买入额」不同——
          周/月/年的区间收益率是复利连乘（见 domain/pnl-buckets），也别与日收益率混读 */}
      <StatBig
        label={`${label} 收益`}
        value={day ? <PnlBadge cents={day.dayPnlCents} /> : "—"}
        extra={day
          ? `收益率 ${fmtRate(day.dayPnlRate)}${
            days && days > 1 ? ` · ${days} 个交易日` : ""
          }`
          : undefined}
      />
      <div style={{ marginTop: 8 }}>
        {sorted.length === 0
          ? (
              <EmptyState description="当日无持仓收益变动" />
            )
          : sorted.map((f, i) => (
              <FundListItem
                key={f.fundCode}
                fundCode={f.fundCode}
                fundName={fundNames[f.fundCode] ?? f.fundCode}
                // 行链基金详情页：已清仓基金没有持仓详情页，/funds/:code 对两者都成立
                href={`/funds/${f.fundCode}`}
                last={i === sorted.length - 1}
                primary={(
                  <span
                    className="font-num"
                    style={{
                      fontSize: 16,
                      color: pnlColor(f.dayPnlCents),
                    }}
                  >
                    {fmtSignedYuan(f.dayPnlCents)}
                    <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元</span>
                  </span>
                )}
                // ⚠️ 右侧百分比必须带「净值涨跌」四个字。它是**这只基金自己的
                // 当日净值涨跌幅**（与你的仓位无关），不是「这笔持仓赚了 2%」——
                // 此前裸挂 PnlText，行内会出现「一只 +60 元/+2.00%、一只 +6 元/+2.00%」
                // 这种金额差 10 倍、百分比相同的排法，被读成收益率就是误导
                secondary={(
                  <span style={{ fontSize: 12, color: COLOR.textSecondary }}>
                    净值涨跌
                    {" "}
                    <PnlText rate={f.dayNavRate} size={12} />
                  </span>
                )}
              />
            ))}
      </div>
    </div>
  );
}
