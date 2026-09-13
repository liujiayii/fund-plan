import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/me._index";
import type { HoldingView } from "~/services/portfolio-service";
import {
  Button,
  Col,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { BuyDrawer } from "~/components/BuyDrawer";
import { CheckinPanel } from "~/components/CheckinPanel";
import { HoldingList, sharesAndNavNote } from "~/components/HoldingList";
import { MeTabs } from "~/components/MeTabsPanels";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { SectionCard } from "~/components/ui/SectionCard";
import { TRADE_CUTOFF_HOUR } from "~/domain/config";
import { pageMeta } from "~/domain/seo";
import { isTradingDay, resolveConfirmDate, toBeijing } from "~/domain/trading-calendar";
import { getAssetTimeline } from "~/services/asset-service";
import { doCheckin, getCheckinStatus } from "~/services/checkin-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getPendingBuyCents, getPortfolio } from "~/services/portfolio-service";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "我的仪表盘", path: "/me", index: false });
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

  // 交易时钟（纯函数，零查询）：告诉用户「现在下单按哪天净值」——T+1 模拟盘里
  // 这是最常被问的问题，此前只藏在买入面板的一行小字里。服务端算一次，
  // 客户端不重算，避免跨过 15:00 时 SSR / 水合各算一个
  const now = new Date();
  const bj = toBeijing(now);
  const today = bj.format("YYYY-MM-DD");
  const clock = {
    today,
    isTradingDay: isTradingDay(today),
    beforeCutoff: bj.hour() < TRADE_CUTOFF_HOUR,
    confirmDate: resolveConfirmDate(now),
  };

  return { user, portfolio, checkinStatus, timeline, pendingBuyCents, clock };
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

export default function MeIndex({ loaderData }: Route.ComponentProps) {
  const { user, portfolio, checkinStatus, timeline, pendingBuyCents, clock } = loaderData;
  // summary 的合计市值供持仓卡标题用；其余总览数字全部交给 AssetOverviewCard
  const { summary, holdings } = portfolio;
  // 签到 fetcher：桌面签到卡与窄屏签到井共用（CheckinPanel 双渲染），提交态由面板自己读
  const fetcher = useFetcher<typeof action>();
  // 交易时钟跨边界刷新（CodeRabbit PR #80 指正）：clock 是 loader 服务端算的，
  // 页面开着跨过 15:00 / 午夜不会自己更新——「现在下单按哪天净值」会 stale，
  // 且 POST /me/trade 服务端按当下重算，展示与实际撮合口径分叉。
  // 到下一个边界（15:00 或 0 点，先到者）revalidate 一次，让 loader 重算 clock。
  // revalidate 有全页数据成本，但只在真实跨界的长驻页面发生，频率可忽略
  const revalidator = useRevalidator();
  useEffect(() => {
    // 边界是**北京时间**的 15:00 / 0 点：用 UTC 算，不碰浏览器本地时区
    // （本地 setHours 在海外时区会把触发点算到别的钟点，CodeRabbit 复审指正）。
    // 现在的北京时刻 → 取北京日期拼下一个边界钟点 → 换回 UTC 时间戳
    const bjNow = toBeijing(new Date());
    const bjMinutes = bjNow.hour() * 60 + bjNow.minute();
    const cutoff = TRADE_CUTOFF_HOUR * 60; // 15:00
    // 下一个 15:00：还没到今天的 15:00 是今天，过了就是明天
    const bjCutoffDay = bjMinutes < cutoff ? bjNow : bjNow.add(1, "day");
    const bjCutoff = bjCutoffDay.hour(TRADE_CUTOFF_HOUR).minute(0).second(0);
    // 下一个午夜：dayjs 无「明天 0 点」直接算式，+1 天再清零钟点
    const bjMidnight = bjNow.add(1, "day").hour(0).minute(0).second(0);
    // 两个 UTC 时间戳取先到者；subtract(8h) 是 toBeijing 加偏移的逆运算
    const targetMs = Math.min(
      bjCutoff.valueOf() - 8 * 3600_000,
      bjMidnight.valueOf() - 8 * 3600_000,
    );
    const timer = setTimeout(() => revalidator.revalidate(), targetMs - Date.now());
    return () => clearTimeout(timer);
    // 依赖含 beforeCutoff：15:00 边界刷新后 today 不变（同一天），只有截单态翻转，
    // 不挂它的话午夜的下一次刷新没人排（CodeRabbit PR #80 指正的续作）
  }, [revalidator, clock.today, clock.beforeCutoff]);

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
          {user.role === "admin" && <Tag style={{ marginLeft: 8 }}>主理人</Tag>}
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
        {/* 交易时钟：一行井，状态点走 pending（在途语义）/ 三级色（休市）。
            日期是 loader 服务端算好的，不在客户端重算 */}
        <div className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-well px-4 py-1.5 text-xs text-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${clock.isTradingDay && clock.beforeCutoff ? "bg-pending" : "bg-tertiary"}`} />
          <span>
            {clock.today}
            {" "}
            {clock.isTradingDay ? (clock.beforeCutoff ? "交易中" : "已过 15:00 截单") : "休市"}
          </span>
          <span className="text-tertiary">·</span>
          <span>
            现在下单按
            {" "}
            <span className="font-num text-ink">{clock.confirmDate}</span>
            {" "}
            净值确认
          </span>
        </div>
      </div>

      {/* 钱：总览（左 2/3）+ 签到（右 1/3）并排（liquid-glass spec §5.1）。
          窄屏签到收成总览卡底一条井（CheckinPanel compact，.fp-mobile），
          桌面独立卡（.fp-desktop）——双渲染同一 fetcher，无逻辑分叉。
          总览卡是门面：挂 fp-glass-specular 高光（宪法 §2.3 白名单）。
          pendingBuyCents 把申购中在途并回持仓金额与总资产（仅 /me） */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={16}>
          <SectionCard className="animate-fade-up fp-glass-specular h-full">
            <AssetOverviewCard
              summary={portfolio.summary}
              daily={timeline.daily}
              latest={timeline.latest}
              totalDepositedCents={timeline.totalDepositedCents}
              pendingBuyCents={pendingBuyCents}
            />
            <div className="fp-mobile">
              <CheckinPanel status={checkinStatus} fetcher={fetcher} compact />
            </div>
          </SectionCard>
        </Col>
        {/* Col xs={0} 等价 display:none，与 .fp-desktop 双保险；md 起显示 */}
        <Col xs={0} md={8} className="fp-desktop">
          <SectionCard title="每日签到领本金" className="animate-fade-up animate-delay-[60ms] h-full">
            <CheckinPanel status={checkinStatus} fetcher={fetcher} />
          </SectionCard>
        </Col>
      </Row>

      {/* 仓：持仓紧跟钱（390 首屏必须露出至少一行，spec §5.1）。
          标题带只数与合计市值，行内详情/卖出深链，底部批次说明 */}
      <SectionCard
        title={`我的持仓（${holdings.length} 只 · 市值 ${fmtYuan(summary.marketValueCents)} 元）`}
        className="animate-fade-up animate-delay-[120ms]"
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

      {/* 账：收益明细 / 交易记录 / 定投计划 tabs 垫底
          （?tab= 深链与懒加载不变；旧 QuickEntries 跳页退役） */}
      <SectionCard className="animate-fade-up animate-delay-[180ms]">
        <MeTabs />
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
