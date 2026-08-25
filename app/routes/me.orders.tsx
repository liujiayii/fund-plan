import type { Route } from "./+types/me.orders";
import { Alert, Space, Typography } from "antd";
import { OrderList } from "~/components/OrderList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getOrders } from "~/services/portfolio-service";

const { Title, Text, Paragraph } = Typography;

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
              <OrderList orders={orders} detailed />
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
