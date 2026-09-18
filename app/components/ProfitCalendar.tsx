import type { DailyAsset } from "~/domain/asset-timeline";
import type { PnlBucket, PnlDimension } from "~/domain/pnl-buckets";
import { Button } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import {
  ALL_PAGES,
  bucketDailyPnl,
  bucketKeyOfDate,
  pageOfDate,
  shiftPage,
} from "~/domain/pnl-buckets";
import { COLOR, pnlColor } from "~/theme";

/**
 * 收益日历。同一个组件画四种统计粒度（日 / 周 / 月 / 年），
 * 聚合口径全在 domain/pnl-buckets（纯函数，可脱离运行时单测）：
 *
 * | 粒度 | 一页     | 格子   | 列数 | 格内标签      | 翻页 |
 * | ---- | -------- | ------ | ---- | ------------- | ---- |
 * | 日   | 一个自然月 | 一天  | 7    | 日号          | 月   |
 * | 周   | 一个自然年 | 一周  | 7    | 周一「9/14」  | 年   |
 * | 月   | 一个自然年 | 一个月 | 4    | 「9月」       | 年   |
 * | 年   | 全部年份  | 一年   | 4    | 「2026」      | 无   |
 *
 * 格子配色仍是「按收益方向定红绿 + 按收益率绝对值分深浅」，只是阈值
 * 随粒度放大（见 DIMENSION_RATE_SCALE）。
 */

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 表头：周日始 */
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 粒度切换项（复用 PeriodTabs，与资产走势图的切换器同款观感） */
export const DIMENSION_OPTIONS = [
  { key: "day", label: "日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
] as const;

/** 各粒度的网格列数（日/周 = 一周七天一排；月/年 = 四列三排刚好铺满一屏） */
const COLUMNS: Record<PnlDimension, number> = { day: 7, week: 7, month: 4, year: 4 };

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

/**
 * 分档阈值随粒度放大的系数（随机游走 √N 近似）：一周 ≈ 5 个交易日、
 * 一月 ≈ 21、一年 ≈ 250（A 股年均交易日）。
 *
 * 不放大就没法看：区间收益率天然是「单日 √N 倍」，一周 ±3%、一月 ±7% 是
 * 常态，套用单日阈值后周/月/年视图个个越过最深档，整屏同色、深浅分档
 * 完全失效。放大后各粒度的颜色含义才对得上（都是「这段区间有多不寻常」）。
 */
const DIMENSION_RATE_SCALE: Record<PnlDimension, number> = {
  day: 1,
  week: Math.sqrt(5),
  month: Math.sqrt(21),
  year: Math.sqrt(250),
};

/** 无数据 / 中性（收益为 0）格子的透明度 */
const NEUTRAL_ALPHA = "1A"; // ~10%，极浅灰底

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/**
 * 按 |dayPnlRate| 绝对值选出透明度后缀。
 * dayPnlCents > 0 时 base 取 COLOR.up，< 0 取 COLOR.down；
 * 返回拼好的 hex8 色串（如 `#F0443880`，即 COLOR.up #F04438 拼透明度）。
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

/** 分档阈值按粒度系数整体放大（非数字门槛不变，只挪 0.3% / 1.5% 这些边界） */
function scaleTiers(tiers: readonly RateTier[], scale: number): readonly RateTier[] {
  if (scale === 1) {
    return tiers; // 日粒度原样返回，零改动零分配
  }
  return tiers.map(t => ({ threshold: t.threshold * scale, alpha: t.alpha }));
}

/**
 * 格内收益金额的简短展示：保留两位小数（与全站 fmtYuan 的分→元口径一致），
 * 如 "+11.40"、"-6.98"。
 *
 * 刻意不加千分位：日历格子要的是紧凑（"+1234.56" 而非 "+1,234.56"），
 * 桌面格子宽约 145px、font-num 数字（Space Grotesk tabular）11px，8 字符绰绰有余；
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

/** 日期串 → 「9 月 5 日」（去前导零，与 AssetOverviewCard 同款手法） */
function fmtDateLabel(date: string): string {
  return `${String(Number(date.slice(5, 7)))} 月 ${String(Number(date.slice(8, 10)))} 日`;
}

/**
 * 桶 key → 格内标签。日号 / 周一日期 / 月份 / 年份。
 * 周粒度的标签刻意用「周一那一天」而非周序号（W37 之类）：日期一眼能对上
 * 记忆里的行情，序号还得心里换算。
 */
export function bucketCellLabel(key: string, dimension: PnlDimension): string {
  switch (dimension) {
    case "day":
      return String(Number(key.slice(8, 10)));
    case "week":
      return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
    case "month":
      return `${Number(key.slice(5, 7))}月`;
    case "year":
      return key;
  }
}

/**
 * 桶 key → 明细区标题（不含「收益」二字，由 DailyPnlDetail 拼）：
 * 「9 月 5 日」/「9 月 14 日 – 9 月 20 日」/「2026 年 9 月」/「2026 年」。
 *
 * 周区间按「周一 → 周日」整周给（而非桶内实际有数据的日子）：只有周一周二
 * 有净值时也不该缩成两天，那会让人误以为是段零散区间。
 */
export function bucketTitleLabel(key: string, dimension: PnlDimension): string {
  switch (dimension) {
    case "day":
      return fmtDateLabel(key);
    case "week":
      return `${fmtDateLabel(key)} – ${fmtDateLabel(dayjs(key).add(6, "day").format("YYYY-MM-DD"))}`;
    case "month":
      return `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`;
    case "year":
      return `${key} 年`;
  }
}

/** 页 → 导航标题 */
function pageLabel(page: string, dimension: PnlDimension): string {
  if (page === ALL_PAGES) {
    return "全部年份";
  }
  switch (dimension) {
    case "day":
      return `${page.slice(0, 4)} 年 ${Number(page.slice(5, 7))} 月`;
    case "week":
    case "month":
      return `${page} 年`;
    case "year":
      return page;
  }
}

/**
 * 一个自然年覆盖的全部自然周（键 = 周一）。
 * 首周取「周一落在本年」的第一周——跨年周（周一在上一年）归上一年那一页，
 * 与 domain 的 bucketKeyOfDate 口径一致，同一周不会在两页上各显示半截。
 * 一年 52~53 周，7 列铺开是 8 排。
 */
function weekKeysOfYear(year: string): string[] {
  const keys: string[] = [];
  let cursor = bucketKeyOfDate(`${year}-01-01`, "week");
  if (cursor.slice(0, 4) !== year) {
    cursor = dayjs(cursor).add(7, "day").format("YYYY-MM-DD");
  }
  while (cursor.slice(0, 4) === year) {
    keys.push(cursor);
    cursor = dayjs(cursor).add(7, "day").format("YYYY-MM-DD");
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────

export function ProfitCalendar({
  data,
  dimension = "day",
  onDimensionChange,
  onPickKey,
  selectedKey,
  rateTiers: rateTiersProp,
}: {
  /**
   * 逐日快照。字段收窄成 Pick：全局口径喂 DailyAsset，单基金口径
   * 喂 FundProfitDetailView 的 dailyPnl（只有日历要用的三件套）。
   * 粒度聚合在组件内部做（bucketDailyPnl），调用方始终只喂逐日数据
   */
  data: Pick<DailyAsset, "date" | "dayPnlCents" | "dayPnlRate">[];
  /** 统计粒度（受控）。不传按日 */
  dimension?: PnlDimension;
  /** 粒度切换回调；不传则不渲染切换器（纯展示场景） */
  onDimensionChange?: (dimension: PnlDimension) => void;
  /** 点击有数据格子的回调，参数为该格所属桶的 key；不传则纯展示 */
  onPickKey?: (key: string) => void;
  /** 当前选中格（桶 key，可选）：格子加主色描边。与 onPickKey 配合由调用方驱动 */
  selectedKey?: string;
  /**
   * 背景色分档（单基金口径传 FUND_RATE_TIERS，不传走全组合分档）。
   * ⚠️ 只接受非空数组：空数组会让 cellBgColor 的兜底读到
   * tiers[-1]（undefined）拼出坏色串——类型上保证不了「非空」，
   * 运行时回退 RATE_TIERS（CodeRabbit PR #78 建议）
   */
  rateTiers?: readonly RateTier[];
}) {
  // 空数组防御：回退全组合分档，cellBgColor 的 tiers[-1] 兜底永不为 undefined
  const rateTiers = rateTiersProp && rateTiersProp.length > 0 ? rateTiersProp : RATE_TIERS;
  // 空数据直接走空态
  if (data.length === 0) {
    return <EmptyState description="暂无收益日历" />;
  }

  return (
    <ProfitCalendarInner
      // key=dimension：切换粒度时重挂内层，把翻页状态重置到新粒度的最新一页。
      // 页的形状是粒度相关的（"YYYY-MM" vs "YYYY"），沿用旧值会指向不存在的页；
      // 用重挂而不是 effect 同步 state，省掉一次「渲染出非法页 → 再纠正」的闪帧
      key={dimension}
      data={data}
      dimension={dimension}
      onDimensionChange={onDimensionChange}
      rateTiers={rateTiers}
      onPickKey={onPickKey}
      selectedKey={selectedKey}
    />
  );
}

/**
 * 内层组件：data 非空时才挂，让 useState 的初始值可以安全取数据末页。
 * 拆出来避免条件 hook（ProfitCalendar 提前 return 时 useState 不执行）。
 */
function ProfitCalendarInner({
  data,
  dimension,
  onDimensionChange,
  rateTiers,
  onPickKey,
  selectedKey,
}: {
  data: Pick<DailyAsset, "date" | "dayPnlCents" | "dayPnlRate">[];
  dimension: PnlDimension;
  onDimensionChange?: (dimension: PnlDimension) => void;
  /** 背景色分档（外层透传，语义见 ProfitCalendar 的 props 注释） */
  rateTiers: readonly RateTier[];
  onPickKey?: (key: string) => void;
  /** 当前选中格（桶 key，可选）：格子加主色描边，与外层同参透传 */
  selectedKey?: string;
}) {
  // ── 从 data 派生首页与数据边界，不用 new Date() / dayjs() 无参 ──
  // SSR 安全：服务端/客户端时区不同不会导致 hydration 不一致
  const firstDate = data[0]!.date;
  const lastDate = data[data.length - 1]!.date;
  const firstPage = pageOfDate(firstDate, dimension);
  const lastPage = pageOfDate(lastDate, dimension);

  // currentPage 状态：初始值从 data 派生（数据末页，用户进来看到的就是最新一段）
  const [currentPage, setCurrentPage] = useState(lastPage);

  // 逐日 → 粒度桶（金额求和 + 收益率复利连乘，见 domain/pnl-buckets）
  const buckets = useMemo(() => bucketDailyPnl(data, dimension), [data, dimension]);
  // O(1) 查表：桶 key → 桶（buckets 不变时 Map 只建一次）
  const bucketMap = useMemo(() => new Map(buckets.map(b => [b.key, b] as const)), [buckets]);
  // 年粒度没有「某一页」——数据里出现过的全部年份同屏铺开
  const allYears = useMemo(() => {
    const s = new Set<string>();
    for (const d of data) {
      s.add(d.date.slice(0, 4));
    }
    return [...s].sort();
  }, [data]);

  // 本页的格子 key 全表（含无数据的空格子——空位也要占格，不然月份会错位）
  const pageKeys = useMemo(() => {
    if (dimension === "year") {
      return allYears;
    }
    switch (dimension) {
      case "day": {
        const days = dayjs(`${currentPage}-01`).daysInMonth();
        return Array.from(
          { length: days },
          (_, i) => `${currentPage}-${String(i + 1).padStart(2, "0")}`,
        );
      }
      case "week":
        return weekKeysOfYear(currentPage);
      case "month":
        return Array.from(
          { length: 12 },
          (_, i) => `${currentPage}-${String(i + 1).padStart(2, "0")}`,
        );
    }
  }, [currentPage, dimension, allYears]);

  // 页导航：日粒度按月、周/月粒度按年；年粒度只有一页，不渲染翻页按钮
  const hasNav = currentPage !== ALL_PAGES;
  const prevPage = shiftPage(currentPage, dimension, -1);
  const nextPage = shiftPage(currentPage, dimension, 1);
  const prevDisabled = currentPage <= firstPage;
  const nextDisabled = currentPage >= lastPage;

  // 分档阈值随粒度放大（日粒度 scale=1，原样返回，外观零回归）
  const tiers = useMemo(
    () => scaleTiers(rateTiers, DIMENSION_RATE_SCALE[dimension]),
    [rateTiers, dimension],
  );

  // dayjs .day()：0=周日 1=周一 … 6=周六 —— 周日始的网格里这恰好就是
  // 月初空位数（周日落在第 0 列），无需再换算
  const startOffset = dimension === "day" ? dayjs(`${currentPage}-01`).day() : 0;

  return (
    <div>
      {/* 粒度切换：日 / 周 / 月 / 年。放在日历顶部而非卡片 extra——
          与「本期明细」的联动阅读路径是同一条竖向视线 */}
      {onDimensionChange && (
        <div style={{ marginBottom: 12 }}>
          <PeriodTabs
            options={DIMENSION_OPTIONS}
            value={dimension}
            onChange={v => onDimensionChange(v as PnlDimension)}
          />
        </div>
      )}

      {/* 页导航头：年粒度只有一页（全部年份），标题居中不摆翻页按钮 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: hasNav ? "space-between" : "center",
          marginBottom: 12,
        }}
      >
        {hasNav && (
          <Button size="small" disabled={prevDisabled} onClick={() => setCurrentPage(prevPage)}>
            ‹
          </Button>
        )}
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          {pageLabel(currentPage, dimension)}
        </span>
        {hasNav && (
          <Button size="small" disabled={nextDisabled} onClick={() => setCurrentPage(nextPage)}>
            ›
          </Button>
        )}
      </div>

      {/* 日历网格：列数随粒度变（日/周 7 列，月/年 4 列） */}
      <div
        style={{
          display: "grid",
          // minmax(0,1fr) 强制均分：1fr 的 min-width 默认 auto，长数字会把列宽撑爆
          gridTemplateColumns: `repeat(${COLUMNS[dimension]}, minmax(0, 1fr))`,
          gap: 4,
        }}
      >
        {/* 表头：日一二三四五六（只有日粒度是月历，需要星期表头） */}
        {dimension === "day" && WEEKDAY_LABELS.map(label => (
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
        {pageKeys.map((key) => {
          const bucket = bucketMap.get(key);
          return (
            <CalendarCell
              key={key}
              label={bucketCellLabel(key, dimension)}
              title={bucketTitleLabel(key, dimension)}
              bucket={bucket}
              tiers={tiers}
              selected={selectedKey === key}
              onPick={onPickKey}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * 单个格子：标签（日号 / 周一日期 / 月份 / 年份）+ 收益金额，
 * 背景按收益方向与幅度分档上色。有数据且调用方要交互时可点、键盘可达。
 */
function CalendarCell({
  label,
  title,
  bucket,
  tiers,
  selected,
  onPick,
}: {
  /** 格内标签（日号 / 周一 M/D / 9月 / 2026） */
  label: string;
  /** 无障碍标签用的完整区间名（「9 月 14 日 – 9 月 20 日」），比 label 可读 */
  title: string;
  /** 该格对应的桶；无数据（非交易日/超出区间）为 undefined */
  bucket: PnlBucket | undefined;
  tiers: readonly RateTier[];
  selected: boolean;
  /** 点击回调；不传则格子不可交互 */
  onPick?: (key: string) => void;
}) {
  const hasData = bucket !== undefined;
  // 格子背景色
  const bg = hasData
    ? cellBgColor(bucket.pnlCents, bucket.pnlRate, tiers)
    : `${COLOR.neutral}${NEUTRAL_ALPHA}`;

  // 收益金额颜色：统一 textPrimary（2026-09-09 主理人定夺）。
  // 涨跌语义全交给背景色（红/绿底 + 深浅分档）——此前文字走 pnlColor
  // 与背景同色系实色，深档（50%~70% 不透明）下红字贴红底看不清
  const pnlFg = hasData && bucket.pnlCents !== 0 ? COLOR.textPrimary : undefined;

  // 有数据且调用方要交互时，格子可点（键盘可达：role + tabIndex + Enter/Space）
  const clickable = hasData && onPick !== undefined;

  return (
    <div
      // fp-cal-cell：窄屏方形化/内距/格高下沉 responsive.css（spec §9），
      // inline 只留桌面值，别把两端同生效的值写进来（桌面零回归）
      className="fp-cal-cell"
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `查看 ${title} 收益明细` : undefined}
      // 选中态此前只有视觉 boxShadow，读屏器无感——补 aria-pressed 暴露按下态
      aria-pressed={clickable ? selected : undefined}
      onClick={clickable ? () => onPick(bucket.key) : undefined}
      onKeyDown={clickable
        ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(bucket.key);
            }
          }
        : undefined}
      style={{
        position: "relative",
        background: bg,
        // 选中格：主色描边标明「明细区正在看这一段」
        boxShadow: selected ? `inset 0 0 0 2px ${COLOR.primary}` : undefined,
        borderRadius: 6,
        minHeight: 44,
        padding: "4px 6px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: clickable ? "pointer" : undefined,
      }}
    >
      {/* 标签：右上角小字 */}
      <div
        style={{
          textAlign: "right",
          fontSize: 11,
          color: hasData ? COLOR.textPrimary : COLOR.textSecondary,
          lineHeight: 1,
        }}
      >
        {label}
      </div>
      {/* 收益金额：有数据且非零时显示 */}
      {hasData && bucket.pnlCents !== 0 && (
        <div
          // fp-cal-pnl：窄屏字号降到 10px 在 responsive.css（spec §9），
          // inline 是桌面值 11；font-num 类负责 Space Grotesk + tabular-nums
          className="fp-cal-pnl font-num"
          style={{
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
          {fmtPnlShort(bucket.pnlCents)}
        </div>
      )}
    </div>
  );
}
