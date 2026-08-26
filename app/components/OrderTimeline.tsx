import type { OrderView } from "~/services/portfolio-service";
import { Tag, Timeline, Tooltip } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { navToDisplay, sharesToDisplay } from "~/domain/money";
import { COLOR } from "~/theme";

/** 与 OrderList 同款降噪：只有 pending/failed 贴 Tag，confirmed 是常态不贴 */
const STATUS_TAG: Partial<Record<OrderView["status"], { color: string; text: string }>> = {
  pending: { color: "orange", text: "待确认" },
  failed: { color: "red", text: "失败" },
};

export interface OrderTimelineProps {
  orders: OrderView[];
}

/**
 * 订单确认进度时间线。每笔订单是一个节点：
 * pending 蓝（进行中）+「T+1 确认中」突出、confirmed 灰（常态）、failed 红。
 * 把 T+1 目标日（confirmDate）与成交明细按时间线呈现，比平铺列表更接近支付宝的「订单状态流」。
 */
export function OrderTimeline({ orders }: OrderTimelineProps) {
  if (orders.length === 0)
    return null;
  return (
    <Timeline
      items={orders.map((o) => {
        const tag = STATUS_TAG[o.status];
        const color = o.status === "pending" ? "blue" : o.status === "failed" ? "red" : "gray";
        return {
          color,
          children: (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <a href={`/funds/${o.fundCode}`} style={{ color: COLOR.textPrimary, fontWeight: 500 }}>
                  {o.fundName}
                </a>
                <span style={{ fontSize: 12, color: COLOR.textSecondary }}>{o.fundCode}</span>
                {o.side === "buy" ? <Tag color="blue">申购</Tag> : <Tag>赎回</Tag>}
                {o.source === "dca" && <Tag color="purple">定投</Tag>}
                {tag && (o.failReason
                  ? <Tooltip title={o.failReason}><Tag color={tag.color}>{tag.text}</Tag></Tooltip>
                  : <Tag color={tag.color}>{tag.text}</Tag>)}
              </div>
              <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
                {o.side === "buy" ? `委托 ${fmtYuan(o.amount ?? 0)} 元` : `委托 ${sharesToDisplay(o.shares ?? 0)} 份`}
                {" · 下单 "}
                {o.placeDate}
                {" · 确认日 "}
                {o.confirmDate}
                {o.status === "pending" && (
                  <span style={{ color: COLOR.primary }}>（T+1 确认中）</span>
                )}
              </div>
              {o.status === "confirmed" && o.dealNav !== null && (
                <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
                  {o.dealAmount !== null && `${o.side === "buy" ? "净申购" : "到账"} ${fmtYuan(o.dealAmount)} 元 · `}
                  {`成交净值 ${navToDisplay(o.dealNav)}`}
                  {o.dealShares !== null && ` · ${sharesToDisplay(o.dealShares)} 份`}
                  {o.fee !== null && ` · 费 ${fmtYuan(o.fee)} 元`}
                </div>
              )}
            </div>
          ),
        };
      })}
    />
  );
}
