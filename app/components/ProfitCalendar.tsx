import type { DailyAsset } from "~/domain/asset-timeline";
import { Button } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { EmptyState } from "~/components/ui/EmptyState";
import { COLOR, NUM_FONT, pnlColor } from "~/theme";

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 表头：周一始，国内日历习惯 */
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/**
 * 收益率绝对值 → 背景色透明度分档（hex8 后缀）。
 *
 * 4 档阈值（从强到弱）：
 *   ≥1.5%  → B3（约 70% 不透明）——大涨/大跌，最深
 *   ≥0.8%  → 80（约 50% 不透明）
 *   ≥0.3%  → 4D（约 30% 不透明）
 *   >0     → 28（约 16% 不透明）——微涨/微跌，最浅
 *
 * 拼法：`${COLOR.up}B3` → `#F5222DB3`，基色来自 COLOR，不写色值字面量。
 */
const RATE_TIERS = [
  { threshold: 0.015, alpha: "B3" },
  { threshold: 0.008, alpha: "80" },
  { threshold: 0.003, alpha: "4D" },
  { threshold: 0, alpha: "28" },
] as const;

/** 无数据 / 中性（收益为 0）格子的透明度 */
const NEUTRAL_ALPHA = "1A"; // ~10%，极浅灰底

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/**
 * 按 |dayPnlRate| 绝对值选出透明度后缀。
 * dayPnlCents > 0 时 base 取 COLOR.up，< 0 取 COLOR.down；
 * 返回拼好的 hex8 色串（如 `#F5222D80`）。
 */
function cellBgColor(dayPnlCents: number, dayPnlRate: number): string {
  const base = pnlColor(dayPnlCents); // up / down / neutral
  if (dayPnlCents === 0) {
    return `${COLOR.neutral}${NEUTRAL_ALPHA}`;
  }
  const absRate = Math.abs(dayPnlRate);
  // 从强档往弱档找，命中即停
  for (const tier of RATE_TIERS) {
    if (absRate >= tier.threshold) {
      return `${base}${tier.alpha}`;
    }
  }
  // 理论不可达（threshold=0 兜底），保险回退
  return `${base}${RATE_TIERS[3]!.alpha}`;
}

/**
 * 格内收益金额的简短展示。
 *
 * fmtYuan 会输出带千分位的完整金额（如 "+1,234.56"），在 40px 宽的格子里
 * 很容易溢出。收益日历的信息密度优先级是「色块深浅 > 有无数据 > 数字」，
 * 所以只取整数元部分 + 正负号，如 "+1234"、"-56"。
 * 损失的小数部分（几毛几分）在日历视图里无阅读价值。
 */
function fmtPnlShort(cents: number): string {
  const yuan = Math.trunc(cents / 100);
  const sign = yuan > 0 ? "+" : "";
  return `${sign}${yuan}`;
}

// ─────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────

export function ProfitCalendar({ data }: { data: DailyAsset[] }) {
  // 空数据直接走空态
  if (data.length === 0) {
    return <EmptyState description="暂无收益日历" />;
  }

  // ── 从 data 派生初始月与数据末月，不用 new Date() / dayjs() 无参 ──
  // SSR 安全：服务端/客户端时区不同不会导致 hydration 不一致
  const lastDataMonth = data[data.length - 1]!.date.slice(0, 7);

  return <ProfitCalendarInner data={data} lastDataMonth={lastDataMonth} />;
}

/**
 * 内层组件：data 非空时才挂，让 useState 的初始值可以安全取 lastDataMonth。
 * 拆出来避免条件 hook（ProfitCalendar 提前 return 时 useState 不执行）。
 */
function ProfitCalendarInner({
  data,
  lastDataMonth,
}: {
  data: DailyAsset[];
  lastDataMonth: string;
}) {
  // currentMonth 状态：初始值从 data 派生，SSR 安全
  const [currentMonth, setCurrentMonth] = useState(lastDataMonth);

  // O(1) 查表：日期串 → 当日资产数据（data 不变时 Map 只建一次）
  const lookup = useMemo(() => {
    const m = new Map<string, DailyAsset>();
    for (const d of data) {
      m.set(d.date, d);
    }
    return m;
  }, [data]);

  // ── 月算术：全部从 currentMonth 串派生，确定性，SSR 安全 ──
  const firstDay = dayjs(`${currentMonth}-01`);
  const daysInMonth = firstDay.daysInMonth();
  // dayjs .day()：0=周日 1=周一 … 6=周六 → 转成周一始偏移
  const w = firstDay.day();
  const startOffset = w === 0 ? 6 : w - 1;

  // 月导航
  const prevMonth = dayjs(`${currentMonth}-01`).subtract(1, "month").format("YYYY-MM");
  const nextMonth = dayjs(`${currentMonth}-01`).add(1, "month").format("YYYY-MM");
  const nextDisabled = currentMonth >= lastDataMonth;

  return (
    <div>
      {/* 月导航头 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Button size="small" onClick={() => setCurrentMonth(prevMonth)}>
          ‹
        </Button>
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          {currentMonth}
        </span>
        <Button size="small" disabled={nextDisabled} onClick={() => setCurrentMonth(nextMonth)}>
          ›
        </Button>
      </div>

      {/* 日历网格：7 列，周一始 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {/* 表头：一二三四五六日 */}
        {WEEKDAY_LABELS.map(label => (
          <div
            key={label}
            style={{
              textAlign: "center",
              fontSize: 12,
              color: COLOR.textSecondary,
              padding: "4px 0",
            }}
          >
            {label}
          </div>
        ))}

        {/* 月初空位 */}
        {Array.from({ length: startOffset }, (_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* 日期格 */}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${currentMonth}-${String(day).padStart(2, "0")}`;
          const d = lookup.get(dateStr);
          const hasData = d !== undefined;

          // 格子背景色
          const bg = hasData
            ? cellBgColor(d.dayPnlCents, d.dayPnlRate)
            : `${COLOR.neutral}${NEUTRAL_ALPHA}`;

          // 收益金额颜色：走 pnlColor（与背景同色系，但用实色保证可读）
          const pnlFg = hasData && d.dayPnlCents !== 0
            ? pnlColor(d.dayPnlCents)
            : undefined;

          return (
            <div
              key={day}
              style={{
                position: "relative",
                background: bg,
                borderRadius: 6,
                minHeight: 44,
                padding: "4px 6px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              {/* 日号：右上角小字 */}
              <div
                style={{
                  textAlign: "right",
                  fontSize: 11,
                  color: hasData ? COLOR.textPrimary : COLOR.textSecondary,
                  lineHeight: 1,
                }}
              >
                {day}
              </div>
              {/* 收益金额：有数据且非零时显示 */}
              {hasData && d!.dayPnlCents !== 0 && (
                <div
                  style={{
                    fontFamily: NUM_FONT,
                    fontSize: 11,
                    color: pnlFg,
                    textAlign: "center",
                    lineHeight: 1.2,
                    // 超长数字（如 ±9999）允许缩小或截断
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtPnlShort(d!.dayPnlCents)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
