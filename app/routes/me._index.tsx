import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useFetcher } from 'react-router';
import type { Route } from './+types/me._index';
import { centsToYuan, navToDisplay, sharesToDisplay } from '~/domain/money';
import { CHECKIN_MAX_CENTS } from '~/domain/checkin';
import { doCheckin, getCheckinStatus } from '~/services/checkin-service';
import { getAppContext } from '~/services/context';
import { requireUser } from '~/services/guard';
import { getOrders, getPortfolio, type HoldingView } from '~/services/portfolio-service';

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: '我的仪表盘 · 模拟基金' }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  const [portfolio, checkinStatus, orders] = await Promise.all([
    getPortfolio(db, user.id),
    getCheckinStatus(db, user.id),
    getOrders(db, user.id, 5),
  ]);

  return { user, portfolio, checkinStatus, orders };
}

/** 签到 action */
export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  try {
    const r = await doCheckin(db, user.id);
    return {
      ok: true,
      message: `签到成功！连签第 ${r.streak} 天，领取 ${centsToYuan(r.reward)} 元`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : '签到失败' };
  }
}

/** 涨红跌绿（国内习惯） */
function pnlColor(v: number): string {
  if (v > 0) return '#c62828';
  if (v < 0) return '#2e7d32';
  return undefined as unknown as string;
}

export default function MeIndex({ loaderData }: Route.ComponentProps) {
  const { user, portfolio, checkinStatus, orders } = loaderData;
  const { summary, holdings } = portfolio;
  const fetcher = useFetcher<typeof action>();
  const signing = fetcher.state === 'submitting';

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {user.username} 的模拟盘
          {user.role === 'admin' && <Tag color="red" style={{ marginLeft: 8 }}>主人</Tag>}
        </Title>
        {user.role === 'admin' && (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            你的盘是公开示范盘，所有访客都能在 <a href="/master">/master</a> 围观。
          </Paragraph>
        )}
      </div>

      {/* 资产总览 */}
      <Card>
        <Row gutter={[24, 16]}>
          <Col xs={12} md={6}>
            <Statistic
              title="总资产"
              value={centsToYuan(summary.totalAssetCents)}
              suffix="元"
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="持仓市值"
              value={centsToYuan(summary.marketValueCents)}
              suffix="元"
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="可用现金"
              value={centsToYuan(summary.cashCents)}
              suffix="元"
            />
          </Col>
          <Col xs={12} md={6}>
            <Statistic
              title="浮动盈亏"
              value={centsToYuan(summary.totalPnlCents)}
              suffix="元"
              valueStyle={{ color: pnlColor(summary.totalPnlCents) }}
              prefix={summary.totalPnlCents > 0 ? '+' : ''}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              收益率 {(summary.totalPnlRate * 100).toFixed(2)}%
            </Text>
          </Col>
        </Row>
      </Card>

      {/* 每日签到 */}
      <Card title="每日签到领本金">
        {fetcher.data?.ok && (
          <Alert type="success" showIcon message={fetcher.data.message} style={{ marginBottom: 16 }} />
        )}
        {fetcher.data?.error && (
          <Alert type="error" showIcon message={fetcher.data.error} style={{ marginBottom: 16 }} />
        )}

        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={8}>
            <Statistic title="当前连签" value={checkinStatus.streak} suffix="天" />
          </Col>
          <Col xs={24} md={8}>
            <Statistic
              title={checkinStatus.checkedToday ? '明天可领' : '今天可领'}
              value={centsToYuan(checkinStatus.nextReward)}
              suffix="元"
              valueStyle={{ color: '#c62828' }}
            />
            <Progress
              percent={Math.round((checkinStatus.nextReward / CHECKIN_MAX_CENTS) * 100)}
              size="small"
              showInfo={false}
              strokeColor="#c62828"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              连签递增，每天 +50 元，封顶 500 元
            </Text>
          </Col>
          <Col xs={24} md={8}>
            <Statistic
              title="累计签到入金"
              value={centsToYuan(checkinStatus.totalCheckin)}
              suffix="元"
            />
            <fetcher.Form method="post" style={{ marginTop: 12 }}>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                block
                loading={signing}
                disabled={checkinStatus.checkedToday}
              >
                {checkinStatus.checkedToday ? '今日已签到' : '立即签到'}
              </Button>
            </fetcher.Form>
          </Col>
        </Row>
      </Card>

      {/* 持仓速览 */}
      <Card
        title="我的持仓"
        extra={<a href="/me/holdings">管理持仓 →</a>}
      >
        {holdings.length === 0 ? (
          <Empty description="还没有持仓">
            <Button type="primary" href="/funds">
              去挑一只基金
            </Button>
          </Empty>
        ) : (
          <Table<HoldingView>
            rowKey="fundCode"
            dataSource={holdings}
            pagination={false}
            size="middle"
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
                title: '持有份额',
                dataIndex: 'sharesScaled',
                align: 'right',
                render: (v: number) => sharesToDisplay(v),
              },
              {
                title: '净值',
                dataIndex: 'navScaled',
                align: 'right',
                render: (v: number, r) => (
                  <span>
                    {navToDisplay(v)}
                    {r.navDate && (
                      <>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {r.navDate}
                        </Text>
                      </>
                    )}
                  </span>
                ),
              },
              {
                title: '市值',
                dataIndex: 'marketValueCents',
                align: 'right',
                render: (v: number) => `${centsToYuan(v)} 元`,
              },
              {
                title: '盈亏',
                dataIndex: 'pnlCents',
                align: 'right',
                render: (v: number, r) => (
                  <span style={{ color: pnlColor(v) }}>
                    {v > 0 ? '+' : ''}
                    {centsToYuan(v)} 元
                    <br />
                    <Text style={{ color: pnlColor(v), fontSize: 12 }}>
                      {(r.pnlRate * 100).toFixed(2)}%
                    </Text>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* 最近订单 */}
      <Card title="最近订单" extra={<a href="/me/orders">全部订单 →</a>}>
        {orders.length === 0 ? (
          <Empty description="还没有交易记录" />
        ) : (
          <Table
            rowKey="id"
            dataSource={orders}
            pagination={false}
            size="small"
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
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (s: string) => {
                  const map: Record<string, { color: string; text: string }> = {
                    pending: { color: 'orange', text: '待确认' },
                    confirmed: { color: 'green', text: '已确认' },
                    failed: { color: 'red', text: '失败' },
                  };
                  const m = map[s] ?? { color: 'default', text: s };
                  return <Tag color={m.color}>{m.text}</Tag>;
                },
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
