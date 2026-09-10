import type { Route } from "./+types/_index";
import { Button, Col, Row, Space, Tag, Typography } from "antd";
import { Link } from "react-router";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { AdminNotReady } from "~/components/PortfolioView";
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
    // 示范盘两件套（总览+走势）的序列数据；日历撤下（liquid-glass spec §5.2），「最近操作」早已撤，orders 不再查
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
      {/* hero（liquid-glass spec §5.2）：色雾即背景，玻璃卡装标语 + CTA；门面高光白名单。
          裸 section 挂 fp-glass（不是 SectionCard：hero 没有标题栏语义）。
          fp-hero：窄屏内距收窄在 responsive.css */}
      <section className="fp-hero fp-glass fp-glass-specular animate-fade-up relative overflow-hidden rounded-[22px] px-10 py-12">
        {/* 右侧迷你示例卡：井格（不再各自模糊，宪法 §3 玻璃不叠玻璃）。
            数值是装饰性示例（模拟盘语境下不标注会被当成主理人真实收益） */}
        <div className="absolute top-8 right-8 hidden gap-3 lg:flex lg:flex-col">
          <div className="rounded-[12px] bg-well px-4 py-3">
            <div className="text-xs text-muted">
              昨日收益
              <span className="text-placeholder">（示例）</span>
            </div>
            <div className="font-num text-lg font-medium text-rise">+82.33 元</div>
          </div>
          <div className="rounded-[12px] bg-well px-4 py-3">
            <div className="text-xs text-muted">
              累计收益
              <span className="text-placeholder">（示例）</span>
            </div>
            <div className="font-num text-lg font-medium text-rise">+2,310.66 元</div>
          </div>
        </div>

        <div className="relative z-10">
          <div className="mb-3 flex items-center gap-2 text-sm tracking-wide text-muted">
            <Logo size={22} />
            模拟基金
          </div>
          {/* 主标：文案结构（真实感 + 零风险）沿用 visual-refresh */}
          <h2 className="m-0 text-3xl leading-tight font-bold text-ink">用真数据，练真盘感</h2>
          <p className="mt-3 mb-0 max-w-xl text-sm leading-6 text-muted">
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
          {/* CTA：主 = 紫药丸（antd primary 已吃品牌紫），次 = 玻璃胶囊（default 已是井底+描边）。
              flex-wrap：390px 下两个 large 按钮自然换行 */}
          <div className="mt-6 flex flex-wrap gap-3">
            {/* 登录态去我的盘，游客引导注册 */}
            {me
              ? (
                  <>
                    <NavButton type="primary" size="large" shape="round" to="/me">去我的盘</NavButton>
                    <NavButton size="large" shape="round" to="/funds">挑只基金</NavButton>
                  </>
                )
              : (
                  <>
                    <NavButton type="primary" size="large" shape="round" to="/register">免费注册，领 10 万本金</NavButton>
                    {/* 保持原生 <a>：游客态走边缘缓存，SPA 跳转反而绕开缓存 */}
                    <Button size="large" shape="round" href="/master">先围观主理人的盘</Button>
                  </>
                )}
          </div>
        </div>
      </section>

      {/* 示范盘减重（spec §5.2）：总览四格 + 走势；日历从引流页拿走（操盘工具不该在引流页）。
          /master 完整三件套不动 */}
      {loaderData.admin === null
        ? (
            <AdminNotReady adminName={loaderData.adminName} />
          )
        : (
            <SectionCard
              className="animate-fade-up animate-delay-[60ms]"
              title={(
                <span>
                  主理人的示范盘
                  <Tag style={{ marginLeft: 8 }}>公开</Tag>
                </span>
              )}
              extra={<a href="/master">查看完整组合 →</a>}
            >
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
                </>
              )}
            </SectionCard>
          )}

      {/* 平台数据：社交证明，一卡六格（不动）。计数为纯整数指标，不涉及精度铁律。
          访问（次）与访客（人）分开摆：PV 是热度、UV 是 reach，口径混了会被内行看出业余 */}
      <SectionCard
        className="animate-fade-up animate-delay-[120ms]"
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

      {/* 排行榜引流：游客与已登录都给入口（移动端底部胶囊进不去排行榜，这是移动端唯一入口） */}
      <SectionCard
        className="animate-fade-up animate-delay-[180ms]"
        title="收益排行榜"
        extra={<Link to="/leaderboard">看完整榜单 →</Link>}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          全站用户的模拟盘同台竞技：收益率、总收益两个维度实时排名。
          注册开第一单，看看你能不能排到主理人前面。
        </Paragraph>
        <NavButton type="primary" shape="round" to="/leaderboard">
          去看排行榜
        </NavButton>
      </SectionCard>

      {/* 卖点：一张玻璃卡 + 四个井格（宪法 §4 预算：4 张各自玻璃会把首页推到 10+ 模糊节点）。
          桌面 4 列 / 窄屏 2×2 用 grid 工具类 */}
      <SectionCard title="这不是玩具" className="animate-fade-up animate-delay-[240ms]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-[12px] bg-well p-4">
              <div className="mb-1 font-medium text-ink">{f.title}</div>
              <div className="text-xs leading-5 text-muted">{f.desc}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 底 CTA（游客） */}
      {!me && (
        <SectionCard className="animate-fade-up animate-delay-[300ms] text-center">
          <Title level={4}>准备好开自己的盘了吗？</Title>
          <Paragraph type="secondary">
            用户名 + 密码即可注册，不用邮箱、不用手机号。
          </Paragraph>
          <NavButton type="primary" size="large" shape="round" to="/register">
            立即注册
          </NavButton>
        </SectionCard>
      )}
    </Space>
  );
}
