import type { RateTier } from "~/components/ui/calendar-theme";
import type { DailyAsset } from "~/domain/asset-timeline";
import type { PnlBucket, PnlDimension } from "~/domain/pnl-buckets";
import { Button } from "antd";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { calendarCellBackground, RATE_TIERS } from "~/components/ui/calendar-theme";
import { EmptyState } from "~/components/ui/EmptyState";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import {
  ALL_PAGES,
  bucketDailyPnl,
  bucketKeyOfDate,
  pageOfDate,
  pageOfKey,
  shiftPage,
} from "~/domain/pnl-buckets";
import { COLOR } from "~/theme";

// 保留既有消费方的导出路径；颜色分档本身是可独立测试的纯 UI 配置。
export { FUND_RATE_TIERS } from "~/components/ui/calendar-theme";

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

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

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
   * 空数组会在按粒度缩放前回退全组合分档，保证周/月/年阈值也正确放大。
   */
  rateTiers?: readonly RateTier[];
}) {
  // 缩放前统一回退分档，避免空配置绕过后续的周/月/年阈值校准。
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

  // currentPage 状态：初始值从 data 派生（数据末页，用户进来看到的就是最新一段）。
  // 有选中桶时以选中桶所在页开局——数据末页若整页零收益，默认选中桶会落到更早的
  // 页上，从末页开局会让明细区指向一段日历上根本看不见的区间（CodeRabbit PR #100）
  const [currentPage, setCurrentPage] = useState(() =>
    selectedKey ? pageOfKey(selectedKey, dimension) : lastPage);

  // 同粒度下重新加载（admin 换用户、重新校验）会让数据范围变化，旧的 currentPage
  // 可能越界：渲染时夹回有效区间（CodeRabbit PR #100）。用派生值而不是 effect 回写
  // state——少一次多余渲染，也避免 pageKeys 与 bucketMap 对不上时闪出一屏空格子
  const page = currentPage < firstPage
    ? firstPage
    : currentPage > lastPage ? lastPage : currentPage;

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
        const days = dayjs(`${page}-01`).daysInMonth();
        return Array.from(
          { length: days },
          (_, i) => `${page}-${String(i + 1).padStart(2, "0")}`,
        );
      }
      case "week":
        return weekKeysOfYear(page);
      case "month":
        return Array.from(
          { length: 12 },
          (_, i) => `${page}-${String(i + 1).padStart(2, "0")}`,
        );
    }
  }, [page, dimension, allYears]);

  // 页导航：日粒度按月、周/月粒度按年；年粒度只有一页，不渲染翻页按钮
  const hasNav = page !== ALL_PAGES;
  const prevPage = shiftPage(page, dimension, -1);
  const nextPage = shiftPage(page, dimension, 1);
  const prevDisabled = page <= firstPage;
  const nextDisabled = page >= lastPage;

  // 分档阈值随粒度放大（日粒度 scale=1，原样返回，外观零回归）
  const tiers = useMemo(
    () => scaleTiers(rateTiers, DIMENSION_RATE_SCALE[dimension]),
    [rateTiers, dimension],
  );

  // dayjs .day()：0=周日 1=周一 … 6=周六 —— 周日始的网格里这恰好就是
  // 月初空位数（周日落在第 0 列），无需再换算
  const startOffset = dimension === "day" ? dayjs(`${page}-01`).day() : 0;

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
          {pageLabel(page, dimension)}
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
  // DOM 颜色由 CSS 变量解析，B 首帧与无 JS 场景也能跟随 head / 系统主题。
  const bg = calendarCellBackground(COLOR, bucket?.pnlCents ?? 0, bucket?.pnlRate ?? 0, tiers);

  // 金额统一主文字色，涨跌交给红绿底；分档强度已为两套主题保留小字对比。
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
