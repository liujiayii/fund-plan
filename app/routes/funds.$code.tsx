import type { Route } from "./+types/funds.$code";
import type { RedeemTier } from "~/domain/redeem";
import type { DcaPlanView, HoldingBrief } from "~/services/portfolio-service";
import { Alert, Button, Segmented, Space, Tag, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { AssetAllocationChart } from "~/components/AssetAllocationChart";
import { BuyDrawer } from "~/components/BuyDrawer";
import { DcaBacktestCard } from "~/components/DcaBacktestCard";
import { DcaDrawer } from "~/components/DcaDrawer";
import { NavChart } from "~/components/NavChart";
import { PeriodReturnGrid } from "~/components/PeriodReturnGrid";
import { PositionList } from "~/components/PositionList";
import { BottomActionBar } from "~/components/ui/BottomActionBar";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account } from "~/db/schema";
import { DCA_BACKTEST_AMOUNT_CENTS, runDcaBacktest, toBacktestSeries } from "~/domain/dca-backtest";
import { navToDisplay, rateToPercent } from "~/domain/money";
import { NAV_BACKFILL_MIN_ROWS } from "~/domain/nav-backfill";
import { calcPeriodReturns } from "~/domain/performance";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { buildFundBreadcrumbJsonLd, buildFundMeta, pageMeta } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import {
  ensureFund,
  fetchAssetAllocation,
  fetchBonusHistory,
  fetchFundDetail,
  fetchFundPosition,
  fetchIndexNav,
  fetchInvestStyle,
  fetchManagerInfo,
  NAV_FETCH_TIMEOUT_BACKGROUND_MS,
  NAV_PAGE_BACKFILL_MAX_ROWS,
} from "~/services/fund-data";
import { getCurrentUser } from "~/services/guard";
import { ensureNavHistory, getDcaPlans, getHoldingBrief, getNavSeries } from "~/services/portfolio-service";
import { listSiblingFunds } from "~/services/seo-service";
import { isWatched } from "~/services/watchlist-service";
import { pnlColor } from "~/theme";

const { Title, Paragraph, Text } = Typography;

export function meta({ loaderData, params }: Route.MetaArgs) {
  const name = loaderData?.fund?.name ?? "基金详情";
  const code = params.code ?? "";
  // title / description 由 builder 拼：有回测就把真数字写进描述
  // （长尾词「<基金名> 定投回测」「<代码> 定投收益」靠它吃饭）
  const { title, description } = buildFundMeta({
    name,
    code,
    amountCents: DCA_BACKTEST_AMOUNT_CENTS,
    backtest: loaderData?.backtest ?? null,
  });
  const tags = pageMeta({ title, description, path: code ? `/funds/${code}` : "/funds" });
  // 面包屑结构化数据（首页 › 基金 › 该基金）：RR8 的 meta 原生支持 script:ld+json，
  // 渲染进 <head>。404 兜底（拿不到 code）时不输出——层级不完整反而误导
  return code
    ? [...tags, { "script:ld+json": buildFundBreadcrumbJsonLd({ name, code }) }]
    : tags;
}

/**
 * 基金详情。首次访问会把档案与近 400 天净值落库——
 * 这既是画图的数据源，也是 T+1 撮合的净值底座。
 * 400 天约 1.6 年，覆盖近 1 年阶段涨幅（spec §6）。
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { db, env, ctx } = getAppContext(context);
  const code = params.code;

  // 基金档案：没有或过期就拉东财落库（抽到 ensureFund，自选也复用它）
  const f = await ensureFund(db, env, code);
  if (!f) {
    throw new Response(`没找到基金 ${code}`, { status: 404 });
  }

  // 净值：历史残缺（< 60 条）才值得补一批。口径与闸门全在 ensureNavHistory
  // （阈值 + `fund.nav_backfilled_at/target` 记忆化）；这里只决定「等不等」：
  //   库里一行都没有 → 这一页没数据就是废页（爬虫只来一次），等它拉完；
  //   有数据但残缺   → 现有序列先渲染，回填丢 waitUntil（下次访问/爬虫就齐了）。
  //
  // 两档都用**一次翻页波**的行数上限 + 没人等档的超时：实测边缘打 lsjz 单页
  // 7~8s，而平台给 waitUntil 的预算是**响应后 30 秒**（同请求内共享，超时直接
  // 掐死且什么都没写），400 行 = 20 页 = 5 个串行阶段 ≈ 35~60s 必然超；
  // 长历史回填留给回测页（用户主动等）与后续 cron/队列（见 NAV_PAGE_BACKFILL_MAX_ROWS）。
  let series = await getNavSeries(db, code);
  const backfillOpts = {
    maxRows: NAV_PAGE_BACKFILL_MAX_ROWS,
    timeoutMs: NAV_FETCH_TIMEOUT_BACKGROUND_MS,
  };
  // hadSeries 取「await 之前」的状态：库里本来为空时上面那次 await 已经把活干完，
  // 不该再挂一个多余的后台任务（闸门会拦住，但白跑两次 D1 读）
  const hadSeries = series.length > 0;
  if (!hadSeries)
    series = await ensureNavHistory(db, env, code, backfillOpts);
  // 历史完整（线上 106/113 只）就别白发任务：那会白跑两次 D1 读才发现闸门不放行
  const backgroundBackfill = hadSeries && series.length < NAV_BACKFILL_MIN_ROWS;

  // 登录用户才需要：现金（买入抽屉）、自选态、已持有速览（顶部标识与两格统计）、
  // 该基金定投计划（定投抽屉）——四查互相独立，一波并行
  const user = await getCurrentUser(request, db);
  let cash: number | null = null;
  let watched = false;
  let brief: HoldingBrief | null = null;
  let dcaPlans: DcaPlanView[] = [];
  if (user) {
    const [acc, watchedResult, briefResult, plans] = await Promise.all([
      db.query.account.findFirst({
        where: eq(account.userId, user.id),
      }),
      isWatched(db, user.id, code),
      getHoldingBrief(db, user.id, code),
      getDcaPlans(db, user.id, code),
    ]);
    cash = acc?.cash ?? 0;
    watched = watchedResult;
    brief = briefResult;
    dcaPlans = plans;
  }

  const latest = series.at(-1) ?? null;

  // 阶段涨幅：本地 fund_nav 计算（不新增接口依赖）
  const periodReturns = calcPeriodReturns(series);

  // 定投回测：全站唯一由「我们的净值数据」算出的独有内容，
  // 喂给页面与 meta 描述（口径见 domain/dca-backtest 文件头）。
  // 纯内存计算，不额外查库；期数不足返回 null，卡片与文案各自回落
  const backtest = runDcaBacktest(toBacktestSeries(series), {
    amountCents: DCA_BACKTEST_AMOUNT_CENTS,
    purchaseRate: f.purchaseRate,
  });

  // 基金概况与投资组合：东财接口，拉不到为 null/空（不渲染对应卡片）
  // 沪深300 基准线：拉不到返回空数组，组件内传 undefined 即不画基准线（彩蛋，可砍）
  // 稳健档新增：资产配置 / 历史分红 / 基金经理详情 / 投资风格
  // （fund-data.ts 里有各接口字段名的实测注记）
  const [detail, position, indexNav, allocation, bonus, manager, investStyle, siblings] = await Promise.all([
    fetchFundDetail(env, code),
    fetchFundPosition(env, code),
    fetchIndexNav(env, "1.000300", 400),
    fetchAssetAllocation(env, code),
    fetchBonusHistory(env, code),
    fetchManagerInfo(env, code),
    fetchInvestStyle(env, code),
    // 同类基金内链：爬虫顺着它走到其它基金页，也给用户"接着看"的出口。
    // 与东财那批并行（一条 D1 查询，不额外占关键路径）
    listSiblingFunds(db, { code, type: f.type, limit: 6 }),
  ]);

  // 后台回填注册在 8 路东财请求**之后**：免费版并发出站连接只有 6 个
  // （第 7 个排队，不是在等响应头就算），提前注册会让回填的翻页波和页面
  // 自己的 8 路抢连接，把回填推向 30s 预算边界
  if (backgroundBackfill) {
    ctx.waitUntil(
      ensureNavHistory(db, env, code, backfillOpts).catch(err =>
        console.error(`[funds] ${code} 后台回填净值失败：`, err)),
    );
  }

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
    brief,
    dcaPlans,
    periodReturns,
    backtest,
    detail,
    position,
    indexNav,
    allocation,
    bonus,
    manager,
    investStyle,
    siblings,
  };
}

// 买入下单已统一迁移到 POST /me/trade 资源路由（BuyDrawer 的 action prop 直指它）

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
  const { fund: f, series, latest, cash, isLoggedIn, watched, brief, dcaPlans } = loaderData;
  // 加自选表单提交器：post 到 /me/watchlist，靠 fetcher.data 回显成功/失败
  const fetcher = useFetcher();
  // 抽屉开合（买入沿用现有壳；定投用 DcaDrawer）
  const [buyOpen, setBuyOpen] = useState(false);
  const [dcaOpen, setDcaOpen] = useState(false);

  // 投资组合三视图：数据哪个空藏哪个；选中项被数据淘汰时回落到第一个可用项
  const [posView, setPosView] = useState<string>("stocks");
  const posOptions = [
    ...(loaderData.position.stocks.length > 0 ? [{ value: "stocks", label: "股票" }] : []),
    ...(loaderData.position.bonds.length > 0 ? [{ value: "bonds", label: "债券" }] : []),
    ...(loaderData.position.industries.length > 0 ? [{ value: "industries", label: "行业" }] : []),
  ];
  const activePosView = posOptions.some(o => o.value === posView)
    ? posView
    : posOptions[0]?.value;

  // 同年多笔分红加序号区分标签（Task 8 评审 Minor 的落地）：
  // 同年第 n 笔的 label 为 `${year}·${n}`，仅同年多笔时加序号，单笔保持 `${year}`。
  // bonus 为 null 时不进 map，内层 `!` 断言不会被求值
  const bonusRows = (loaderData.bonus ?? []).map((b, i) => {
    const nth = loaderData.bonus!.filter((x, j) => x.year === b.year && j <= i).length;
    const sameYearTotal = loaderData.bonus!.filter(x => x.year === b.year).length;
    return { ...b, label: sameYearTotal > 1 ? `${b.year}·${nth}` : b.year };
  });

  const risk = RISK_MAP[f.riskLevel] ?? RISK_MAP[3];
  // 日涨跌率存的是万分之，转成百分比展示
  const growthPct = latest ? latest.growthRate / 100 : 0;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* animate-fade-up：区块进场淡入（首卡无延迟）。本页卡多，交错延迟按
          源码出现序 (N-1)×60ms；条件卡缺失时后面卡的延迟出现空档，观感无碍 */}
      <SectionCard className="animate-fade-up">
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Space align="baseline" wrap>
            <Title level={3} style={{ margin: 0 }}>
              {f.name}
            </Title>
            <Text type="secondary">{f.code}</Text>
            {f.type && <Tag>{f.type}</Tag>}
            <Tag color={risk.color}>{risk.label}</Tag>
            <Tag color={f.status.includes("开放") ? "purple" : "default"}>{f.status}</Tag>
            {/* 已持有标识：点 Tag 直达该基金的持仓详情页 */}
            {brief && (
              <Link to={`/me/holdings/${f.code}`}>
                <Tag color="gold" style={{ cursor: "pointer" }}>已持有</Tag>
              </Link>
            )}
          </Space>

          {/* [16,16]：统计行间距降档（Task 10）。原 48 横竖同值，窄屏折行后 rowGap 48
              把 5 个数字撑成 535px 高（spec §9）；桌面窄窗口同样受害。
              降到 16 后桌面多数仍一行放下，折行时间距也合理 */}
          <Space size={[16, 16]} wrap style={{ marginTop: 8 }}>
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
            {/* 已持有时的两格补充：与持仓详情页同源估值（getHoldingBrief） */}
            {brief && (
              <>
                <StatBig label="持有金额" value={fmtYuan(brief.marketValueCents)} suffix="元" size={24} />
                <StatBig
                  label="持有收益"
                  value={`${brief.pnlCents > 0 ? "+" : ""}${fmtYuan(brief.pnlCents)}`}
                  suffix="元"
                  size={24}
                  color={pnlColor(brief.pnlCents)}
                />
              </>
            )}
          </Space>

          <Space style={{ marginTop: 8 }}>
            <NavButton size="large" to="/funds">
              继续搜索
            </NavButton>
            {/* 自选/买入/定投统一收进页面底部固定操作条（支付宝式） */}
          </Space>
        </Space>
      </SectionCard>

      <SectionCard title="净值走势" className="animate-fade-up animate-delay-[60ms]">
        <NavChart
          data={series}
          benchmark={loaderData.indexNav.length > 0 ? loaderData.indexNav : undefined}
        />
      </SectionCard>

      <SectionCard title="阶段涨幅" className="animate-fade-up animate-delay-[120ms]">
        <PeriodReturnGrid returns={loaderData.periodReturns} />
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          基于本地历史净值计算，前向填充非交易日。数据不足的区间显示「—」。
        </Paragraph>
      </SectionCard>

      {/* 定投回测：期数不足（新基金、净值历史太薄）时整卡不渲染——
          宁可没有这块，也不给爬虫一页「回测」标题却没有数字的坏内容 */}
      {loaderData.backtest && (
        <DcaBacktestCard
          result={loaderData.backtest}
          amountCents={DCA_BACKTEST_AMOUNT_CENTS}
          purchaseRate={f.purchaseRate}
          className="animate-fade-up animate-delay-[180ms]"
        />
      )}

      {/* 基金经理：经理详情接口拉到就富展示，拉不到退化为只有名字的简卡。
          两个分支是同一视觉槽位（第 4 卡），共用 180ms 延迟 */}
      {(loaderData.manager?.length ?? 0) > 0
        ? (
            <SectionCard title="基金经理" className="animate-fade-up animate-delay-[240ms]">
              {loaderData.manager!.map((m, i) => (
                <div
                  key={`${m.name}-${m.workTime}`}
                  style={{ marginBottom: i === loaderData.manager!.length - 1 ? 0 : 16 }}
                >
                  <DataRow label="姓名" value={m.name || "—"} />
                  <DataRow label="任职日期" value={m.workTime || "—"} />
                  <DataRow label="在管规模" value={m.fundSize || "—"} mono />
                  <DataRow label="任期回报" value={m.profit || "—"} mono last />
                  {m.resume && (
                    <Paragraph
                      type="secondary"
                      style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}
                      ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
                    >
                      {m.resume}
                    </Paragraph>
                  )}
                </div>
              ))}
            </SectionCard>
          )
        : loaderData.detail?.manager && (
          <SectionCard title="基金经理" className="animate-fade-up animate-delay-[240ms]">
            <DataRow label="姓名" value={loaderData.detail.manager} last />
          </SectionCard>
        )}

      {loaderData.detail && (
        <SectionCard title="基金概况" className="animate-fade-up animate-delay-[300ms]">
          {/* 基金评级：星级比数字快读；0/缺省显示 — */}
          <DataRow
            label="基金评级"
            value={loaderData.detail.rating ? "★".repeat(loaderData.detail.rating) : "—"}
          />
          {/* 投资风格：FundMNTagList 换源后的真文本（补-1）；detail.investStyle
              恒空串，留在兜底链里无妨 */}
          <DataRow label="投资风格" value={loaderData.investStyle || loaderData.detail.investStyle || "—"} />
          <DataRow label="赎回状态" value={loaderData.detail.redeemStatus || "—"} />
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

      {/* 资产配置：股票/债券/现金占净值比环形图 */}
      {loaderData.allocation && (
        <SectionCard title="资产配置" className="animate-fade-up animate-delay-[360ms]">
          <AssetAllocationChart
            stocks={loaderData.allocation.stocks}
            bonds={loaderData.allocation.bonds}
            cash={loaderData.allocation.cash}
          />
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            股票 / 债券 / 现金占净值比，来自基金最新定期报告。
          </Paragraph>
        </SectionCard>
      )}

      {/* 投资组合：股票/债券/行业三视图，数据哪个空藏哪个；三块全空整卡不渲染 */}
      {posOptions.length > 0 && (
        <SectionCard title="投资组合" className="animate-fade-up animate-delay-[420ms]">
          {posOptions.length > 1 && (
            <div className="fp-h-scroll" style={{ marginBottom: 16 }}>
              <Segmented
                size="small"
                value={activePosView}
                onChange={v => setPosView(String(v))}
                options={posOptions}
              />
            </div>
          )}

          {activePosView === "stocks" && (
            <PositionList
              items={loaderData.position.stocks.slice(0, 10).map(s => ({
                name: s.name,
                sub: `${s.code} · ${s.industry}${s.changeType ? ` · ${s.changeType}` : ""}`,
                ratio: s.ratio,
              }))}
            />
          )}

          {activePosView === "bonds" && (
            <PositionList
              items={loaderData.position.bonds.map(b => ({
                name: b.name,
                sub: b.code,
                ratio: b.ratio,
              }))}
            />
          )}

          {activePosView === "industries" && (
            <PositionList
              items={loaderData.position.industries.map(ind => ({
                name: ind.name,
                ratio: ind.ratio,
              }))}
            />
          )}
        </SectionCard>
      )}

      {/* 历史分红：无记录整卡不渲染 */}
      {(loaderData.bonus?.length ?? 0) > 0 && (
        <SectionCard title="历史分红" className="animate-fade-up animate-delay-[480ms]">
          {bonusRows.map((b, i) => (
            <DataRow
              key={b.label}
              label={b.label}
              value={`每 10 份派 ${b.per10Shares} 元${b.recordDate ? ` · 除息日 ${b.recordDate}` : ""}`}
              mono
              last={i === bonusRows.length - 1}
            />
          ))}
        </SectionCard>
      )}

      <SectionCard title="赎回费率阶梯" className="animate-fade-up animate-delay-[540ms]">
        <Paragraph type="secondary">
          赎回按
          <Text strong>份额批次先进先出</Text>
          逐批计费，每批按各自的持有天数查下表档位。
          所以一笔赎回可能同时按多个费率计费。
        </Paragraph>
        {/* 内链到费用计算器：把这页的费率带过去预填（万分之 / ×10000，与库里口径一致） */}
        <Paragraph type="secondary" className="mb-3">
          想先算算这一笔？
          <Link to={`/tools/fee-calculator?rate=${f.purchaseRate}&nav=${latest?.unitNav ?? 0}`}>
            用费用计算器试算 →
          </Link>
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

      {/* 同类基金：同类型最多 6 条内链。同类为空（type 为空串、或库里只有它一只）
          整卡不渲染——空卡既是坏内容，也没有内链价值 */}
      {loaderData.siblings.length > 0 && (
        <SectionCard
          title="同类基金"
          extra={<Link to="/funds">全部基金</Link>}
          className="animate-fade-up animate-delay-[600ms]"
        >
          <Space size={[8, 8]} wrap>
            {loaderData.siblings.map(s => (
              <Link key={s.code} to={`/funds/${s.code}`} className="no-underline">
                <Tag className="cursor-pointer">
                  {s.name}
                  {" "}
                  {s.code}
                </Tag>
              </Link>
            ))}
          </Space>
          <Paragraph type="secondary" className="mt-3 mb-0 text-[12px]">
            同为
            {f.type}
            ，已收录的其它基金——各页的净值、费率与定投回测都是同一套真实数据。
          </Paragraph>
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

      {/* 自选提交结果：成功/失败均显式提示，不靠 reload 刷新。
          ⚠️ 必须放在 BottomActionBar 之前：bar 的占位块之后的内容
          滚到底时落入 fixed 条的遮挡带（CodeRabbit PR #75 采纳） */}
      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} closable />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} closable />
      )}

      {/* 页底固定操作条：定投 / 买入 / 自选（ux-polish spec §4①）。
          按钮语义与旧「交易操作」卡一致：无净值禁买入；自选 fetcher 照旧 post /me/watchlist */}
      <BottomActionBar
        note={!latest ? "净值数据就绪后可在此下单" : undefined}
        actions={!isLoggedIn
          ? (
              <NavButton type="primary" size="large" to="/register">
                注册后即可买入
              </NavButton>
            )
          : (
              <Space size={16} wrap>
                <Button size="large" onClick={() => setDcaOpen(true)}>
                  定投
                </Button>
                <Button
                  type="primary"
                  size="large"
                  disabled={!latest}
                  onClick={() => setBuyOpen(true)}
                >
                  买入
                </Button>
                <fetcher.Form method="post" action="/me/watchlist" style={{ display: "inline" }}>
                  {/* intent 随当前态翻转：未自选→add，已自选→remove */}
                  <input type="hidden" name="intent" value={watched ? "remove" : "add"} />
                  <input type="hidden" name="fundCode" value={f.code} />
                  {/* 一页只留一个 primary（买入）；自选态用 ✓ 反馈，不占红绿 */}
                  <Button size="large" htmlType="submit">
                    {watched ? "已自选 ✓" : "加自选"}
                  </Button>
                </fetcher.Form>
              </Space>
            )}
      />

      {/* 抽屉：买入（现有壳）与定投（新壳） */}
      <BuyDrawer
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        fundCode={f.code}
        fundName={f.name}
        purchaseRate={f.purchaseRate}
        minPurchaseCents={f.minPurchase}
        navScaled={latest ? latest.unitNav : 0}
        navDate={latest ? latest.navDate : null}
        cashCents={cash}
        action="/me/trade"
      />
      <DcaDrawer
        open={dcaOpen}
        onClose={() => setDcaOpen(false)}
        fundCode={f.code}
        fundName={f.name}
        plans={dcaPlans}
      />
    </Space>
  );
}
