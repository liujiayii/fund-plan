import type { Route } from "./+types/funds.$code";
import type { RedeemTier } from "~/domain/redeem";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useFetcher } from "react-router";
import { BuyPanel } from "~/components/BuyPanel";
import { NavChart } from "~/components/NavChart";
import { PeriodReturnTable } from "~/components/PeriodReturnTable";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account, fundNav } from "~/db/schema";
import { navToDisplay, rateToPercent } from "~/domain/money";
import { calcPeriodReturns } from "~/domain/performance";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { getAppContext } from "~/services/context";
import {
  ensureFund,
  fetchFundDetail,
  fetchFundPosition,
  fetchIndexNav,
  fetchNavHistory,
} from "~/services/fund-data";
import { getCurrentUser } from "~/services/guard";
import { getNavSeries } from "~/services/portfolio-service";
import { placeBuyOrder } from "~/services/trade";
import { isWatched } from "~/services/watchlist-service";
import { pnlColor } from "~/theme";

const { Title, Paragraph, Text } = Typography;

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.fund?.name ?? "基金详情";
  return [{ title: `${name} · 模拟基金` }];
}

/**
 * 基金详情。首次访问会把档案与近 400 天净值落库——
 * 这既是画图的数据源，也是 T+1 撮合的净值底座。
 * 400 天约 1.6 年，覆盖近 1 年阶段涨幅（spec §6）。
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const code = params.code;

  // 基金档案：没有或过期就拉东财落库（抽到 ensureFund，自选也复用它）
  const f = await ensureFund(db, env, code);
  if (!f) {
    throw new Response(`没找到基金 ${code}`, { status: 404 });
  }

  // 净值：库里没有就拉一批回来（首访 400 天，覆盖近 1 年阶段涨幅）
  let series = await getNavSeries(db, code);
  if (series.length === 0) {
    const rows = await fetchNavHistory(env, code, 400);
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

  // 登录用户才需要现金余额（买入抽屉要用）与自选态
  const user = await getCurrentUser(request, db);
  let cash: number | null = null;
  let watched = false;
  if (user) {
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, user.id),
    });
    cash = acc?.cash ?? 0;
    // 静态 import：顶部已 import isWatched，直接调用
    watched = await isWatched(db, user.id, code);
  }

  const latest = series.at(-1) ?? null;

  // 阶段涨幅：本地 fund_nav 计算（不新增接口依赖）
  const periodReturns = calcPeriodReturns(series);

  // 基金概况与重仓股：东财接口，拉不到为 null/[]（不渲染对应卡片）
  // 沪深300 基准线：拉不到返回空数组，组件内传 undefined 即不画基准线（彩蛋，可砍）
  const [detail, position, indexNav] = await Promise.all([
    fetchFundDetail(env, code),
    fetchFundPosition(env, code),
    fetchIndexNav(env, "1.000300", 400),
  ]);

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
    watched,
    periodReturns,
    detail,
    position,
    indexNav,
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
  // 加自选表单提交器：post 到 /me/watchlist，靠 fetcher.data 回显成功/失败
  const fetcher = useFetcher();

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
              // 「%」写进 value、不走 suffix：同一行的「申购费率」是 rateToPercent()
              // 自带的 %（大字号等宽），suffix 会渲染成灰 13px 比例字体并空 4px，
              // 一行里两个百分号两种长相
              value={`${growthPct > 0 ? "+" : ""}${growthPct.toFixed(2)}%`}
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
            <Button size="large" href="/funds">
              继续搜索
            </Button>
            {isLoggedIn && (
              <fetcher.Form method="post" action="/me/watchlist" style={{ display: "inline" }}>
                {/* intent 随当前态翻转：未自选→add，已自选→remove */}
                <input type="hidden" name="intent" value={loaderData.watched ? "remove" : "add"} />
                <input type="hidden" name="fundCode" value={f.code} />
                <Button
                  size="large"
                  htmlType="submit"
                  // 加自选用主色，已自选用默认色；不占红绿
                  type={loaderData.watched ? "default" : "primary"}
                >
                  {loaderData.watched ? "已自选 ✓" : "加自选"}
                </Button>
              </fetcher.Form>
            )}
          </Space>

          {/* 加自选提交结果：成功/失败均显式提示，不靠 reload 刷新 */}
          {fetcher.data?.ok && <Alert type="success" showIcon message={fetcher.data.message} closable />}
          {fetcher.data?.error && <Alert type="error" showIcon message={fetcher.data.error} closable />}
        </Space>
      </SectionCard>

      <SectionCard title="净值走势">
        <NavChart
          data={series}
          benchmark={loaderData.indexNav.length > 0 ? loaderData.indexNav : undefined}
        />
      </SectionCard>

      <SectionCard title="阶段涨幅">
        <PeriodReturnTable returns={loaderData.periodReturns} />
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          基于本地历史净值计算，前向填充非交易日。数据不足的区间显示「—」。
        </Paragraph>
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

      {loaderData.detail && (
        <SectionCard title="基金概况">
          <DataRow label="基金经理" value={loaderData.detail.manager || "—"} />
          <DataRow label="基金公司" value={loaderData.detail.company || "—"} />
          <DataRow label="成立日期" value={loaderData.detail.estabDate || "—"} />
          <DataRow
            label="最新规模"
            value={loaderData.detail.scaleYuan !== null
              ? `${(loaderData.detail.scaleYuan / 1e8).toFixed(2)} 亿元`
              : "—"}
            mono
          />
          <DataRow label="管理费" value={rateToPercent(loaderData.detail.mgmtFeeRate)} mono />
          <DataRow label="托管费" value={rateToPercent(loaderData.detail.trustFeeRate)} mono last />
          {loaderData.detail.benchmark && (
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
              业绩基准：
              {loaderData.detail.benchmark}
            </Paragraph>
          )}
        </SectionCard>
      )}

      {loaderData.position.length > 0 && (
        <SectionCard title="重仓股（前 10）">
          {/* 桌面视图：原 5 列 Table 原样保留（Task 8 双渲染，列不动） */}
          <div className="fp-desktop">
            <Table
              size="small"
              pagination={false}
              rowKey="code"
              dataSource={loaderData.position.slice(0, 10)}
              columns={[
                { title: "代码", dataIndex: "code" },
                { title: "简称", dataIndex: "name" },
                {
                  title: "占净值比",
                  dataIndex: "ratio",
                  align: "right",
                  render: (v: number) => rateToPercent(v),
                },
                { title: "行业", dataIndex: "industry" },
                { title: "增减持", dataIndex: "changeType" },
              ]}
            />
          </div>
          {/* 窄屏：降级成 DataRow，字段不缺——代码/简称并进标题行，
              占净值比/行业/增减持各占一行（同 SellPanel 的批次降级） */}
          <div className="fp-mobile">
            {loaderData.position.slice(0, 10).map(p => (
              <div key={p.code} style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>
                  {p.name}
                  （
                  {p.code}
                  ）
                </Text>
                <DataRow label="占净值比" value={rateToPercent(p.ratio)} mono />
                <DataRow label="行业" value={p.industry} />
                <DataRow label="增减持" value={p.changeType} last />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {!latest && (
        <Alert
          type="warning"
          showIcon
          message="暂无净值数据"
          description="可能是接口暂时不可用，稍后刷新重试。没有净值时无法下单。"
        />
      )}

      {/* 买入区：登录且有净值时内嵌 BuyPanel；未登录引导注册；登录但暂无净值时提示 */}
      <SectionCard title="买入">
        {!isLoggedIn
          ? (
              <Button type="primary" size="large" href="/register">
                注册后即可买入
              </Button>
            )
          : latest
            ? (
                <BuyPanel
                  fundCode={f.code}
                  fundName={f.name}
                  purchaseRate={f.purchaseRate}
                  minPurchaseCents={f.minPurchase}
                  navScaled={latest.unitNav}
                  navDate={latest.navDate}
                  cashCents={cash}
                  action={`/funds/${f.code}`}
                />
              )
            : (
                // 既有页面级 !latest Alert 已醒目提示「暂无净值数据…无法下单」，
                // 卡内不重复同一句，只留柔和占位说明卡位用途，等净值就绪即可下单
                <Text type="secondary">净值数据就绪后可在此下单</Text>
              )}
      </SectionCard>

      {/* 定投入口：买入 + 定投双入口（spec §9）。每天 10:00 自动扫描到期计划下单 */}
      {isLoggedIn && (
        <SectionCard title="定投">
          <Paragraph type="secondary">
            设置定期定额买入这只基金，系统每天 10:00 自动扫描到期计划下单。
          </Paragraph>
          <Button type="primary" href="/me/dca">去设置定投 →</Button>
        </SectionCard>
      )}
    </Space>
  );
}
