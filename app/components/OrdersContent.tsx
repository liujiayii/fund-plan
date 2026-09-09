import type { OrderView } from "~/services/portfolio-service";
import { Pagination, Typography } from "antd";
import { useState } from "react";
import { OrderActions } from "~/components/OrderActions";
import { OrderList } from "~/components/OrderList";
import { OrderTimeline } from "~/components/OrderTimeline";
import { EmptyState } from "~/components/ui/EmptyState";

const { Text, Paragraph } = Typography;

/** 每页条数。翻页手感全站统一（tab 与深链页同一份） */
const PAGE_SIZE = 20;

export interface OrdersContentProps {
  /** 全量订单（loader 已带回，客户端分页） */
  orders: OrderView[];
  /** 持仓视角的基金过滤（空态文案分叉用；列表本身由调用方过滤好） */
  fundCode?: string;
}

/**
 * 交易记录内容体：待确认委托区 + 全部订单时间线 + 分页 + 口径说明
 * （2026-09-09 随 DCA 同款手法收拢）。
 *
 * 两个消费方一份真相：/me 与持仓详情页的「交易记录」tab
 * （MeTabsPanels.OrdersPanel 懒加载 /me/orders 的 loader）、
 * /me/orders 深链页（自带 loader）。撤单/改单走 OrderActions
 * （提交到 /me/orders 的 action，revalidate 后两边同步刷新）。
 *
 * 翻页状态在组件内：tab 场景 rc-tabs 切走不卸载、页面场景不重挂载，
 * 翻页位置都不会丢。
 */
export function OrdersContent({ orders, fundCode }: OrdersContentProps) {
  // 客户端分页（loader 已带回全量 200 条）
  const [page, setPage] = useState(1);

  // 待确认委托独立成区：撤单/改单的主战场，不和历史成交混在一条时间线里
  const pendingOrders = orders.filter(o => o.status === "pending");

  return (
    <div>
      {pendingOrders.length > 0 && (
        <>
          <Text strong>
            待确认委托（
            {pendingOrders.length}
            {" "}
            笔）
          </Text>
          <OrderList orders={pendingOrders} renderActions={o => <OrderActions order={o} />} />
          <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
            真实基金是 T+1 成交：交易日 15:00 前下单按当日净值，之后顺延至下一交易日。
            系统每晚 20:30 拉取当日净值并撮合，此前均可撤单或改单。
          </Paragraph>
          <div className="mt-6" />
        </>
      )}

      <Text strong>
        全部订单（
        {orders.length}
        {" "}
        笔）
      </Text>
      {orders.length === 0
        ? (
            <EmptyState description={fundCode ? "该基金还没有交易记录" : "还没有交易记录"} />
          )
        : (
            <>
              <OrderTimeline
                orders={orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
                // 待确认行内挂撤单/改单（OrderActions 自行判断 pending 才渲染）
                renderActions={o => <OrderActions order={o} />}
              />
              {orders.length > PAGE_SIZE && (
                // 窄屏包一层横向滚动容器：翻页器页码多了能滑，不顶穿卡片
                <div className="fp-h-scroll mt-4">
                  <Pagination
                    align="end"
                    responsive
                    current={page}
                    pageSize={PAGE_SIZE}
                    total={orders.length}
                    showSizeChanger={false}
                    onChange={setPage}
                  />
                </div>
              )}
            </>
          )}
      <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
        申购采用真实的
        <Text strong>内扣法</Text>
        ：手续费从申购金额中扣除，
        剩余净额除以确认日净值得到份额。赎回按
        <Text strong>先进先出</Text>
        逐批计费。
      </Paragraph>
    </div>
  );
}
