import type { DailyAsset } from "~/domain/asset-timeline";
import type { FundDayPnl } from "~/domain/fund-pnl";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { StatBig } from "~/components/ui/StatBig";
import { COLOR, NUM_FONT, pnlColor } from "~/theme";

export interface DailyPnlDetailProps {
  /** 选中的日期串（YYYY-MM-DD），标题用 */
  date: string;
  /** 当日快照；理论上选中日必有（clickable 已限定 hasData），null 是防御 */
  day: DailyAsset | null;
  /** 当日各基金收益（原样传入，组件内按收益降序排） */
  entries: FundDayPnl[];
  /** fundCode → 基金名（含已清仓基金的历史条目） */
  fundNames: Record<string, string>;
}

/** 盈亏金额带符号：负号 fmtYuan 自带，正数补 +（与 AssetOverviewCard 同款手法） */
function signedYuan(cents: number): string {
  return `${cents > 0 ? "+" : ""}${fmtYuan(cents)}`;
}

/** 日期串 → 「9 月 5 日」（去前导零，与 AssetOverviewCard 同款手法） */
function fmtDateLabel(date: string): string {
  return `${String(Number(date.slice(5, 7)))} 月 ${String(Number(date.slice(8, 10)))} 日`;
}

/**
 * 某一天的收益明细（固定展示区，取代旧弹窗）：合计 + 各基金贡献。
 * 内容与交互原样来自 me.profit 旧 Modal——搬家不是重设计（ux-polish spec §4④）。
 */
export function DailyPnlDetail({ date, day, entries, fundNames }: DailyPnlDetailProps) {
  // 按当日收益降序：赚得最多的排最前，一眼看到「今天谁在出力」
  const sorted = [...entries].sort((a, b) => b.dayPnlCents - a.dayPnlCents);

  return (
    <div>
      <StatBig
        label={`${fmtDateLabel(date)} 收益`}
        value={day ? signedYuan(day.dayPnlCents) : "—"}
        suffix={day ? "元" : undefined}
        color={day ? pnlColor(day.dayPnlCents) : undefined}
        extra={day ? `收益率 ${day.dayPnlRate > 0 ? "+" : ""}${(day.dayPnlRate * 100).toFixed(2)}%` : undefined}
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
                    style={{
                      fontFamily: NUM_FONT,
                      fontSize: 16,
                      color: pnlColor(f.dayPnlCents),
                    }}
                  >
                    {signedYuan(f.dayPnlCents)}
                    <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元</span>
                  </span>
                )}
                secondary={<PnlText rate={f.dayNavRate} size={12} />}
              />
            ))}
      </div>
    </div>
  );
}
