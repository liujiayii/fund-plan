import type { OrderView } from "~/services/portfolio-service";
import { Tag, Tooltip } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { navToDisplay, sharesToDisplay } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

/**
 * 状态标签。
 *
 * ⚠️ 只有 pending / failed 才贴 Tag —— 「已确认」是常态，
 * 给每一行都贴一个绿色「已确认」等于没有信息，只是噪音。
 * 无 Tag 即代表已成交。
 */
const STATUS_TAG: Partial<Record<OrderView["status"], { color: string; text: string }>> = {
  pending: { color: "orange", text: "待确认" },
  failed: { color: "red", text: "失败" },
};

export interface OrderListProps {
  orders: OrderView[];
  /**
   * true 时右侧副值展示完整成交信息（净申购/到账金额 · 成交净值 · 份额 · 手续费）。
   * 订单页与公开盘传 true —— 公开盘的旧表格有「成交金额」列，不传就丢了这个字段，
   * 且赎回行的主值会从「元」变成「份」，量纲都不对。
   * 只有首页「最近操作」与我的盘「最近订单」（me._index）传 false：
   * 两处都是五行概览，要的是方向和委托金额。
   */
  detailed?: boolean;
}

/**
 * 订单列表。收敛 3 处 <Table<OrderView>>（me.orders 11 列、me._index、master）。
 *
 * 降噪三条（见设计文档 3.4）：
 *  - 「手动」不贴 Tag，只有定投才贴
 *  - 「已确认」不贴 Tag，只有待确认/失败才贴
 *  - 方向用蓝色/默认色，不占用红绿（红绿是涨跌的）
 */
export function OrderList({ orders, detailed }: OrderListProps) {
  return (
    <div>
      {orders.map((o, i) => {
        const statusTag = STATUS_TAG[o.status];

        // 委托：申购看金额、赎回看份额
        const commissioned
          = o.side === "buy"
            ? `${fmtYuan(o.amount ?? 0)} 元`
            : `${sharesToDisplay(o.shares ?? 0)} 份`;

        return (
          <FundListItem
            key={o.id}
            fundCode={o.fundCode}
            fundName={o.fundName}
            last={i === orders.length - 1}
            note={(
              <>
                {o.side === "buy"
                  ? <Tag color="blue">申购</Tag>
                  : <Tag>赎回</Tag>}
                {o.source === "dca" && <Tag color="purple">定投</Tag>}
                {statusTag && (
                  o.failReason
                    ? (
                        <Tooltip title={o.failReason}>
                          <Tag color={statusTag.color}>{statusTag.text}</Tag>
                        </Tooltip>
                      )
                    : (
                        <Tag color={statusTag.color}>{statusTag.text}</Tag>
                      )
                )}
                <span>
                  {o.placeDate}
                  {" 下单 · 确认日 "}
                  {o.confirmDate}
                </span>
              </>
            )}
            primary={(
              <span
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: 15,
                  color: COLOR.textPrimary,
                }}
              >
                {commissioned}
              </span>
            )}
            secondary={
              detailed && o.dealNav !== null
                ? (
                    <span style={{ fontSize: 12, color: COLOR.textSecondary }}>
                      {/* 到账/净申购金额放最前：赎回单里「我到手多少钱」是最该被一眼
                          看到的数字，而 primary 位显示的是委托份额、不是钱。
                          「净申购」/「到账」这两个词替代了旧表格靠 Tooltip 才能看到的
                          语义说明（申购=扣申购费后的净额，赎回=扣赎回费后的实际到账）。 */}
                      {o.dealAmount !== null
                        && `${o.side === "buy" ? "净申购" : "到账"} ${fmtYuan(o.dealAmount)} 元 · `}
                      {`成交净值 ${navToDisplay(o.dealNav)}`}
                      {o.dealShares !== null && ` · ${sharesToDisplay(o.dealShares)} 份`}
                      {o.fee !== null && ` · 费 ${fmtYuan(o.fee)} 元`}
                    </span>
                  )
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
