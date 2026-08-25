import type { Route } from "./+types/me.orders";
import type { OrderView } from "~/services/portfolio-service";
import { Alert, Card, Empty, Space, Table, Tag, Tooltip, Typography } from "antd";
import { centsToYuan, navToDisplay, sharesToDisplay } from "~/domain/money";
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

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending: { color: "orange", text: "待确认" },
  confirmed: { color: "green", text: "已确认" },
  failed: { color: "red", text: "失败" },
};

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

      <Card title={`全部订单（${orders.length} 笔）`}>
        {orders.length === 0
          ? (
              <Empty description="还没有交易记录" />
            )
          : (
              <Table<OrderView>
                rowKey="id"
                dataSource={orders}
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                columns={[
                  { title: "下单日", dataIndex: "placeDate", width: 110, fixed: "left" },
                  {
                    title: "基金",
                    dataIndex: "fundName",
                    width: 180,
                    render: (name: string, r) => (
                      <a href={`/funds/${r.fundCode}`}>
                        {name}
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {r.fundCode}
                        </Text>
                      </a>
                    ),
                  },
                  {
                    title: "方向",
                    dataIndex: "side",
                    width: 80,
                    render: (s: string) => (
                      <Tag color={s === "buy" ? "red" : "green"}>
                        {s === "buy" ? "申购" : "赎回"}
                      </Tag>
                    ),
                  },
                  {
                    title: "来源",
                    dataIndex: "source",
                    width: 80,
                    render: (s: string) =>
                      s === "dca" ? <Tag color="blue">定投</Tag> : <Tag>手动</Tag>,
                  },
                  {
                    title: "委托",
                    width: 130,
                    align: "right",
                    render: (_: unknown, r) =>
                      r.side === "buy"
                        ? `${centsToYuan(r.amount ?? 0)} 元`
                        : `${sharesToDisplay(r.shares ?? 0)} 份`,
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (s: string, r) => {
                      const m = STATUS_MAP[s] ?? { color: "default", text: s };
                      return r.failReason
                        ? (
                            <Tooltip title={r.failReason}>
                              <Tag color={m.color}>{m.text}</Tag>
                            </Tooltip>
                          )
                        : (
                            <Tag color={m.color}>{m.text}</Tag>
                          );
                    },
                  },
                  { title: "确认日", dataIndex: "confirmDate", width: 110 },
                  {
                    title: "成交净值",
                    dataIndex: "dealNav",
                    width: 100,
                    align: "right",
                    render: (v: number | null) => (v ? navToDisplay(v) : "—"),
                  },
                  {
                    title: "成交份额",
                    dataIndex: "dealShares",
                    width: 120,
                    align: "right",
                    render: (v: number | null) => (v ? sharesToDisplay(v) : "—"),
                  },
                  {
                    title: "成交金额",
                    dataIndex: "dealAmount",
                    width: 120,
                    align: "right",
                    render: (v: number | null, r) =>
                      v === null
                        ? (
                            "—"
                          )
                        : (
                            <Tooltip
                              title={
                                r.side === "buy"
                                  ? "扣除申购费后的净申购金额"
                                  : "扣除赎回费后的实际到账金额"
                              }
                            >
                              {centsToYuan(v)}
                              {" "}
                              元
                            </Tooltip>
                          ),
                  },
                  {
                    title: "手续费",
                    dataIndex: "fee",
                    width: 100,
                    align: "right",
                    render: (v: number | null) =>
                      v === null
                        ? "—"
                        : (
                            <Text type="danger">
                              {centsToYuan(v)}
                              {" "}
                              元
                            </Text>
                          ),
                  },
                ]}
              />
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          申购采用真实的
          <Text strong>内扣法</Text>
          ：手续费从申购金额中扣除，
          剩余净额除以确认日净值得到份额。赎回按
          <Text strong>先进先出</Text>
          逐批计费。
        </Paragraph>
      </Card>
    </Space>
  );
}
