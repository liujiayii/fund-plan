import type { Route } from "./+types/funds.$code";
import type { RedeemTier } from "~/domain/redeem";
import { Alert, Button, Space, Tag, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { BuyDrawer } from "~/components/BuyDrawer";
import { NavChart } from "~/components/NavChart";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account, fund, fundNav } from "~/db/schema";
import { navToDisplay, rateToPercent } from "~/domain/money";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getAppContext } from "~/services/context";
import { fetchFundBasic, fetchNavHistory } from "~/services/fund-data";
import { getCurrentUser } from "~/services/guard";
import { getNavSeries } from "~/services/portfolio-service";
import { placeBuyOrder } from "~/services/trade";
import { pnlColor } from "~/theme";

const { Title, Paragraph, Text } = Typography;

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.fund?.name ?? "基金详情";
  return [{ title: `${name} · 模拟基金` }];
}

/**
 * 基金详情。首次访问会把档案与近 120 天净值落库——
 * 这既是画图的数据源，也是 T+1 撮合的净值底座。
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const code = params.code;

  // 先看库里有没有档案；没有或超过 1 天就去东财拉一次
  let f = await db.query.fund.findFirst({ where: eq(fund.code, code) });
  const stale = !f || Date.now() - f.updatedAt > 86_400_000;

  if (stale) {
    const basic = await fetchFundBasic(env, code);
    if (basic) {
      await db
        .insert(fund)
        .values({
          code: basic.code,
          name: basic.name,
          type: basic.type,
          purchaseRate: basic.purchaseRate,
          redeemTiers: DEFAULT_REDEEM_TIERS,
          minPurchase: basic.minPurchaseCents,
          riskLevel: basic.riskLevel,
          status: basic.status,
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: fund.code,
          set: {
            name: basic.name,
            type: basic.type,
            purchaseRate: basic.purchaseRate,
            minPurchase: basic.minPurchaseCents,
            riskLevel: basic.riskLevel,
            status: basic.status,
            updatedAt: Date.now(),
          },
        });
      f = await db.query.fund.findFirst({ where: eq(fund.code, code) });
    }
  }

  if (!f) {
    throw new Response(`没找到基金 ${code}`, { status: 404 });
  }

  // 净值：库里没有就拉一批回来
  let series = await getNavSeries(db, code);
  if (series.length === 0) {
    const rows = await fetchNavHistory(env, code, 120);
    for (const r of rows) {
      await db
        .insert(fundNav)
        .values({
          fundCode: code,
          navDate: r.navDate,
          unitNav: r.unitNav,
          accNav: r.accNav,
          growthRate: r.growthRate,
        })
        .onConflictDoNothing();
    }
    series = await getNavSeries(db, code);
  }

  // 登录用户才需要现金余额（买入抽屉要用）
  const user = await getCurrentUser(request, db);
  let cash: number | null = null;
  if (user) {
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, user.id),
    });
    cash = acc?.cash ?? 0;
  }

  const latest = series.at(-1) ?? null;

  return {
    fund: {
      code: f.code,
      name: f.name,
      type: f.type,
      purchaseRate: f.purchaseRate,
      minPurchase: f.minPurchase,
      riskLevel: f.riskLevel,
      status: f.status,
      redeemTiers: (f.redeemTiers as RedeemTier[]) ?? DEFAULT_REDEEM_TIERS,
    },
    series,
    latest,
    cash,
    isLoggedIn: !!user,
  };
}

/** 买入下单 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await getCurrentUser(request, db);
  if (!user)
    return { error: "请先登录" };

  const fd = await request.formData();
  const amountYuan = String(fd.get("amount") ?? "");
  const n = Number(amountYuan);
  if (!Number.isFinite(n) || n <= 0)
    return { error: "请输入正确的金额" };

  try {
    const { yuanToCents } = await import("~/domain/money");
    await placeBuyOrder(db, env, {
      userId: user.id,
      fundCode: params.code,
      amountCents: yuanToCents(amountYuan),
    });
    return { ok: true, message: "下单成功，待 T+1 确认" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "下单失败" };
  }
}

/**
 * 风险等级对应的颜色与说明。
 *
 * ⚠️ 刻意避开红与绿：低风险不用 green、高风险不用 red ——
 * 那两个颜色现在专属涨跌，拿来表示风险会让用户
 * 把「高风险」误读成「在涨」。改用蓝→青→金→橙→火山的暖度递进。
 */
const RISK_MAP: Record<number, { color: string; label: string }> = {
  1: { color: "blue", label: "低风险" },
  2: { color: "cyan", label: "中低风险" },
  3: { color: "gold", label: "中风险" },
  4: { color: "orange", label: "中高风险" },
  5: { color: "volcano", label: "高风险" },
};

export default function FundDetail({ loaderData }: Route.ComponentProps) {
  const { fund: f, series, latest, cash, isLoggedIn } = loaderData;
  const [buyOpen, setBuyOpen] = useState(false);

  const risk = RISK_MAP[f.riskLevel] ?? RISK_MAP[3];
  // 日涨跌率存的是万分之，转成百分比展示
  const growthPct = latest ? latest.growthRate / 100 : 0;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <SectionCard>
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Space align="baseline" wrap>
            <Title level={3} style={{ margin: 0 }}>
              {f.name}
            </Title>
            <Text type="secondary">{f.code}</Text>
            {f.type && <Tag>{f.type}</Tag>}
            <Tag color={risk.color}>{risk.label}</Tag>
            <Tag color={f.status.includes("开放") ? "blue" : "default"}>{f.status}</Tag>
          </Space>

          <Space size={48} wrap style={{ marginTop: 8 }}>
            <StatBig
              label={`单位净值${latest ? `（${latest.navDate}）` : ""}`}
              value={latest ? navToDisplay(latest.unitNav) : "—"}
            />
            <StatBig
              label="日涨跌"
              value={`${growthPct > 0 ? "+" : ""}${growthPct.toFixed(2)}`}
              suffix="%"
              size={24}
              color={pnlColor(growthPct)}
            />
            <StatBig
              label="申购费率"
              value={rateToPercent(f.purchaseRate)}
              size={24}
            />
            <StatBig
              label="起购金额"
              value={fmtYuan(f.minPurchase)}
              suffix="元"
              size={24}
            />
          </Space>

          <Space style={{ marginTop: 8 }}>
            {isLoggedIn
              ? (
                  <Button
                    type="primary"
                    size="large"
                    onClick={() => setBuyOpen(true)}
                    disabled={!latest}
                  >
                    买入
                  </Button>
                )
              : (
                  <Button type="primary" size="large" href="/register">
                    注册后即可买入
                  </Button>
                )}
            <Button size="large" href="/funds">
              继续搜索
            </Button>
          </Space>
        </Space>
      </SectionCard>

      <SectionCard title="净值走势">
        <NavChart data={series} />
      </SectionCard>

      <SectionCard title="赎回费率阶梯">
        <Paragraph type="secondary">
          赎回按
          <Text strong>份额批次先进先出</Text>
          逐批计费，每批按各自的持有天数查下表档位。
          所以一笔赎回可能同时按多个费率计费。
        </Paragraph>
        {f.redeemTiers.map((t, i) => (
          // key 用 minDays 而非数组索引：档位查找是 `holdDays >= t.minDays`，
          // 重复的 minDays 会让查找产生歧义，所以「minDays 唯一」是这个
          // 数据结构自身的契约；将来往中间插新档位时索引会全体错位，它不会。
          <DataRow
            key={t.minDays}
            label={
              t.maxDays === null
                ? `持有满 ${t.minDays} 天`
                : `持有 ${t.minDays} ~ 不满 ${t.maxDays} 天`
            }
            value={rateToPercent(t.rate)}
            mono
            last={i === f.redeemTiers.length - 1}
          />
        ))}
      </SectionCard>

      {!latest && (
        <Alert
          type="warning"
          showIcon
          message="暂无净值数据"
          description="可能是接口暂时不可用，稍后刷新重试。没有净值时无法下单。"
        />
      )}

      {latest && (
        <BuyDrawer
          open={buyOpen}
          onClose={() => setBuyOpen(false)}
          fundCode={f.code}
          fundName={f.name}
          purchaseRate={f.purchaseRate}
          minPurchaseCents={f.minPurchase}
          navScaled={latest.unitNav}
          navDate={latest.navDate}
          cashCents={cash}
          action={`/funds/${f.code}`}
        />
      )}
    </Space>
  );
}
