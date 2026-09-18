import type { PnlDimension } from "~/domain/pnl-buckets";
import type { ProfitDetailView } from "~/services/asset-service";
import { useMemo, useState } from "react";
import { DailyPnlDetail } from "~/components/DailyPnlDetail";
import { bucketTitleLabel, ProfitCalendar } from "~/components/ProfitCalendar";
import { EmptyState } from "~/components/ui/EmptyState";
import { aggregateFundPnlRange, bucketDailyPnl } from "~/domain/pnl-buckets";
import { COLOR } from "~/theme";

/**
 * 收益日历 + 区间明细的组合壳（ux-polish spec §4④；2026-09-18 加统计粒度）。
 *
 * 粒度（日 / 周 / 月 / 年）由本组件持有，而不是塞进日历内部：日历画格子、
 * 明细区读同一粒度下的区间合计，两边必须同一份状态（日历只画、明细只读，
 * 状态放在共同的父层）。
 *
 * 「默认选中」口径：当前粒度下**最后一个区间收益 ≠ 0 的桶**
 * （用户视角「有收益」= 收益非零，纯现金/零收益段跳过）；全零回落末位桶。
 * 切换粒度时旧 key 在新粒度下查不到（"日" 的 key 是 YYYY-MM-DD、"月" 是
 * YYYY-MM），这里自动回落到新粒度的默认桶——不需要 effect 去重置 picked。
 *
 * 消费方：/me/profit、/master、/admin/users/:id（三处同构，后两者经 ProfitContent）。
 */
export function ProfitCalendarCard({ detail }: { detail: ProfitDetailView }) {
  const { daily, fundPnlByDate, fundNames } = detail;
  const [dimension, setDimension] = useState<PnlDimension>("day");
  // null = 尚未点过，展示默认桶
  const [picked, setPicked] = useState<string | null>(null);

  // 逐日 → 当前粒度的桶（选中态与明细区都按桶算）
  const buckets = useMemo(() => bucketDailyPnl(daily, dimension), [daily, dimension]);

  // 空 daily 防御：调用方理论上都有门，但组件自己兜住（与 ProfitCalendar 空态同款文案）
  if (buckets.length === 0) {
    return <EmptyState description="暂无收益日历" />;
  }

  // 倒序找最后一个非零区间收益桶；全零回落末位桶
  let defaultKey = buckets[buckets.length - 1]!.key;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i]!.pnlCents !== 0) {
      defaultKey = buckets[i]!.key;
      break;
    }
  }
  // picked 可能属于上一个粒度（切换后失效），认不出就用默认桶
  const activeKey = picked && buckets.some(b => b.key === picked) ? picked : defaultKey;
  const activeBucket = buckets.find(b => b.key === activeKey)!;

  // 区间内各基金贡献：日粒度即当日条目原样，周/月/年为区间汇总
  const entries = aggregateFundPnlRange(fundPnlByDate, activeBucket.startDate, activeBucket.endDate);

  return (
    <div>
      <ProfitCalendar
        data={daily}
        dimension={dimension}
        onDimensionChange={setDimension}
        selectedKey={activeKey}
        onPickKey={setPicked}
      />
      {/* 分割线：日历网格与明细区的视觉分界 */}
      <div style={{ borderTop: `1px solid ${COLOR.border}`, margin: "16px 0" }} />
      <DailyPnlDetail
        label={bucketTitleLabel(activeKey, dimension)}
        day={{ dayPnlCents: activeBucket.pnlCents, dayPnlRate: activeBucket.pnlRate }}
        days={activeBucket.days}
        entries={entries}
        fundNames={fundNames}
      />
    </div>
  );
}
