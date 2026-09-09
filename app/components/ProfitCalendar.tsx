import type { DailyAsset } from "~/domain/asset-timeline";
import { Button } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { EmptyState } from "~/components/ui/EmptyState";
import { COLOR, NUM_FONT, pnlColor } from "~/theme";

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 表头：周日始 */
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 单档配置：|收益率| ≥ threshold 时取 alpha（hex8 后缀） */
interface RateTier {
  threshold: number;
  alpha: string;
}

/**
 * 全组合日历分档（/me、/me/profit、/master）。
 * 基金组合的单日波动天然被多只基金摊薄，阈值收得紧。
 */
const RATE_TIERS: readonly RateTier[] = [
  { threshold: 0.015, alpha: "B3" }, // ≥1.5%：最深
  { threshold: 0.008, alpha: "80" },
  { threshold: 0.003, alpha: "4D" },
  { threshold: 0, alpha: "28" }, // >0：最浅
] as const;

/**
 * 单基金日历分档（持仓页收益明细 tab）。基金净值单日 1%~2% 很常见，
 * 套全组合阈值满屏深色、文字看不清——阈值放宽一档（2026-09-09 主理人反馈）。
 * export：FundProfitContent 作为 rateTiers 传入
 */
export const FUND_RATE_TIERS: readonly RateTier[] = [
  { threshold: 0.03, alpha: "B3" }, // ≥3%：最深
  { threshold: 0.015, alpha: "80" },
  { threshold: 0.008, alpha: "4D" },
  { threshold: 0, alpha: "28" }, // >0：最浅
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
function cellBgColor(dayPnlCents: number, dayPnlRate: number, tiers: readonly RateTier[]): string {
  const base = pnlColor(dayPnlCents); // up / down / neutral
  if (dayPnlCents === 0) {
    return `${COLOR.neutral}${NEUTRAL_ALPHA}`;
  }
  const absRate = Math.abs(dayPnlRate);
  // 从强档往弱档找，命中即停
  for (const tier of tiers) {
    if (absRate >= tier.threshold) {
      return `${base}${tier.alpha}`;
    }
  }
  // 理论不可达（threshold=0 兜底），保险回退
  return `${base}${tiers[tiers.length - 1]!.alpha}`;
}

/**
 * 格内收益金额的简短展示：保留两位小数（与全站 fmtYuan 的分→元口径一致），
 * 如 "+11.40"、"-6.98"。
 *
 * 刻意不加千分位：日历格子要的是紧凑（"+1234.56" 而非 "+1,234.56"），
 * 桌面格子宽约 145px、NUM_FONT 等宽 11px，8 字符绰绰有余；
 * 移动端方形格子（10px）多数情况放得下，超长靠样式层 ellipsis 截断。
 *
 * 整数拼法零浮点：元整数部分与小数两位分别取，不经 cents/100 除法。
 */
function fmtPnlShort(cents: number): string {
  const sign = cents > 0 ? "+" : "-";
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return `${sign}${yuan}.${String(fen).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────

export function ProfitCalendar({
  data,
  onPickDate,
  selectedDate,
  rateTiers = RATE_TIERS,
}: {
  /**
   * 逐日快照。字段收窄成 Pick：全局口径喂 DailyAsset，单基金口径
   * 喂 FundProfitDetailView 的 dailyPnl（只有日历要用的三件套）
   */
  data: Pick<DailyAsset, "date" | "dayPnlCents" | "dayPnlRate">[];
  /** 点击有数据日期的回调（收益明细页消费）；不传则纯展示（首页） */
  onPickDate?: (date: string) => void;
  /** 当前选中日（可选）：格子加主色描边。与 onPickDate 配合由调用方驱动 */
  selectedDate?: string;
  /** 背景色分档（单基金口径传 FUND_RATE_TIERS，不传走全组合分档） */
  rateTiers?: readonly RateTier[];
}) {
  // 空数据直接走空态
  if (data.length === 0) {
    return <EmptyState description="暂无收益日历" />;
  }

  // ── 从 data 派生初始月与数据末月，不用 new Date() / dayjs() 无参 ──
  // SSR 安全：服务端/客户端时区不同不会导致 hydration 不一致
  const lastDataMonth = data[data.length - 1]!.date.slice(0, 7);

  return (
    <ProfitCalendarInner
      data={data}
      lastDataMonth={lastDataMonth}
      rateTiers={rateTiers}
      onPickDate={onPickDate}
      selectedDate={selectedDate}
    />
  );
}

/**
 * 内层组件：data 非空时才挂，让 useState 的初始值可以安全取 lastDataMonth。
 * 拆出来避免条件 hook（ProfitCalendar 提前 return 时 useState 不执行）。
 */
function ProfitCalendarInner({
  data,
  lastDataMonth,
  rateTiers,
  onPickDate,
  selectedDate,
}: {
  data: Pick<DailyAsset, "date" | "dayPnlCents" | "dayPnlRate">[];
  lastDataMonth: string;
  /** 背景色分档（外层透传，语义见 ProfitCalendar 的 props 注释） */
  rateTiers: readonly RateTier[];
  onPickDate?: (date: string) => void;
  /** 当前选中日（可选）：格子加主色描边，与外层同参透传 */
  selectedDate?: string;
}) {
  // currentMonth 状态：初始值从 data 派生，SSR 安全
  const [currentMonth, setCurrentMonth] = useState(lastDataMonth);

  // O(1) 查表：日期串 → 当日资产数据（data 不变时 Map 只建一次）
  const lookup = useMemo(() => {
    const m = new Map<string, Pick<DailyAsset, "date" | "dayPnlCents" | "dayPnlRate">>();
    for (const d of data) {
      m.set(d.date, d);
    }
    return m;
  }, [data]);

  // ── 月算术：全部从 currentMonth 串派生，确定性，SSR 安全 ──
  const firstDay = dayjs(`${currentMonth}-01`);
  const daysInMonth = firstDay.daysInMonth();
  // dayjs .day()：0=周日 1=周一 … 6=周六 —— 周日始的网格里这恰好就是
  // 月初空位数（周日落在第 0 列），无需再换算
  const startOffset = firstDay.day();

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

      {/* 日历网格：7 列，周日始 */}
      <div
        style={{
          display: "grid",
          // minmax(0,1fr) 强制均分：1fr 的 min-width 默认 auto，长数字会把列宽撑爆
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 4,
        }}
      >
        {/* 表头：日一二三四五六 */}
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
            ? cellBgColor(d.dayPnlCents, d.dayPnlRate, rateTiers)
            : `${COLOR.neutral}${NEUTRAL_ALPHA}`;

          // 收益金额颜色：走 pnlColor（与背景同色系，但用实色保证可读）
          const pnlFg = hasData && d.dayPnlCents !== 0
            ? pnlColor(d.dayPnlCents)
            : undefined;

          // 有数据且调用方要交互时，格子可点（键盘可达：role + tabIndex + Enter/Space）
          const clickable = hasData && onPickDate !== undefined;

          return (
            <div
              key={day}
              // fp-cal-cell：窄屏方形化/内距/格高下沉 responsive.css（spec §9），
              // inline 只留桌面值，别把两端同生效的值写进来（桌面零回归）
              className="fp-cal-cell"
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? `查看 ${dateStr} 收益明细` : undefined}
              // 选中态此前只有视觉 boxShadow，读屏器无感——补 aria-pressed 暴露按下态
              aria-pressed={clickable ? selectedDate === dateStr : undefined}
              onClick={clickable ? () => onPickDate?.(dateStr) : undefined}
              onKeyDown={clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPickDate?.(dateStr);
                    }
                  }
                : undefined}
              style={{
                position: "relative",
                background: bg,
                // 选中格：主色描边标明「明细区正在看这一天」
                boxShadow: selectedDate === dateStr ? `inset 0 0 0 2px ${COLOR.primary}` : undefined,
                borderRadius: 6,
                minHeight: 44,
                padding: "4px 6px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: clickable ? "pointer" : undefined,
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
                  // fp-cal-pnl：窄屏字号降到 10px 在 responsive.css（spec §9），
                  // inline 是桌面值 11
                  className="fp-cal-pnl"
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
