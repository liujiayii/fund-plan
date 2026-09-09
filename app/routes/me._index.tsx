import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/me._index";
import type { HoldingView } from "~/services/portfolio-service";
import {
  Alert,
  Button,
  Col,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { BuyDrawer } from "~/components/BuyDrawer";
import { HoldingList, sharesAndNavNote } from "~/components/HoldingList";
import { MeTabs } from "~/components/MeTabsPanels";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { CHECKIN_MAX_CENTS } from "~/domain/checkin";
import { getAssetTimeline } from "~/services/asset-service";
import { doCheckin, getCheckinStatus } from "~/services/checkin-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getPendingBuyCents, getPortfolio } from "~/services/portfolio-service";
import { COLOR } from "~/theme";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的仪表盘 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  // 在途资金（pending 买单）单独一查：/me 总览卡把「申购中」并回持仓金额与总资产；
  // /master 与首页刻意不查（公开镜像保持纯市值口径，别多背查询）
  const [portfolio, checkinStatus, timeline, pendingBuyCents] = await Promise.all([
    getPortfolio(db, user.id),
    getCheckinStatus(db, user.id),
    getAssetTimeline(db, user.id),
    getPendingBuyCents(db, user.id),
  ]);

  return { user, portfolio, checkinStatus, timeline, pendingBuyCents };
}

/**
 * 仅 ?tab= 变化（MeTabs 切 tab）时跳过 loader 重跑（CodeRabbit 复审指正）。
 *
 * 本页 loader 是 12+ 条 D1 查询（组合/签到/时间线/在途），tab 切换不改变
 * 任何数据，重跑纯属浪费——大陆慢链路下每次点 tab 都平白多一轮往返。
 * 其余一切导航（含 action 提交后的 revalidate，formMethod 非 GET）走默认。
 */
export function shouldRevalidate({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  // 动作提交后的 revalidate 必须保留：签到/撤单等依赖它刷新数据
  if (formMethod && formMethod !== "GET")
    return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname)
    return true;
  const c = new URLSearchParams(currentUrl.search);
  const n = new URLSearchParams(nextUrl.search);
  c.delete("tab");
  n.delete("tab");
  return c.toString() !== n.toString();
}

/** 签到 action */
export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  try {
    const r = await doCheckin(db, user.id);
    return {
      ok: true,
      message: `签到成功！连签第 ${r.streak} 天，领取 ${fmtYuan(r.reward)} 元`,
    };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "签到失败" };
  }
}

/**
 * Renders the authenticated user's dashboard with asset data, check-in actions, and holdings management.
 *
 * @param loaderData - Data loaded for the current user and dashboard, including portfolio, check-in, timeline, and pending purchase information.
 * @returns The user's dashboard page.
 */
export default function MeIndex({ loaderData }: Route.ComponentProps) {
  const { user, portfolio, checkinStatus, timeline, pendingBuyCents } = loaderData;
  // summary 的合计市值供持仓卡标题用；其余总览数字全部交给 AssetOverviewCard
  const { summary, holdings } = portfolio;
  const fetcher = useFetcher<typeof action>();
  const signing = fetcher.state === "submitting";

  // 持仓排序：持有金额（市值）/ 持有收益两键切换，降序；默认持有金额。
  // 客户端排——持仓数据 loader 已全量带回，几十只以内零成本
  const [sortKey, setSortKey] = useState<"amount" | "pnl">("amount");
  const sortedHoldings = useMemo(
    () =>
      [...holdings].sort((a, b) =>
        sortKey === "amount"
          ? b.marketValueCents - a.marketValueCents
          : b.pnlCents - a.pnlCents),
    [holdings, sortKey],
  );

  // 行内买入：单实例 BuyDrawer（比每行一个抽屉省 DOM）+ 双状态——
  // buyOpen 管开合、buyTarget 管数据。关闭动画播放期间 buyTarget 保持不变，
  // 抽屉退场时仍有数据可画，不会闪成空壳（自选页 PR #32 同款模式，下单成功
  // 自动关抽屉也走这条路）；输入重置由 BuyDrawer 的 destroyOnHidden 兜底。
  // 数据全来自 loader 现成字段：费率/起购是 HoldingView 新透出的，现金取 summary
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyTarget, setBuyTarget] = useState<HoldingView | null>(null);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {user.username}
          {" "}
          的模拟盘
          {user.role === "admin" && <Tag color="blue" style={{ marginLeft: 8 }}>主理人</Tag>}
        </Title>
        {user.role === "admin" && (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            你的盘是公开示范盘，所有访客都能在
            {" "}
            <a href="/master">/master</a>
            {" "}
            围观。
          </Paragraph>
        )}
      </div>

      {/* 资产总览：总资产主位 + 一行四格（口径注释见 AssetOverviewCard）。
          pendingBuyCents 把申购中在途并回持仓金额与总资产（仅 /me）。
          animate-fade-up：区块进场淡入（首卡无延迟） */}
      <SectionCard className="animate-fade-up">
        <AssetOverviewCard
          summary={portfolio.summary}
          daily={timeline.daily}
          latest={timeline.latest}
          totalDepositedCents={timeline.totalDepositedCents}
          pendingBuyCents={pendingBuyCents}
        />
      </SectionCard>

      {/* 每日签到（主人 2026-09-09 要求上移：领本金是高频动作，放在功能入口之前）。
          交错进场：第 N 卡延迟 (N-1)×60ms（animate-delay 写法的坑见 uno.config.ts） */}
      <SectionCard title="每日签到领本金" className="animate-fade-up animate-delay-[60ms]">
        {fetcher.data?.ok && (
          <Alert type="success" showIcon message={fetcher.data.message} style={{ marginBottom: 16 }} />
        )}
        {fetcher.data?.error && (
          <Alert type="error" showIcon message={fetcher.data.error} style={{ marginBottom: 16 }} />
        )}

        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={8}>
            <StatBig label="当前连签" value={checkinStatus.streak} suffix="天" size={24} />
          </Col>
          <Col xs={24} md={8}>
            {/* ⚠️ 签到金额用主色蓝而非涨红：这是「领取本金」的操作引导，
                不是投资收益。用红色会让人误以为赚了钱 */}
            <StatBig
              label={checkinStatus.checkedToday ? "明天可领" : "今天可领"}
              value={fmtYuan(checkinStatus.nextReward)}
              suffix="元"
              size={24}
              color={COLOR.primary}
            />
            <Progress
              percent={Math.round((checkinStatus.nextReward / CHECKIN_MAX_CENTS) * 100)}
              size="small"
              showInfo={false}
              style={{ marginTop: 8 }}
              // ⚠️ strokeColor 必须显式传，不能删。
              // antd 在 percent >= 100 且未显式传 status 时会自动切成
              // status="success"（antd/lib/progress/progress.js:66-68），
              // 进度条变**绿** —— 而绿色在本项目专属「跌」。
              // 连签封顶正是 percent === 100，会渲染出一条绿色进度条，读作亏损。
              strokeColor={COLOR.primary}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              连签递增，每天 +50 元，封顶 500 元
            </Text>
          </Col>
          <Col xs={24} md={8}>
            <StatBig
              label="累计签到入金"
              value={fmtYuan(checkinStatus.totalCheckin)}
              suffix="元"
              size={24}
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
                {checkinStatus.checkedToday ? "今日已签到" : "立即签到"}
              </Button>
            </fetcher.Form>
          </Col>
        </Row>
      </SectionCard>

      {/* 功能入口 tabs：收益明细/交易记录/定投计划页内切换 + 后台懒加载
          （旧 QuickEntries 跳页退役；三个深链路由保留，外链照常可用） */}
      <SectionCard className="animate-fade-up animate-delay-[120ms]">
        <MeTabs />
      </SectionCard>

      {/* 我的持仓：原 /me/holdings 列表页的职能全部并入——
          标题带只数与合计市值（总资产−可用余额可推导，但直接给更省脑），
          行内详情/卖出深链，底部批次说明 */}
      <SectionCard
        title={`我的持仓（${holdings.length} 只 · 市值 ${fmtYuan(summary.marketValueCents)} 元）`}
        className="animate-fade-up animate-delay-[180ms]"
        extra={(
          <PeriodTabs
            options={[
              { key: "amount", label: "持有金额" },
              { key: "pnl", label: "持有收益" },
            ]}
            value={sortKey}
            onChange={v => setSortKey(v as "amount" | "pnl")}
          />
        )}
      >
        {holdings.length === 0
          ? (
              <EmptyState description="还没有持仓">
                <NavButton type="primary" to="/funds">
                  去挑一只基金
                </NavButton>
              </EmptyState>
            )
          : (
              <>
                <HoldingList
                  holdings={sortedHoldings}
                  // 份额 + 估值时点 + 成本（批次数/待赎回在单只详情页）
                  renderNote={h => `${sharesAndNavNote(h)} · 成本 ${fmtYuan(h.costCents)} 元`}
                  // 行点进单只持仓详情，不链基金详情页
                  getHref={h => `/me/holdings/${h.fundCode}`}
                  // 行内「买入 / 卖出」：买入开抽屉不跳页（自选页 PR #32 同款模式）；
                  // 「详情」按钮撤下——行本身可点进单只持仓详情，窄屏也少挤一个按钮
                  renderActions={h => (
                    <Space size={8}>
                      <Button
                        size="small"
                        // 无净值无法定价（与基金详情页买入按钮同一守卫语义）
                        disabled={!(h.navScaled > 0)}
                        onClick={() => {
                          setBuyTarget(h);
                          setBuyOpen(true);
                        }}
                      >
                        买入
                      </Button>
                      <NavButton size="small" type="primary" to={`/me/holdings/${h.fundCode}?tab=trade`}>
                        卖出
                      </NavButton>
                    </Space>
                  )}
                />
                <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                  「批次」是同一只基金分次买入形成的份额批，赎回时按买入时间先进先出消耗，
                  每批按各自持有天数计赎回费。
                </Paragraph>
              </>
            )}
      </SectionCard>

      {/* 行内买入抽屉：提交到 /me/trade 资源路由（全站买入统一入口）。
          onClose 只收 buyOpen——buyTarget 保留数据撑完退场动画，不闪空壳；
          destroyOnHidden 保证重开时输入重置 */}
      <BuyDrawer
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        fundCode={buyTarget?.fundCode ?? ""}
        fundName={buyTarget?.fundName ?? ""}
        purchaseRate={buyTarget?.purchaseRate ?? 0}
        minPurchaseCents={buyTarget?.minPurchase ?? 0}
        navScaled={buyTarget?.navScaled ?? 0}
        navDate={buyTarget?.navDate ?? null}
        cashCents={summary.cashCents}
        action="/me/trade"
      />
    </Space>
  );
}
