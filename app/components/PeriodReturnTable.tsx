import type { PeriodReturns } from "~/domain/performance";
import { DataRow } from "~/components/ui/DataRow";

export interface PeriodReturnTableProps {
  returns: PeriodReturns;
}

const ROWS: { label: string; key: keyof PeriodReturns }[] = [
  { label: "近 1 周", key: "w1" },
  { label: "近 1 月", key: "m1" },
  { label: "近 3 月", key: "m3" },
  { label: "近 6 月", key: "m6" },
  { label: "近 1 年", key: "y1" },
  { label: "今年来", key: "ytd" },
  { label: "成立来", key: "all" },
];

/**
 * 阶段涨幅表。null 渲染「—」，值走手写格式而非 rateToPercent ——
 * rateToPercent 不补「+」号，但阶段涨幅涨需要显式 `+`。
 * 用 DataRow 行而非 antd Table —— 7 行键值对，同维度单行对比，
 * DataRow 的 dl/dt/dd 语义比 Table 轻，且与详情页其他概况行一致。
 */
export function PeriodReturnTable({ returns }: PeriodReturnTableProps) {
  return (
    <div>
      {ROWS.map((r, i) => {
        const v = returns[r.key];
        return (
          <DataRow
            key={r.key}
            label={r.label}
            value={v === null ? "—" : `${v > 0 ? "+" : ""}${(v / 10000 * 100).toFixed(2)}%`}
            mono
            last={i === ROWS.length - 1}
          />
        );
      })}
    </div>
  );
}
