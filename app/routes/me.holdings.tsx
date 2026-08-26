import type { Route } from "./+types/me.holdings";
import type { RedeemTier } from "~/domain/redeem";
import type { HoldingView } from "~/services/portfolio-service";
import {
  Alert,
  Button,
  Space,
  Typography,
} from "antd";
import { and, eq, sql } from "drizzle-orm";
import { useState } from "react";
import { useFetcher } from "react-router";
import { BuyDrawer } from "~/components/BuyDrawer";
import { HoldingList } from "~/components/HoldingList";
import { SellDrawer } from "~/components/SellDrawer";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account, fund, orders, shareLot } from "~/db/schema";
import { navToDisplay, SHARE_SCALE, sharesToDisplay, yuanToCents } from "~/domain/money";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { resolveConfirmDate } from "~/domain/trading-calendar";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getPortfolio } from "~/services/portfolio-service";
import { placeBuyOrder, placeSellOrder } from "~/services/trade";
import { pnlColor } from "~/theme";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的持仓 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  const portfolio = await getPortfolio(db, user.id);
  const acc = await db.query.account.findFirst({
    where: eq(account.userId, user.id),
  });

  // 为每只持仓准备赎回所需的批次与费率，供抽屉做 FIFO 试算
  const details = await Promise.all(
    portfolio.holdings.map(async (h) => {
      const lots = await db
        .select()
        .from(shareLot)
        .where(
          and(eq(shareLot.userId, user.id), eq(shareLot.fundCode, h.fundCode)),
        )
        .orderBy(shareLot.confirmDate, shareLot.id);

      // 待确认的赎回单占用的份额，不能重复赎回
      const pend = await db
        .select({ total: sql<number>`coalesce(sum(${orders.shares}), 0)` })
        .from(orders)
        .where(
          and(
            eq(orders.userId, user.id),
            eq(orders.fundCode, h.fundCode),
            eq(orders.side, "sell"),
            eq(orders.status, "pending"),
          ),
        );
      const pendingShares = Number(pend[0]?.total ?? 0);

      const f = await db.query.fund.findFirst({
        where: eq(fund.code, h.fundCode),
      });

      return {
        fundCode: h.fundCode,
        lots: lots.map(l => ({
          id: l.id,
          sharesScaled: l.shares,
          costCents: l.cost,
          confirmDate: l.confirmDate,
        })),
        pendingShares,
        availableShares: h.sharesScaled - pendingShares,
        tiers: (f?.redeemTiers as RedeemTier[]) ?? DEFAULT_REDEEM_TIERS,
        purchaseRate: f?.purchaseRate ?? 0,
        minPurchase: f?.minPurchase ?? 1000,
      };
    }),
  );

  return {
    portfolio,
    details,
    cash: acc?.cash ?? 0,
    // 现在下单会落到哪个确认日，供抽屉展示与试算持有天数
    confirmDate: resolveConfirmDate(new Date()),
  };
}

/** 买入与赎回共用一个 action，用 intent 区分 */
export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);

  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const fundCode = String(fd.get("fundCode") ?? "");

  try {
    if (intent === "buy") {
      const amount = String(fd.get("amount") ?? "");
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0)
        return { error: "请输入正确的金额" };
      await placeBuyOrder(db, env, {
        userId: user.id,
        fundCode,
        amountCents: yuanToCents(amount),
      });
      return { ok: true, message: "加仓下单成功，待 T+1 确认" };
    }

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

export default function MeHoldings({ loaderData }: Route.ComponentProps) {
  const { portfolio, details, cash, confirmDate } = loaderData;
  const { summary, holdings } = portfolio;
  const fetcher = useFetcher<typeof action>();

  const [buyTarget, setBuyTarget] = useState<HoldingView | null>(null);
  const [sellTarget, setSellTarget] = useState<HoldingView | null>(null);

  const detailOf = (code: string) => details.find(d => d.fundCode === code)!;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的持仓
      </Title>

      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} closable />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} closable />
      )}

      <SectionCard>
        {/* 三个数都用次位 24：本页没有「总资产」，但「持仓市值」在 /me 与 / 上都是
            24，字号跟着**标签**走而不是跟着「本页第几个」走，同一个词换页不变大小 */}
        <Space size={48} wrap>
          <StatBig
            label="持仓市值"
            value={fmtYuan(summary.marketValueCents)}
            suffix="元"
            size={24}
          />
          <StatBig
            label="可用现金"
            value={fmtYuan(cash)}
            suffix="元"
            size={24}
          />
          <StatBig
            label="浮动盈亏"
            value={`${summary.totalPnlCents > 0 ? "+" : ""}${fmtYuan(summary.totalPnlCents)}`}
            suffix="元"
            size={24}
            color={pnlColor(summary.totalPnlCents)}
          />
        </Space>
      </SectionCard>

      <SectionCard title={`持仓明细（${holdings.length} 只）`}>
        {holdings.length === 0
          ? (
              <EmptyState description="还没有持仓">
                <Button type="primary" href="/funds">
                  去挑一只基金
                </Button>
              </EmptyState>
            )
          : (
              <HoldingList
                holdings={holdings}
                renderNote={(h) => {
                  const d = detailOf(h.fundCode);
                  return (
                    <>
                      {`${sharesToDisplay(h.sharesScaled)} 份 · 成本 ${fmtYuan(h.costCents)} 元`}
                      {/* ⚠️ 与 sharesAndNavNote 同一道闸门，不要拆开成「净值恒显示、
                          只有日期条件显示」：navDate 为 null 表示 portfolio-service
                          拉不到净值、用**成本价**兜底填了 navScaled，此时渲染「净值」
                          就是把成本价当净值给用户看。同一只持仓在 /me 与 /me/holdings
                          必须给同一个答案，否则两处又会各自漂移 */}
                      {h.navDate ? ` · 净值 ${navToDisplay(h.navScaled)}（${h.navDate}）` : ""}
                      {` · ${d.lots.length} 批`}
                      {d.pendingShares > 0 && (
                        <Text type="warning">
                          {` · ${sharesToDisplay(d.pendingShares)} 份待赎回`}
                        </Text>
                      )}
                    </>
                  );
                }}
                renderActions={h => (
                  <Space>
                    <Button size="small" onClick={() => setBuyTarget(h)}>
                      加仓
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => setSellTarget(h)}
                      disabled={detailOf(h.fundCode).availableShares <= 0}
                    >
                      赎回
                    </Button>
                  </Space>
                )}
              />
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          「批次」是同一只基金分次买入形成的份额批，赎回时按买入时间先进先出消耗，
          每批按各自持有天数计赎回费。
        </Paragraph>
      </SectionCard>

      {/* 加仓抽屉 */}
      {buyTarget && (
        <BuyDrawer
          open={!!buyTarget}
          onClose={() => setBuyTarget(null)}
          fundCode={buyTarget.fundCode}
          fundName={buyTarget.fundName}
          purchaseRate={detailOf(buyTarget.fundCode).purchaseRate}
          minPurchaseCents={detailOf(buyTarget.fundCode).minPurchase}
          navScaled={buyTarget.navScaled}
          navDate={buyTarget.navDate}
          cashCents={cash}
          action="/me/holdings"
        />
      )}

      {/* 赎回抽屉 */}
      {sellTarget && (
        <SellDrawer
          open={!!sellTarget}
          onClose={() => setSellTarget(null)}
          fundCode={sellTarget.fundCode}
          fundName={sellTarget.fundName}
          availableSharesScaled={detailOf(sellTarget.fundCode).availableShares}
          navScaled={sellTarget.navScaled}
          navDate={sellTarget.navDate}
          lots={detailOf(sellTarget.fundCode).lots}
          tiers={detailOf(sellTarget.fundCode).tiers}
          confirmDate={confirmDate}
          action="/me/holdings"
        />
      )}
    </Space>
  );
}
