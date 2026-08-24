import { Card, Empty, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { Route } from './+types/master';
import {
  AdminNotReady,
  HoldingTableReadonly,
  PortfolioSummary,
} from '~/components/PortfolioView';
import { centsToYuan } from '~/domain/money';
import { getAppContext } from '~/services/context';
import { getAdminUser } from '~/services/guard';
import {
  getDcaPlans,
  getOrders,
  getPortfolio,
  getTransactions,
  type DcaPlanView,
  type OrderView,
  type TransactionView,
} from '~/services/portfolio-service';

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [
    { title: '主人的示范盘 · 模拟基金' },
    { name: 'description', content: '围观管理员的模拟基金组合：持仓、定投与交易流水全公开' },
  ];
}

/**
 * 主人的公开示范盘。游客无需登录即可查看——
 * 这是产品的「围观大佬」卖点，全部只读。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const admin = await getAdminUser(db, env);

  if (!admin) {
    return { admin: null, adminName: env.ADMIN_USERNAME ?? '未配置' } as const;
  }

  const [portfolio, orders, plans, txs] = await Promise.all([
    getPortfolio(db, admin.id),
    getOrders(db, admin.id, 50),
    getDcaPlans(db, admin.id),
    getTransactions(db, admin.id, 50),
  ]);

  return { admin, portfolio, orders, plans, txs } as const;
}

const TX_TYPE_MAP: Record<string, { color: string; text: string }> = {
  init: { color: 'blue', text: '初始本金' },
  checkin: { color: 'gold', text: '签到奖励' },
  buy: { color: 'red', text: '申购' },
  sell: { color: 'green', text: '赎回到账' },
  fee: { color: 'volcano', text: '手续费' },
};

const WEEKDAY_LABEL = ['', '一', '二', '三', '四', '五', '六', '日'];

function frequencyText(p: DcaPlanView): string {
  if (p.frequency === 'daily') return '每个交易日';
  if (p.frequency === 'weekly') return `每周${WEEKDAY_LABEL[p.dayOfWeek ?? 0] ?? '—'}`;
  return `每月 ${p.dayOfMonth} 号`;
}

export default function Master({ loaderData }: Route.ComponentProps) {
  if (!loaderData.admin) {
    return (
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Title level={3}>主人的示范盘</Title>
        <AdminNotReady adminName={loaderData.adminName} />
      </Space>
    );
  }

  const { admin, portfolio, orders, plans, txs } = loaderData;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {admin.username} 的示范盘
          <Tag color="red" style={{ marginLeft: 8 }}>
            公开
          </Tag>
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          这是管理员的模拟组合，持仓、定投与交易流水全部公开，任何人都能围观学习。
        </Paragraph>
      </div>

      <Card>
        <PortfolioSummary portfolio={portfolio} />
      </Card>

      <Card>
        <Tabs
          items={[
            {
              key: 'holdings',
              label: `持仓（${portfolio.holdings.length}）`,
              children: <HoldingTableReadonly holdings={portfolio.holdings} />,
            },
            {
              key: 'dca',
              label: `定投计划（${plans.length}）`,
              children:
                plans.length === 0 ? (
                  <Empty description="暂无定投计划" />
                ) : (
                  <Table<DcaPlanView>
                    rowKey="id"
                    dataSource={plans}
                    pagination={false}
                    scroll={{ x: 700 }}
                    columns={[
                      {
                        title: '基金',
                        dataIndex: 'fundName',
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
                        title: '每期金额',
                        dataIndex: 'amount',
                        align: 'right',
                        render: (v: number) => `${centsToYuan(v)} 元`,
                      },
                      { title: '频率', render: (_: unknown, r) => frequencyText(r) },
                      { title: '下次执行', dataIndex: 'nextRun', width: 120 },
                      {
                        title: '已投期数',
                        dataIndex: 'runCount',
                        align: 'right',
                        render: (v: number) => `${v} 期`,
                      },
                      {
                        title: '累计投入',
                        dataIndex: 'totalInvested',
                        align: 'right',
                        render: (v: number) => `${centsToYuan(v)} 元`,
                      },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        width: 90,
                        render: (s: string) =>
                          s === 'active' ? (
                            <Tag color="green">执行中</Tag>
                          ) : (
                            <Tag>已暂停</Tag>
                          ),
                      },
                    ]}
                  />
                ),
            },
            {
              key: 'orders',
              label: `交易记录（${orders.length}）`,
              children:
                orders.length === 0 ? (
                  <Empty description="暂无交易记录" />
                ) : (
                  <Table<OrderView>
                    rowKey="id"
                    dataSource={orders}
                    pagination={{ pageSize: 15, showSizeChanger: false }}
                    scroll={{ x: 700 }}
                    columns={[
                      { title: '下单日', dataIndex: 'placeDate', width: 110 },
                      { title: '基金', dataIndex: 'fundName' },
                      {
                        title: '方向',
                        dataIndex: 'side',
                        width: 80,
                        render: (s: string) => (
                          <Tag color={s === 'buy' ? 'red' : 'green'}>
                            {s === 'buy' ? '申购' : '赎回'}
                          </Tag>
                        ),
                      },
                      {
                        title: '来源',
                        dataIndex: 'source',
                        width: 80,
                        render: (s: string) =>
                          s === 'dca' ? <Tag color="blue">定投</Tag> : <Tag>手动</Tag>,
                      },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        width: 90,
                        render: (s: string) => {
                          const m: Record<string, { color: string; text: string }> = {
                            pending: { color: 'orange', text: '待确认' },
                            confirmed: { color: 'green', text: '已确认' },
                            failed: { color: 'red', text: '失败' },
                          };
                          const x = m[s] ?? { color: 'default', text: s };
                          return <Tag color={x.color}>{x.text}</Tag>;
                        },
                      },
                      {
                        title: '成交金额',
                        dataIndex: 'dealAmount',
                        align: 'right',
                        width: 120,
                        render: (v: number | null) =>
                          v === null ? '—' : `${centsToYuan(v)} 元`,
                      },
                    ]}
                  />
                ),
            },
            {
              key: 'txs',
              label: `资金流水（${txs.length}）`,
              children:
                txs.length === 0 ? (
                  <Empty description="暂无流水" />
                ) : (
                  <Table<TransactionView>
                    rowKey="id"
                    dataSource={txs}
                    pagination={{ pageSize: 15, showSizeChanger: false }}
                    scroll={{ x: 600 }}
                    columns={[
                      {
                        title: '时间',
                        dataIndex: 'createdAt',
                        width: 170,
                        render: (v: number) =>
                          new Date(v).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                          }),
                      },
                      {
                        title: '类型',
                        dataIndex: 'type',
                        width: 110,
                        render: (t: string) => {
                          const m = TX_TYPE_MAP[t] ?? { color: 'default', text: t };
                          return <Tag color={m.color}>{m.text}</Tag>;
                        },
                      },
                      {
                        title: '金额',
                        dataIndex: 'amount',
                        align: 'right',
                        width: 130,
                        render: (v: number) => (
                          <Text style={{ color: v >= 0 ? '#c62828' : '#2e7d32' }}>
                            {v > 0 ? '+' : ''}
                            {centsToYuan(v)} 元
                          </Text>
                        ),
                      },
                      {
                        title: '变动后余额',
                        dataIndex: 'balance',
                        align: 'right',
                        width: 140,
                        render: (v: number) => `${centsToYuan(v)} 元`,
                      },
                      { title: '备注', dataIndex: 'note' },
                    ]}
                  />
                ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
