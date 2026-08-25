import type { ReactNode } from "react";
import type { DcaPlanView } from "~/services/portfolio-service";
import { Tag } from "antd";
import { FundListItem } from "~/components/ui/FundListItem";
import { centsToYuan } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

/** 周几的中文（索引 1-7 对应周一到周日，0 位留空占位） */
const WEEKDAY_LABEL = ["", "一", "二", "三", "四", "五", "六", "日"];

/**
 * 把频率配置渲染成人话。
 *
 * ⚠️ 此前 me.dca.tsx 与 master.tsx 各实现了一遍，且写法不同
 * （一个从 WEEKDAYS 数组 find 再 slice(1)，一个查 WEEKDAY_LABEL 表），
 * 统一到这里。不导出——两个页面都只消费 DcaPlanList，不需要单独调它。
 */
function frequencyText(p: DcaPlanView): string {
  if (p.frequency === "daily")
    return "每个交易日";
  if (p.frequency === "weekly")
    return `每周${WEEKDAY_LABEL[p.dayOfWeek ?? 0] ?? "—"}`;
  return `每月 ${p.dayOfMonth} 号`;
}

export interface DcaPlanListProps {
  plans: DcaPlanView[];
  /** 每行最右的操作按钮。公开盘（只读）不传 */
  renderActions?: (p: DcaPlanView) => ReactNode;
}

/**
 * 定投计划列表。收敛 2 处 <Table<DcaPlanView>>（me.dca、master）。
 *
 * 信息层级：右侧主值是**每期金额**（定投最核心的参数），
 * 副值是「已投 N 期 · 累计 X 元」；频率与下次执行日放在名称下方的 note，
 * 因为「下次什么时候扣钱」是用户第二关心的事，不该藏在第 4 列。
 */
export function DcaPlanList({ plans, renderActions }: DcaPlanListProps) {
  return (
    <div>
      {plans.map((p, i) => (
        <FundListItem
          key={p.id}
          fundCode={p.fundCode}
          fundName={p.fundName}
          last={i === plans.length - 1}
          note={(
            <>
              {p.status === "active"
                ? <Tag color="blue">执行中</Tag>
                : <Tag>已暂停</Tag>}
              <span>
                {frequencyText(p)}
                {p.status === "active" && ` · 下次 ${p.nextRun}`}
              </span>
            </>
          )}
          primary={(
            <span
              style={{
                fontFamily: NUM_FONT,
                fontSize: 16,
                color: COLOR.textPrimary,
              }}
            >
              {centsToYuan(p.amount)}
              <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元/期</span>
            </span>
          )}
          secondary={(
            <span style={{ fontSize: 12, color: COLOR.textSecondary }}>
              {`已投 ${p.runCount} 期 · 累计 ${centsToYuan(p.totalInvested)} 元`}
            </span>
          )}
          actions={renderActions?.(p)}
        />
      ))}
    </div>
  );
}
