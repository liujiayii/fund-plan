import type { Route } from "./+types/_index";
import { Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import { Link } from "react-router";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { AdminNotReady } from "~/components/PortfolioView";
import { ProfitCalendar } from "~/components/ProfitCalendar";
import { fmtInt, fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { CHECKIN_BASE_CENTS, CHECKIN_MAX_CENTS } from "~/domain/checkin";
import { INITIAL_CASH_CENTS } from "~/domain/config";
import { getAssetTimeline } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { getAdminUser, getCurrentUser } from "~/services/guard";
import { getPortfolio } from "~/services/portfolio-service";
import { getSiteStats } from "~/services/stats-service";
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
 * 统计起点标注：YYYY-MM-DD → 「8 月 31 日」（去前导零，与资产走势日期标签同款手法）。
 * 计数从功能上线才开始落库，「累计」不是建站以来——不标注的话，
 * 数字尚小的阶段极易被读成「这站就这么点人」。
 */
function fmtStatsSince(date: string): string {
  const [m, d] = date.slice(5).split("-");
  return `${String(Number(m))} 月 ${String(Number(d))} 日`;
}

/**
 * 首页。游客看到的是主理人的示范盘 + 注册引导；
 * 已登录用户额外看到「去我的盘」入口。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);

  // 主理人是后续组合/时间线查询的前置（要 admin.id），先单独拿（1 条往返）；
  // 其余查询（当前用户 / 平台统计 / 组合 / 资产时间线）互相独立，一波全并行。
  // 旧写法先并行一批、等齐了再并行第二批——Worker 与 D1 跨大区时
  // 关键路径平白多出一整批往返，首页 TTFB 被拖出数秒
  const admin = await getAdminUser(db, env);

  if (!admin) {
    const [me, stats] = await Promise.all([
      getCurrentUser(request, db),
      getSiteStats(db),
    ]);
    return {
      me,
      stats,
      admin: null,
      adminName: env.ADMIN_USERNAME ?? "未配置",
    } as const;
  }

  const [me, stats, portfolio, timeline] = await Promise.all([
    getCurrentUser(request, db),
    getSiteStats(db),
    getPortfolio(db, admin.id),
    // 示范盘三件套（总览+走势+日历）的序列数据；「最近操作」模块已撤，orders 不再查
    getAssetTimeline(db, admin.id),
  ]);

  return { me, stats, admin, portfolio, timeline } as const;
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
  const { me, stats } = loaderData;

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
                  <NavButton type="primary" size="large" to="/me">
                    去我的盘
                  </NavButton>
                  <NavButton size="large" to="/funds">
                    挑只基金
                  </NavButton>
                </>
              )
            : (
                <>
                  <NavButton type="primary" size="large" to="/register">
                    免费注册，领 10 万本金
                  </NavButton>
                  {/* 目标为 /master：刻意保持原生 <a>（游客态走边缘缓存，SPA 跳转反而绕开缓存），勿换 NavButton */}
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
              {/* 三件套与 /master 首屏同构：总览（四小格）+ 走势 + 日历；
                  持仓列表与最近操作已按主人要求撤下，引流页保持轻量（ux-polish #10） */}
              <AssetOverviewCard
                summary={loaderData.portfolio.summary}
                daily={loaderData.timeline.daily}
                latest={loaderData.timeline.latest}
                totalDepositedCents={loaderData.timeline.totalDepositedCents}
              />
              {loaderData.timeline.daily.length > 0 && (
                <>
                  <div style={{ marginTop: 24 }} />
                  <AssetTrendChart data={loaderData.timeline.daily} />
                  <div style={{ marginTop: 24 }} />
                  {/* 首页日历纯展示：游客没有「点日期看明细」的诉求（spec §4④），不带 ProfitCalendarCard */}
                  <ProfitCalendar data={loaderData.timeline.daily} />
                </>
              )}
            </SectionCard>
          )}

      {/* 平台数据：社交证明。计数为纯整数指标，不含金额，不涉及精度铁律。
          访问（次）与访客（人）分开摆：PV 是热度、UV 是reach，口径混了会被内行看出业余 */}
      <SectionCard
        title="平台数据"
        extra={stats.statsSince && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            统计自
            {" "}
            {fmtStatsSince(stats.statsSince)}
            {" "}
            起
          </Text>
        )}
      >
        <Row gutter={[24, 16]}>
          <Col xs={12} md={8}>
            <StatBig label="今日访问" value={fmtInt(stats.todayVisits)} suffix="次" size={24} />
          </Col>
          <Col xs={12} md={8}>
            <StatBig label="累计访问" value={fmtInt(stats.totalVisits)} suffix="次" size={24} />
          </Col>
          <Col xs={12} md={8}>
            <StatBig label="注册用户" value={fmtInt(stats.users)} suffix="人" size={24} />
          </Col>
          <Col xs={12} md={8}>
            <StatBig label="今日访客" value={fmtInt(stats.todayVisitors)} suffix="人" size={24} />
          </Col>
          <Col xs={12} md={8}>
            <StatBig label="累计访客" value={fmtInt(stats.totalVisitors)} suffix="人" size={24} />
          </Col>
          <Col xs={12} md={8}>
            <StatBig label="累计成交" value={fmtInt(stats.confirmedOrders)} suffix="笔" size={24} />
          </Col>
        </Row>
      </SectionCard>

      {/* 排行榜引流：游客与已登录都给入口（移动端底栏进不去排行榜，这是移动端唯一入口） */}
      <SectionCard
        title="收益排行榜"
        extra={<Link to="/leaderboard">看完整榜单 →</Link>}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          全站用户的模拟盘同台竞技：收益率、总收益两个维度实时排名。
          注册开第一单，看看你能不能排到主理人前面。
        </Paragraph>
        <NavButton type="primary" to="/leaderboard">
          去看排行榜
        </NavButton>
      </SectionCard>

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
          <NavButton type="primary" size="large" to="/register">
            立即注册
          </NavButton>
        </Card>
      )}
    </Space>
  );
}
