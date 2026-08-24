import {
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import type { Route } from './+types/_index';
import {
  AdminNotReady,
  HoldingTableReadonly,
  PortfolioSummary,
} from '~/components/PortfolioView';
import { centsToYuan } from '~/domain/money';
import { CHECKIN_BASE_CENTS, CHECKIN_MAX_CENTS } from '~/domain/checkin';
import { INITIAL_CASH_CENTS } from '~/domain/config';
import { getAppContext } from '~/services/context';
import { getAdminUser, getCurrentUser } from '~/services/guard';
import { getOrders, getPortfolio } from '~/services/portfolio-service';

const { Title, Paragraph, Text } = Typography;

export function meta(_: Route.MetaArgs) {
  return [
    { title: '模拟基金 · 定投系统' },
    {
      name: 'description',
      content: '用真实基金数据玩模拟盘：真实 T+1 撮合、内扣申购费、FIFO 阶梯赎回费，每日签到领本金',
    },
  ];
}

/**
 * 首页。游客看到的是主人的示范盘 + 注册引导；
 * 已登录用户额外看到「去我的盘」入口。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);

  const [me, admin] = await Promise.all([
    getCurrentUser(request, db),
    getAdminUser(db, env),
  ]);

  if (!admin) {
    return {
      me,
      admin: null,
      adminName: env.ADMIN_USERNAME ?? '未配置',
    } as const;
  }

  const [portfolio, orders] = await Promise.all([
    getPortfolio(db, admin.id),
    getOrders(db, admin.id, 8),
  ]);

  return { me, admin, portfolio, orders } as const;
}

/** 产品卖点，讲清「这不是玩具」 */
const FEATURES = [
  {
    title: '真实数据',
    desc: '基金档案、费率、历史净值全部来自东方财富公开接口，不是随机数。',
  },
  {
    title: '真实 T+1 撮合',
    desc: '交易日 15:00 前下单按当日净值，之后顺延至下一交易日，每晚自动撮合确认。',
  },
  {
    title: '真实费用算法',
    desc: '申购用内扣法，赎回按份额批次先进先出、依各批持有天数套阶梯费率。',
  },
  {
    title: '自动定投',
    desc: '支持日/周/月定投，系统每天定时扫描到期计划并自动下单。',
  },
];

export default function Index({ loaderData }: Route.ComponentProps) {
  const { me } = loaderData;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* 头图区 */}
      <Card>
        <Title level={2} style={{ marginBottom: 8 }}>
          用真实基金数据，玩一把不心疼的模拟盘
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 15 }}>
          注册即送 <Text strong>{centsToYuan(INITIAL_CASH_CENTS)} 元</Text> 模拟本金，
          每日签到再领 <Text strong>{centsToYuan(CHECKIN_BASE_CENTS)}~{centsToYuan(CHECKIN_MAX_CENTS)} 元</Text>。
          申购赎回按真实规则计费，让你在不亏真钱的前提下，把基金交易规则吃透。
        </Paragraph>
        <Space wrap>
          {me ? (
            <>
              <Button type="primary" size="large" href="/me">
                去我的盘
              </Button>
              <Button size="large" href="/funds">
                挑只基金
              </Button>
            </>
          ) : (
            <>
              <Button type="primary" size="large" href="/register">
                免费注册，领 10 万本金
              </Button>
              <Button size="large" href="/master">
                先围观主人的盘
              </Button>
            </>
          )}
        </Space>
      </Card>

      {/* 主人的盘 */}
      {loaderData.admin === null ? (
        <AdminNotReady adminName={loaderData.adminName} />
      ) : (
        <Card
          title={
            <span>
              主人的示范盘
              <Tag color="red" style={{ marginLeft: 8 }}>
                公开
              </Tag>
            </span>
          }
          extra={<a href="/master">查看完整组合 →</a>}
        >
          <PortfolioSummary portfolio={loaderData.portfolio} showCash={false} />
          <div style={{ marginTop: 24 }}>
            <Title level={5}>持仓</Title>
            <HoldingTableReadonly holdings={loaderData.portfolio.holdings} />
          </div>
          {loaderData.orders.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <Title level={5}>最近操作</Title>
              <Space direction="vertical" style={{ width: '100%' }}>
                {loaderData.orders.slice(0, 5).map((o) => (
                  <div key={o.id}>
                    <Text type="secondary">{o.placeDate}</Text>{' '}
                    <Tag color={o.side === 'buy' ? 'red' : 'green'}>
                      {o.side === 'buy' ? '申购' : '赎回'}
                    </Tag>{' '}
                    <a href={`/funds/${o.fundCode}`}>{o.fundName}</a>{' '}
                    {o.side === 'buy' && o.amount !== null && (
                      <Text>{centsToYuan(o.amount)} 元</Text>
                    )}
                    {o.source === 'dca' && <Tag color="blue">定投</Tag>}
                    {o.status === 'pending' && <Tag color="orange">待确认</Tag>}
                  </div>
                ))}
              </Space>
            </div>
          )}
        </Card>
      )}

      {/* 卖点 */}
      <Row gutter={[16, 16]}>
        {FEATURES.map((f) => (
          <Col xs={24} sm={12} lg={6} key={f.title}>
            <Card style={{ height: '100%' }}>
              <Title level={5} style={{ marginTop: 0 }}>
                {f.title}
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {f.desc}
              </Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      {!me && (
        <Card style={{ textAlign: 'center' }}>
          <Title level={4}>准备好开自己的盘了吗？</Title>
          <Paragraph type="secondary">
            用户名 + 密码即可注册，不用邮箱、不用手机号。
          </Paragraph>
          <Button type="primary" size="large" href="/register">
            立即注册
          </Button>
        </Card>
      )}
    </Space>
  );
}
