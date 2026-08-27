import type { Route } from "./+types/_index";
import { Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import { OrderList } from "~/components/OrderList";
import {
  AdminNotReady,
  HoldingListReadonly,
  PortfolioSummary,
} from "~/components/PortfolioView";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { CHECKIN_BASE_CENTS, CHECKIN_MAX_CENTS } from "~/domain/checkin";
import { INITIAL_CASH_CENTS } from "~/domain/config";
import { getAppContext } from "~/services/context";
import { getAdminUser, getCurrentUser } from "~/services/guard";
import { getOrders, getPortfolio } from "~/services/portfolio-service";
import { CARD_SHADOW } from "~/theme";

const { Title, Paragraph, Text } = Typography;

export function meta(_: Route.MetaArgs) {
  return [
    { title: "模拟基金 · 定投系统" },
    {
      name: "description",
      content: "用真实基金数据玩模拟盘：真实 T+1 撮合、内扣申购费、FIFO 阶梯赎回费，每日签到领本金",
    },
  ];
}

/**
 * 首页。游客看到的是主理人的示范盘 + 注册引导；
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
      adminName: env.ADMIN_USERNAME ?? "未配置",
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
    title: "真实数据",
    desc: "基金档案、费率、历史净值全部来自东方财富公开接口，不是随机数。",
  },
  {
    title: "真实 T+1 撮合",
    desc: "交易日 15:00 前下单按当日净值，之后顺延至下一交易日，每晚自动撮合确认。",
  },
  {
    title: "真实费用算法",
    desc: "申购用内扣法，赎回按份额批次先进先出、依各批持有天数套阶梯费率。",
  },
  {
    title: "自动定投",
    desc: "支持日/周/月定投，系统每天定时扫描到期计划并自动下单。",
  },
];

export default function Index({ loaderData }: Route.ComponentProps) {
  const { me } = loaderData;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 头图区 */}
      <SectionCard>
        <Title level={2} style={{ marginBottom: 8 }}>
          用真实基金数据，玩一把不心疼的模拟盘
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 15 }}>
          注册即送
          {" "}
          <Text strong>
            {fmtYuan(INITIAL_CASH_CENTS)}
            {" "}
            元
          </Text>
          {" "}
          模拟本金，
          每日签到再领
          {" "}
          <Text strong>
            {fmtYuan(CHECKIN_BASE_CENTS)}
            ~
            {fmtYuan(CHECKIN_MAX_CENTS)}
            {" "}
            元
          </Text>
          。
          申购赎回按真实规则计费，让你在不亏真钱的前提下，把基金交易规则吃透。
        </Paragraph>
        <Space wrap>
          {me
            ? (
                <>
                  <Button type="primary" size="large" href="/me">
                    去我的盘
                  </Button>
                  <Button size="large" href="/funds">
                    挑只基金
                  </Button>
                </>
              )
            : (
                <>
                  <Button type="primary" size="large" href="/register">
                    免费注册，领 10 万本金
                  </Button>
                  <Button size="large" href="/master">
                    先围观主理人的盘
                  </Button>
                </>
              )}
        </Space>
      </SectionCard>

      {/* 主理人的盘 */}
      {loaderData.admin === null
        ? (
            <AdminNotReady adminName={loaderData.adminName} />
          )
        : (
            <SectionCard
              title={(
                <span>
                  主理人的示范盘
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    公开
                  </Tag>
                </span>
              )}
              extra={<a href="/master">查看完整组合 →</a>}
            >
              <PortfolioSummary portfolio={loaderData.portfolio} showCash={false} />
              <div style={{ marginTop: 24 }}>
                <Title level={5}>持仓</Title>
                <HoldingListReadonly holdings={loaderData.portfolio.holdings} />
              </div>
              {loaderData.orders.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <Title level={5}>最近操作</Title>
                  <OrderList orders={loaderData.orders.slice(0, 5)} />
                </div>
              )}
            </SectionCard>
          )}

      {/* 卖点。这里用 UnoCSS 工具类替代内联 style，验证工具链接入生效 */}
      <Row gutter={[16, 16]}>
        {FEATURES.map(f => (
          <Col xs={24} sm={12} lg={6} key={f.title}>
            {/* 裸 Card 是为了拿 className（等高栅格），但外观必须跟 SectionCard 一致：
                同一页上一张有边框、一张有阴影，看起来像两套设计 */}
            <Card
              className="h-full"
              variant="borderless"
              style={{ boxShadow: CARD_SHADOW }}
            >
              <Title level={5} className="mt-0">
                {f.title}
              </Title>
              <Paragraph type="secondary" className="mb-0">
                {f.desc}
              </Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 同上：裸 Card 只为拿 className（居中），外观仍对齐 SectionCard */}
      {!me && (
        <Card
          className="text-center"
          variant="borderless"
          style={{ boxShadow: CARD_SHADOW }}
        >
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
