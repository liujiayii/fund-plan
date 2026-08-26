import type { Route } from "./+types/me.orders";
import { Alert, Pagination, Space, Typography } from "antd";
import { useState } from "react";
import { OrderTimeline } from "~/components/OrderTimeline";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getOrders } from "~/services/portfolio-service";

const { Title, Text, Paragraph } = Typography;

/**
 * 每页条数。沿用被卡片列表取代的那张旧 Table 的 `pageSize: 20`，
 * 翻页手感与改版前一致 —— loader 一次取 200 条，全铺在一页上是 200 张卡片。
 */
const PAGE_SIZE = 20;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的订单 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const orders = await getOrders(db, user.id, 200);
  return { orders };
}

export default function MeOrders({ loaderData }: Route.ComponentProps) {
  const { orders } = loaderData;
  const pendingCount = orders.filter(o => o.status === "pending").length;
  // 客户端分页：loader 已经把 200 条全取回来了，翻页不用再请求服务端
  const [page, setPage] = useState(1);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的订单
      </Title>

      {pendingCount > 0 && (
        <Alert
          type="info"
          showIcon
          message={`有 ${pendingCount} 笔订单待确认`}
          description="真实基金是 T+1 成交：交易日 15:00 前下单按当日净值，之后顺延至下一交易日。系统每晚 20:30 拉取当日净值并撮合。"
        />
      )}

      <SectionCard title={`全部订单（${orders.length} 笔）`}>
        {orders.length === 0
          ? (
              <EmptyState description="还没有交易记录" />
            )
          : (
              <>
                <OrderTimeline
                  orders={orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
                />
                {orders.length > PAGE_SIZE && (
                  <Pagination
                    align="end"
                    current={page}
                    pageSize={PAGE_SIZE}
                    total={orders.length}
                    showSizeChanger={false}
                    style={{ marginTop: 16 }}
                    onChange={setPage}
                  />
                )}
              </>
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          申购采用真实的
          <Text strong>内扣法</Text>
          ：手续费从申购金额中扣除，
          剩余净额除以确认日净值得到份额。赎回按
          <Text strong>先进先出</Text>
          逐批计费。
        </Paragraph>
      </SectionCard>
    </Space>
  );
}
