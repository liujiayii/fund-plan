import type { Route } from "./+types/_index";
import { Button, Card, Col, Row, Space, Tag, Typography } from "antd";
import { Link } from "react-router";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { AdminNotReady } from "~/components/PortfolioView";
import { ProfitCalendar } from "~/components/ProfitCalendar";
import { fmtInt, fmtYuan } from "~/components/ui/format";
import { Logo } from "~/components/ui/Logo";
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
import { PRIMARY_GRADIENT } from "~/theme";

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
      {/* 品牌渐变 hero（visual-refresh spec §6.2）：白字标语 + 双 CTA + 装饰曲线 */}
      <div
        className="fp-hero animate-fade-up relative overflow-hidden rounded-2xl text-white"
        style={{ background: PRIMARY_GRADIENT, padding: "48px 40px" }}
      >
        {/* 装饰：低透明度白色净值曲线，沿 hero 底部流动（纯静态，SSR 安全） */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 w-full"
          viewBox="0 0 1200 320"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,260 C200,240 350,180 520,190 C690,200 820,120 1000,110 C1090,105 1150,90 1200,80 L1200,320 L0,320 Z"
            fill="#fff"
            opacity="0.08"
          />
          <path
            d="M0,260 C200,240 350,180 520,190 C690,200 820,120 1000,110 C1090,105 1150,90 1200,80"
            stroke="#fff"
            strokeWidth="2"
            fill="none"
            opacity="0.18"
          />
        </svg>
        {/* 右侧浮动迷你持仓卡：用产品语言预演「这是理财工具」。
            fp-hero-cards：窄屏隐藏（responsive.css），桌面绝对定位。
            数值是装饰性示例（CodeRabbit PR #79 修正：模拟盘语境下
            不标注会被当成主理人真实收益），标题弱化标注「（示例）」 */}
        <div className="fp-hero-cards absolute top-8 right-8 hidden gap-3 lg:flex lg:flex-col">
          <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm">
            <div className="text-xs opacity-80">
              昨日收益
              <span className="opacity-60">（示例）</span>
            </div>
            <div className="font-num text-lg font-medium">+82.33 元</div>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm">
            <div className="text-xs opacity-80">
              累计收益
              <span className="opacity-60">（示例）</span>
            </div>
            <div className="font-num text-lg font-medium">+2,310.66 元</div>
          </div>
        </div>

        <div className="relative z-10">
          <div className="mb-3 flex items-center gap-2 text-sm tracking-wide opacity-90">
            <Logo size={22} />
            模拟基金
          </div>
          {/* 主标：spec §6.2 钉死的文案结构（真实感 + 零风险） */}
          <h2 className="m-0 text-3xl leading-tight font-bold">用真数据，练真盘感</h2>
          <p className="mt-3 mb-0 max-w-xl text-sm leading-6 opacity-90">
            东方财富实时净值 · 真实 T+1 撮合 · 零风险练手。注册即送
            {" "}
            {fmtYuan(INITIAL_CASH_CENTS)}
            {" "}
            元模拟本金，每日签到再领
            {" "}
            {fmtYuan(CHECKIN_BASE_CENTS)}
            ~
            {fmtYuan(CHECKIN_MAX_CENTS)}
            {" "}
            元。
          </p>
          {/* CTA 容器：flex + wrap + gap——两个 large 按钮在窄屏（390px）下
              依宽度自然换行且保持间距，不再挤成一团（CodeRabbit PR #79 修正） */}
          <div className="mt-6 flex flex-wrap gap-3">
            {/* hero 内 CTA 逻辑与原头图区一致：登录态去我的盘，游客引导注册 */}
            {me
              ? (
                  <>
                    <NavButton type="primary" size="large" to="/me">去我的盘</NavButton>
                    {/* 次按钮是「渐变上的幽灵样式」：antd default 自带白底，
                        只染白字会白底白字看不清（2026-09-09 走查修复）——
                        显式压成半透明白 10% + 毛玻璃，与右侧迷你卡同语言 */}
                    <NavButton size="large" className="!border-white/40 !bg-white/10 !text-white backdrop-blur-sm hover:bg-white/20!" to="/funds">挑只基金</NavButton>
                  </>
                )
              : (
                  <>
                    <NavButton type="primary" size="large" to="/register">免费注册，领 10 万本金</NavButton>
                    {/* 保持原生 <a>：游客态走边缘缓存，SPA 跳转反而绕开缓存（原注释纪律）。
                        幽灵样式同上：半透明白底+毛玻璃，防白底白字 */}
                    <Button size="large" className="!border-white/40 !bg-white/10 !text-white backdrop-blur-sm hover:bg-white/20!" href="/master">先围观主理人的盘</Button>
                  </>
                )}
          </div>
        </div>
      </div>

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
                同一页上一张有边框、一张有阴影，看起来像两套设计。
                静止影改走 shadow-card 类而非内联 style——内联 box-shadow 的
                优先级压过任何类，hover:shadow-card-hover 会永远不生效（Task 5）。
                transition-[box-shadow] + duration-[240ms]：hover 抬升有过渡不生硬 */}
            <Card
              className="h-full shadow-card transition-[box-shadow] duration-[240ms] hover:shadow-card-hover"
              variant="borderless"
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

      {/* 同上：裸 Card 只为拿 className（居中），外观仍对齐 SectionCard；
          阴影与 hover 同 FEATURES 卡（内联 style 会让 hover 失效，见上） */}
      {!me && (
        <Card
          className="text-center shadow-card transition-[box-shadow] duration-[240ms] hover:shadow-card-hover"
          variant="borderless"
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
