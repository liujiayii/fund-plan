import type { ShouldRevalidateFunctionArgs } from "react-router";
/**
 * 单只持仓详情页：`/me/holdings/:code`
 *
 * 支付宝式三段布局（2026-09-07 详情页重构）：
 *   顶部 持仓总览（持有金额主位 + 昨日收益/持有收益/率，右上基金详情入口）
 *   腰部 功能入口 tabs（收益明细/交易记录/定投计划，三个 tab 都只看这只基金；
 *   收益明细 = 单基金口径三件套：摘要两格 + 累计盈亏曲线 + 收益日历，
 *   2026-09-09 起旧独立「累计盈亏」卡并入该 tab——两处数字同源，
 *   分开摆是重复叙事）
 *   份额批次（倒序，最新在前）+ 页底固定操作条（卖出/定投/买入弹抽屉）
 *
 * 口径注意（spec §10）：顶部「持有收益」是浮动口径（市值−成本，赎回后清零），
 * 「累计盈亏」含已实现盈亏与全部费用——两数并存、标签分明；
 * 昨日收益与收益明细 tab 走 getFundProfitDetail（全量归因后过滤单基金），
 * 与 /me、/me/profit 严格同源同口径，两页数字永不打架。
 *
 * ⚠️ 文件名里的 `holdings_` 尾下划线是刻意的：断开与 me.holdings.tsx 的嵌套
 * （flat routes 点号串联=嵌套，父无 <Outlet/> 则子页永远渲染不出来——
 * a17f3a8/999c374 两次同款坑）。/me/holdings 列表页已删除（me-page 重构），
 * 命名保留防止有人「顺手规整」文件名重踩旧坑。
 */
import type { Route } from "./+types/me.holdings_.$code";
import { Button, Col, Row, Space, Table, Tag, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { BuyDrawer } from "~/components/BuyDrawer";
import { DcaDrawer } from "~/components/DcaDrawer";
import { MeTabs } from "~/components/MeTabsPanels";
import { SellDrawer } from "~/components/SellDrawer";
import { BottomActionBar } from "~/components/ui/BottomActionBar";
import { DataRow } from "~/components/ui/DataRow";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account } from "~/db/schema";
import { rateToPercent, SHARE_SCALE, sharesToDisplay } from "~/domain/money";
import { findRedeemRate } from "~/domain/redeem";
import { countDays, resolveConfirmDate, toBeijing } from "~/domain/trading-calendar";
import { getFundProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getDcaPlans, getHoldingDetail } from "~/services/portfolio-service";
import { placeSellOrder } from "~/services/trade";
import { pnlColor } from "~/theme";

const { Title, Text, Paragraph } = Typography;

export function meta({ loaderData }: Route.MetaArgs) {
  // 带 fundName 的标题，浏览器多标签时可辨；loader 抛 404 时兜底通用标题
  const name = loaderData?.detail?.fundName ?? "持仓详情";
  return [{ title: `${name} · 模拟基金` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const code = params.code;

  const detail = await getHoldingDetail(db, user.id, code);
  if (!detail) {
    // 没有这只持仓（或已清仓且 holding 行已不在）→ 404，与 funds.$code 同款
    throw new Response(`没找到 ${code} 的持仓`, { status: 404 });
  }

  // 现金（买入抽屉）、该基金定投计划（定投抽屉）、单基金收益明细
  // （昨日收益 + 收益明细 tab 三件套）三查互相独立，一波并行；
  // getFundProfitDetail 是 2+N 的全量重放（spec §3 方案一）
  const [acc, plans, profit] = await Promise.all([
    db.query.account.findFirst({ where: eq(account.userId, user.id) }),
    getDcaPlans(db, user.id, code),
    getFundProfitDetail(db, user.id, code),
  ]);

  return {
    detail,
    cash: acc?.cash ?? 0,
    plans,
    profit,
    // 现在下单会落到哪个确认日（卖出试算持有天数用）
    confirmDate: resolveConfirmDate(new Date()),
    // 批次「持有天数」列的参照日；server 算好传下去，组件内不 new Date()
    today: toBeijing(new Date()).format("YYYY-MM-DD"),
  };
}

/**
 * 仅 ?tab= 变化（MeTabs 切 tab）时跳过 loader 重跑（CodeRabbit 复审指正）。
 *
 * 本页 loader 含 2+N 的 getFundProfitDetail 全量重放，tab 切换不改变数据，
 * 重跑纯属浪费。同路由换基金（params.code 变化）pathname 也变，走默认重跑。
 * action 提交后的 revalidate（卖出等）走 formMethod 分支保留。
 */
export function shouldRevalidate({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  // 动作提交后的 revalidate 必须保留：卖出下单等依赖它刷新数据
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

/**
 * 卖出是持仓页专属语义（placeSellOrder 需要路由参数的基金上下文），action 只留
 * intent=sell；定投三 intent 已归拢到 /me/dca 的 action，由 DcaDrawer 里的
 * DcaFundPanel 统一提交（持仓页与基金页共用一个真相）。
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);
  const fundCode = params.code;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  try {
    if (intent === "sell") {
      const shares = String(fd.get("shares") ?? "");
      const n = Number(shares);
      if (!Number.isFinite(n) || n <= 0)
        return { error: "请输入正确的份额" };
      await placeSellOrder(db, env, {
        userId: user.id,
        fundCode,
        sharesScaled: Math.round(n * SHARE_SCALE),
      });
      return { ok: true, message: "赎回下单成功，待 T+1 确认后到账" };
    }
    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

/** 盈亏金额带符号：负号 fmtYuan 自带，正数补 +（与 AssetOverviewCard 同款手法） */
function signedYuan(cents: number): string {
  return `${cents > 0 ? "+" : ""}${fmtYuan(cents)}`;
}

/** 日期串 → 「9 月 5 日」（去前导零，与 AssetOverviewCard 同款手法） */
function fmtDateLabel(date: string): string {
  return `${String(Number(date.slice(5, 7)))} 月 ${String(Number(date.slice(8, 10)))} 日`;
}

export default function MeHoldingDetail({ loaderData, params }: Route.ComponentProps) {
  const { detail: d, cash, plans, profit, confirmDate, today } = loaderData;
  const actionUrl = `/me/holdings/${params.code}`;

  // 三抽屉开合。成功反馈全在抽屉壳里（BuyDrawer/SellDrawer 自带 toast+关抽屉，
  // destroyOnHidden 重开即重置输入），页面不再需要旧版的 tick 重挂那套
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [dcaOpen, setDcaOpen] = useState(false);

  // 旧深链兼容：?tab=trade 是 /me 持仓行「卖出」按钮的寻址方式（feat/me-page-refactor）。
  // 其余 tab 值（orders/dca）现在是 MeTabs 的真实 tab 状态（?tab= 直读），
  // 不再需要跳转或开抽屉——只有 trade 消费一次：开卖出抽屉后清参，刷新不重复触发。
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("tab") !== "trade")
      return;
    // eslint-disable-next-line react/set-state-in-effect -- 深链是进场一次性副作用，effect 正是该用的工具
    setSellOpen(true);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("tab");
        return p;
      },
      { replace: true },
    );
    // 依赖 params.code（CodeRabbit 评审）：同路由换基金时组件被复用、不重挂载，
    // 深链须随之重放；同基金内清参/换 tab 不触发（deps 只看 code 与 params 对象）
    // eslint-disable-next-line react/exhaustive-deps -- 刻意只依赖 code
  }, [params.code, searchParams]);

  // 昨日收益：该基金最新有净值交易日的归因收益（净值延迟同步、周末顺延，
  // 标注「截至 M月D日」而非字面的昨天）
  const latestPnl = profit.latest;
  const untilLabel = latestPnl ? `截至 ${fmtDateLabel(latestPnl.date)}` : null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* wrap：窄屏（375px）下基金名 + 代码 + 标签 + 返回按钮一行放不下 */}
      <Space align="baseline" wrap>
        <Title level={3} style={{ margin: 0 }}>{d.fundName}</Title>
        <Text type="secondary">{d.fundCode}</Text>
        {d.fundType && <Tag>{d.fundType}</Tag>}
        {/* 返回 /me（持仓模块在那里）；原 /me/holdings 列表页已删除 */}
        <NavButton size="small" to="/me">← 返回持仓</NavButton>
      </Space>

      {/* 持仓总览：持有金额主位 + 三小格，右上基金详情入口（spec §5.1 ②）。
          animate-fade-up：区块进场淡入（首卡无延迟） */}
      <SectionCard
        title="持仓总览"
        extra={<NavButton size="small" to={`/funds/${d.fundCode}`}>基金详情 →</NavButton>}
        className="animate-fade-up"
      >
        <StatBig label="持有金额" value={fmtYuan(d.marketValueCents)} suffix="元" />
        <Row gutter={[24, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} sm={8}>
            <StatBig
              label="昨日收益"
              value={latestPnl ? signedYuan(latestPnl.dayPnlCents) : "—"}
              suffix={latestPnl ? "元" : undefined}
              color={latestPnl ? pnlColor(latestPnl.dayPnlCents) : undefined}
              size={24}
              extra={untilLabel ?? undefined}
            />
          </Col>
          <Col xs={24} sm={8}>
            {/* 浮动口径：市值−成本（赎回后即清零，与「累计盈亏」的含已实现口径刻意区分）。
                extra「自 X 持有以来」= 首笔确认日（2026-09-09 从收益明细卡挪来） */}
            <StatBig
              label="持有收益"
              value={signedYuan(d.pnlCents)}
              suffix="元"
              color={pnlColor(d.pnlCents)}
              size={24}
              extra={profit.firstDate ? `自 ${profit.firstDate} 持有以来` : undefined}
            />
          </Col>
          <Col xs={24} sm={8}>
            <StatBig
              label="持有收益率"
              value={`${d.pnlRate > 0 ? "+" : ""}${(d.pnlRate * 100).toFixed(2)}%`}
              color={pnlColor(d.pnlCents)}
              size={24}
            />
          </Col>
        </Row>
      </SectionCard>

      {/* 功能入口 tabs：三个 tab 全部只看这只基金。收益明细传宿主 loader 的
          fundProfit（单基金口径，摘要/曲线/日历三件套都只算这只基金）；
          旧独立「累计盈亏」卡已并入该 tab（内容同源，删除重复叙事）。
          交错进场：第 N 卡延迟 (N-1)×60ms（animate-delay 写法的坑见 uno.config.ts） */}
      <SectionCard className="animate-fade-up animate-delay-[60ms]">
        <MeTabs fundCode={d.fundCode} fundProfit={profit} />
      </SectionCard>

      {/* 份额批次：让 FIFO 阶梯费率这个系统最独特的设计对用户可见（原样保留） */}
      <SectionCard title={`份额批次（${d.lots.length} 批）`} className="animate-fade-up animate-delay-[120ms]">
        {d.lots.length === 0
          ? (
              <EmptyState description="无在持批次" />
            )
          : (
              <>
                {/* 桌面视图：5 列 Table（双渲染，列不动） */}
                <div className="fp-desktop">
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="id"
                    dataSource={d.lots}
                    columns={[
                      { title: "确认日", dataIndex: "confirmDate" },
                      {
                        title: "份额",
                        dataIndex: "sharesScaled",
                        align: "right",
                        render: (v: number) => sharesToDisplay(v),
                      },
                      {
                        title: "成本",
                        dataIndex: "costCents",
                        align: "right",
                        render: (v: number) => `${fmtYuan(v)} 元`,
                      },
                      {
                        title: "持有天数",
                        key: "holdDays",
                        align: "right",
                        render: (_, l) => `${countDays(l.confirmDate, today)} 天`,
                      },
                      {
                        title: "当前费率档",
                        key: "rate",
                        align: "right",
                        // 按今天的持有天数查档，告诉用户「这批现在赎回按几费率」
                        render: (_, l) => rateToPercent(findRedeemRate(d.tiers, countDays(l.confirmDate, today))),
                      },
                    ]}
                  />
                </div>
                {/* 窄屏：批次降级成 DataRow。它是 FIFO 阶梯费率可见性的载体
                    （share_lot 存在的唯一理由），不能只横滚。
                    五字段一个不少：确认日并进标题行「第 N 批 · 日期」。
                    N 是 FIFO 序号（最早 = 第 1 批），列表倒序展示后
                    从尾部倒数取号，语义与赎回消耗顺序一致 */}
                <div className="fp-mobile">
                  {d.lots.map((l, i) => (
                    <div key={l.id} style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 13 }}>
                        第
                        {" "}
                        {d.lots.length - i}
                        {" "}
                        批 ·
                        {" "}
                        {l.confirmDate}
                      </Text>
                      <DataRow label="份额" value={`${sharesToDisplay(l.sharesScaled)} 份`} mono />
                      <DataRow label="成本" value={`${fmtYuan(l.costCents)} 元`} mono />
                      <DataRow label="持有天数" value={`${countDays(l.confirmDate, today)} 天`} mono />
                      <DataRow
                        label="当前费率档"
                        value={rateToPercent(findRedeemRate(d.tiers, countDays(l.confirmDate, today)))}
                        mono
                        last
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          赎回按批次先进先出，每批按各自持有天数查费率档——
          所以一笔赎回可能同时按多档费率计费。「卖出」抽屉里可试算明细。
        </Paragraph>
      </SectionCard>

      {/* 页底固定操作条：卖出 / 定投 / 买入。按钮语义与禁用逻辑原样来自旧「交易操作」卡 */}
      <BottomActionBar
        note={d.availableShares <= 0
          ? "无可卖份额（待确认赎回单占用或已全部赎回）"
          : "卖出按批次先进先出逐批计费；买入按 T+1 确认，现金在下单时冻结。"}
        actions={(
          <Space size={16} wrap>
            <Button
              size="large"
              onClick={() => setSellOpen(true)}
              disabled={d.availableShares <= 0}
            >
              卖出
            </Button>
            <Button size="large" onClick={() => setDcaOpen(true)}>
              定投
            </Button>
            <Button
              type="primary"
              size="large"
              onClick={() => setBuyOpen(true)}
              disabled={!(d.navScaled > 0)}
            >
              买入
            </Button>
          </Space>
        )}
      />

      {/* 三抽屉：买入（现有壳）/ 卖出 / 定投（Task 7 壳） */}
      <BuyDrawer
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        fundCode={d.fundCode}
        fundName={d.fundName}
        purchaseRate={d.purchaseRate}
        minPurchaseCents={d.minPurchase}
        navScaled={d.navScaled}
        navDate={d.navDate}
        cashCents={cash}
        action="/me/trade"
      />
      <SellDrawer
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        fundCode={d.fundCode}
        fundName={d.fundName}
        availableSharesScaled={d.availableShares}
        navScaled={d.navScaled}
        navDate={d.navDate}
        lots={d.lots}
        tiers={d.tiers}
        confirmDate={confirmDate}
        action={actionUrl}
      />
      <DcaDrawer
        open={dcaOpen}
        onClose={() => setDcaOpen(false)}
        fundCode={d.fundCode}
        fundName={d.fundName}
        plans={plans}
      />
    </Space>
  );
}
