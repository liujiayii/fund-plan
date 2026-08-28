/**
 * 单只持仓详情页：`/me/holdings/:code`
 *
 * 与 `/me/holdings` 列表同源估值（都走 `getHoldingDetail`/`getPortfolio` 背后的
 * `valuateHolding`），额外展示份额批次明细——把 FIFO 阶梯费率这个系统最独特的
 * 设计对用户可见，并提供加仓/卖出/该基金交易流水三个入口。
 */
import type { Route } from "./+types/me.holdings.$code";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { BuyPanel } from "~/components/BuyPanel";
import { OrderList } from "~/components/OrderList";
import { SellPanel } from "~/components/SellPanel";
import { DataRow } from "~/components/ui/DataRow";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account } from "~/db/schema";
import { navToDisplay, rateToPercent, SHARE_SCALE, sharesToDisplay, yuanToCents } from "~/domain/money";
import { findRedeemRate } from "~/domain/redeem";
import { countDays, resolveConfirmDate, toBeijing } from "~/domain/trading-calendar";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getHoldingDetail, getOrdersByFund } from "~/services/portfolio-service";
import { placeBuyOrder, placeSellOrder } from "~/services/trade";
import { pnlColor } from "~/theme";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "持仓详情 · 模拟基金" }];
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

  const acc = await db.query.account.findFirst({ where: eq(account.userId, user.id) });
  const orders = await getOrdersByFund(db, user.id, code);

  return {
    detail,
    cash: acc?.cash ?? 0,
    orders,
    // 现在下单会落到哪个确认日（卖出试算持有天数用）
    confirmDate: resolveConfirmDate(new Date()),
    // 批次「持有天数」列的参照日；server 算好传下去，组件内不 new Date()
    today: toBeijing(new Date()).format("YYYY-MM-DD"),
  };
}

/** 加仓与赎回共用 action，intent 区分（从 me.holdings 原样迁来） */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);
  const fundCode = params.code;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  try {
    if (intent === "buy") {
      const amount = String(fd.get("amount") ?? "");
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0)
        return { error: "请输入正确的金额" };
      await placeBuyOrder(db, env, { userId: user.id, fundCode, amountCents: yuanToCents(amount) });
      return { ok: true, message: "加仓下单成功，待 T+1 确认" };
    }
    if (intent === "sell") {
      const shares = String(fd.get("shares") ?? "");
      const n = Number(shares);
      if (!Number.isFinite(n) || n <= 0)
        return { error: "请输入正确的份额" };
      await placeSellOrder(db, env, { userId: user.id, fundCode, sharesScaled: Math.round(n * SHARE_SCALE) });
      return { ok: true, message: "赎回下单成功，待 T+1 确认后到账" };
    }
    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

export default function MeHoldingDetail({ loaderData, params }: Route.ComponentProps) {
  const { detail: d, cash, orders, confirmDate, today } = loaderData;
  const fetcher = useFetcher<typeof action>();
  // tick：提交成功后自增，作为 key 强制 BuyPanel/SellPanel 重新挂载，清空输入框
  const [tick, setTick] = useState(0);
  const actionUrl = `/me/holdings/${params.code}`;

  // 提交成功后强制重挂面板清空输入。同 me.dca.tsx 的定向豁免：
  // 这是「异步提交完成后触发副作用」而非「用 effect 同步派生状态」，
  // effect 正是该用的工具。
  useEffect(() => {
    if (fetcher.data?.ok) {
      // eslint-disable-next-line react/set-state-in-effect
      setTick(t => t + 1);
    }
  }, [fetcher.data]);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* wrap：窄屏（375px）下基金名 + 代码 + 标签 + 返回按钮一行放不下，
          允许换行避免把标题挤成竖排（Task 8） */}
      <Space align="baseline" wrap>
        <Title level={3} style={{ margin: 0 }}>{d.fundName}</Title>
        <Text type="secondary">{d.fundCode}</Text>
        {d.fundType && <Tag>{d.fundType}</Tag>}
        <Button size="small" href="/me/holdings">← 返回持仓</Button>
      </Space>

      {fetcher.data?.ok && <Alert type="success" showIcon message={fetcher.data.message} closable />}
      {fetcher.data?.error && <Alert type="error" showIcon message={fetcher.data.error} closable />}

      {/* 持仓概览：与 /me/holdings 列表同源估值 */}
      <SectionCard title="持仓概览">
        {/* [16,16]：统计行间距降档（Task 10），窄屏折行后 rowGap 不再是 48 */}
        <Space size={[16, 16]} wrap>
          <StatBig label="持有市值" value={fmtYuan(d.marketValueCents)} suffix="元" />
          <StatBig label="持有收益" value={`${d.pnlCents > 0 ? "+" : ""}${fmtYuan(d.pnlCents)}`} suffix="元" size={24} color={pnlColor(d.pnlCents)} />
          <StatBig label="成本" value={fmtYuan(d.costCents)} suffix="元" size={24} />
          <StatBig label="持有份额" value={sharesToDisplay(d.sharesScaled)} suffix="份" size={24} />
          {d.navDate && <StatBig label={`净值（${d.navDate}）`} value={navToDisplay(d.navScaled)} size={24} />}
        </Space>
      </SectionCard>

      {/* 份额批次：让 FIFO 阶梯费率这个系统最独特的设计对用户可见 */}
      <SectionCard title={`份额批次（${d.lots.length} 批）`}>
        {d.lots.length === 0
          ? (
              <EmptyState description="无在持批次" />
            )
          : (
              <>
                {/* 桌面视图：原 5 列 Table 原样保留（Task 8 双渲染，列不动） */}
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
                    （share_lot 存在的唯一理由），不能只横滚（spec §7）。
                    五字段一个不少：确认日并进标题行「第 N 批 · 日期」，
                    其余四项各占一行 DataRow */}
                <div className="fp-mobile">
                  {d.lots.map((l, i) => (
                    <div key={l.id} style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 13 }}>
                        第
                        {" "}
                        {i + 1}
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
          所以一笔赎回可能同时按多档费率计费。下方「卖出」面板可试算明细。
        </Paragraph>
      </SectionCard>

      {/* 加仓·卖出·定投 三入口 */}
      {d.navScaled > 0 && (
        <SectionCard title="加仓">
          <BuyPanel
            key={`buy-${tick}`}
            fundCode={d.fundCode}
            fundName={d.fundName}
            purchaseRate={d.purchaseRate}
            minPurchaseCents={d.minPurchase}
            navScaled={d.navScaled}
            navDate={d.navDate}
            cashCents={cash}
            action={actionUrl}
          />
        </SectionCard>
      )}

      {d.availableShares > 0 && d.lots.length > 0 && (
        <SectionCard title="卖出">
          <SellPanel
            key={`sell-${tick}`}
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
        </SectionCard>
      )}

      <Button href="/me/dca">设置/管理定投 →</Button>

      {/* 该基金交易流水 */}
      <SectionCard title={`该基金交易（${orders.length} 笔）`}>
        {orders.length === 0 ? <EmptyState description="还没有该基金的交易记录" /> : <OrderList orders={orders} detailed />}
      </SectionCard>
    </Space>
  );
}
