import type { ProfitDetailView } from "~/services/asset-service";
import { useState } from "react";
import { DailyPnlDetail } from "~/components/DailyPnlDetail";
import { ProfitCalendar } from "~/components/ProfitCalendar";
import { EmptyState } from "~/components/ui/EmptyState";
import { COLOR } from "~/theme";

/**
 * 收益日历 + 当日明细的组合壳（ux-polish spec §4④）。
 *
 * 「最新的有收益的日期」口径：daily 里最后一个 dayPnlCents ≠ 0 的日子
 * （用户视角「有收益」= 收益非零，纯现金/零收益日跳过）；全零回落最新快照日。
 * 点击日历其他有数据的日期切换明细——弹窗退役，明细常驻卡内。
 *
 * 消费方：/me/profit、/master、/admin/users/:id（三处同构）；
 * 首页只要日历不要明细，直接用裸 ProfitCalendar。
 */
export function ProfitCalendarCard({ detail }: { detail: ProfitDetailView }) {
  const { daily, fundPnlByDate, fundNames } = detail;
  // null = 尚未点过，展示默认日（最新非零收益日）
  const [picked, setPicked] = useState<string | null>(null);

  // 空 daily 防御：调用方理论上都有门，但组件自己兜住（与 ProfitCalendar 空态同款文案）
  if (daily.length === 0) {
    return <EmptyState description="暂无收益日历" />;
  }

  // 倒序找最后一个非零收益日；全零回落末位快照。daily 非空由上方早退兜底
  let defaultDate = daily[daily.length - 1]!.date;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i]!.dayPnlCents !== 0) {
      defaultDate = daily[i]!.date;
      break;
    }
  }
  const activeDate = picked ?? defaultDate;
  const activeDay = daily.find(d => d.date === activeDate) ?? null;

  return (
    <div>
      <ProfitCalendar data={daily} selectedDate={activeDate} onPickDate={setPicked} />
      {/* 分割线：日历网格与明细区的视觉分界 */}
      <div style={{ borderTop: `1px solid ${COLOR.border}`, margin: "16px 0" }} />
      <DailyPnlDetail
        date={activeDate}
        day={activeDay}
        entries={fundPnlByDate[activeDate] ?? []}
        fundNames={fundNames}
      />
    </div>
  );
}
