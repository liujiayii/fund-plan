import type { TableProps } from "antd";
import type { Route } from "./+types/tools.dca-backtest";
import type { Db } from "~/db/client";
import type {
  DcaAdjustMode,
  DcaBacktestPeriod,
  DcaBacktestResult,
  DcaFrequency,
} from "~/domain/dca-backtest";
import type { FundSearchItem } from "~/services/fund-data";
import { Alert, Button, Input, InputNumber, Segmented, Space, Table, Typography } from "antd";
import { desc } from "drizzle-orm";
import { useId, useState } from "react";
import { Link, Form as RouterForm, useNavigation } from "react-router";
import { DcaBacktestChart } from "~/components/DcaBacktestChart";
import { DataRow } from "~/components/ui/DataRow";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { fund } from "~/db/schema";
import {
  countDcaPeriods,
  DCA_BACKTEST_MIN_PERIODS,
  DCA_FREQUENCY_LABELS,
  dcaCurvePoints,
  runDcaBacktest,
  toBacktestSeries,
} from "~/domain/dca-backtest";
import {
  DCA_PAGE_DEFAULT_AMOUNT_CENTS,
  DCA_PAGE_DEFAULT_PERIODS,
  DCA_PAGE_FREQUENCY_OPTIONS,
  DCA_PAGE_PERIOD_HARD_MAX,
  parseDcaBacktestQuery,
} from "~/domain/dca-backtest-params";
import { centsToYuan, navToDisplay, rateToPercent } from "~/domain/money";
import { buildDcaBacktestMeta, pageMeta } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import { ensureFund, searchFunds } from "~/services/fund-data";
import { ensureNavHistory } from "~/services/portfolio-service";
import { pnlColor } from "~/theme";

const { Title, Paragraph, Text } = Typography;

/**
 * 基金定投回测（公开工具页，/tools/dca-backtest）。
 *
 * 为什么值得单独一页：基金页那张回测卡的口径是写死的（每月 1000 元 × 最近 12 期），
 * 而「定投收益/回测」这类长尾词的意图是**自己想试**——每期投多少、投几期、
 * 分红算不算，都要能调。数字全由我们库里的逐日净值算出来（`domain/dca-backtest`），
 * 页面可变但口径只有一份，这是它相对别家「定投计算器」的差别。
 *
 * 计算时机：**服务端**。URL 即状态（`?code=&amount=&periods=&adjust=`），表单 GET
 * 提交让 loader 重算——首屏的数字、明细、区间全在 SSR 的 HTML 里，爬虫不跑 JS
 * 也读得到，分享出去的链接也带上同一套参数（canonical 剥 query，参数变体不会
 * 变成一堆重复 URL）。
 *
 * 入口：sitemap + 侧栏导航（docs/seo.md §5.2 的约定：新公开页优先挂导航，
 * 侧栏在每个页面都渲染，等于给它全站内链）。
 */
export function meta({ loaderData }: Route.MetaArgs) {
  const { title, description } = buildDcaBacktestMeta({
    name: loaderData?.fundName ?? "",
    code: loaderData?.code ?? "",
    amountCents: loaderData?.amountCents ?? DCA_PAGE_DEFAULT_AMOUNT_CENTS,
    frequency: loaderData?.frequency ?? "month",
    adjust: loaderData?.adjust ?? "acc",
    backtest: loaderData?.backtest ?? null,
  });
  return pageMeta({ title, description, path: "/tools/dca-backtest" });
}

/**
 * 没带 code 时挑一只当默认标的：库里**最近更新过**的那只。
 *
 * 为什么不空着：被 sitemap 收录的是不带参数的 `/tools/dca-backtest`，
 * 那一页必须有真数字——否则爬虫看到的是一张空表，而这一页存在的全部意义
 * 就是「值得被收录的独有内容」。最近更新过 ≈ 最近被访问过，净值历史也最全。
 */
async function pickDefaultFundCode(db: Db): Promise<string> {
  const row = await db.query.fund.findFirst({
    columns: { code: true },
    orderBy: desc(fund.updatedAt),
  });
  return row?.code ?? "";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const url = new URL(request.url);
  const parsed = parseDcaBacktestQuery(url.searchParams);
  // 搜索词单独处理：搜基金只多出一张结果列表，不改回测口径
  const q = (url.searchParams.get("q") ?? "").trim();
  const results: FundSearchItem[] = q ? await searchFunds(env, q) : [];

  const code = parsed.code || (await pickDefaultFundCode(db));
  if (!code) {
    // 库里一只基金都没落档（全新部署）：只剩选择入口可展示，这不是错误
    return {
      code: "",
      fundName: "",
      purchaseRate: 0,
      backtest: null as DcaBacktestResult | null,
      availablePeriods: 0,
      amountCents: parsed.amountCents,
      frequency: parsed.frequency,
      periods: parsed.periods,
      adjust: parsed.adjust,
      notices: parsed.notices,
      isDefault: false,
      q,
      results,
    };
  }

  const f = await ensureFund(db, env, code);
  if (!f) {
    // 与基金页同款：查无此代码就是 404，别给爬虫一个「有标题没内容」的页
    throw new Response(`没找到基金 ${code}`, { status: 404 });
  }

  // 净值历史不足就回填（规则见 ensureNavHistory 注释）。
  // 阈值给 250 而不是默认的 60：本页按天定投的默认期数就是 250 期，库里只有
  // 60~249 条时会静默算成短窗口——而 settle 每晚只同步最近 30 条，不会替我们补齐
  // 更早的历史，光靠默认阈值补不上（CodeRabbit 评审 #7）
  const series = await ensureNavHistory(db, env, code, 250);
  const points = toBacktestSeries(series, parsed.adjust);
  const backtest = runDcaBacktest(points, {
    amountCents: parsed.amountCents,
    purchaseRate: f.purchaseRate,
    periods: parsed.periods,
    frequency: parsed.frequency,
  });

  return {
    code,
    fundName: f.name,
    purchaseRate: f.purchaseRate,
    backtest,
    // 该频率下库里能支撑多少期：页面据此提示「最多 N 期」（填超了按它算）
    availablePeriods: countDcaPeriods(points, parsed.frequency),
    amountCents: parsed.amountCents,
    frequency: parsed.frequency,
    periods: parsed.periods,
    adjust: parsed.adjust,
    notices: parsed.notices,
    // 没带 code 而用了默认标的：页面上要说清楚，别让用户以为这就是他要的那只
    isDefault: parsed.code === "",
    q,
    results,
  };
}

/** 逐期明细表的一行（key 用买入日：同一期只会买一次） */
interface ScheduleRow extends DcaBacktestPeriod {
  key: string;
}

/** 「回测设置」卡的入参：全部来自 loader（表单状态在卡内，卡按参数重挂载） */
interface ParamsCardProps {
  code: string;
  fundName: string;
  isDefault: boolean;
  availablePeriods: number;
  q: string;
  results: FundSearchItem[];
  notices: string[];
  initial: {
    amountCents: number;
    frequency: DcaFrequency;
    periods: number;
    adjust: DcaAdjustMode;
  };
}

/**
 * 回测设置卡：搜基金 / 看当前标的 / 调参数。
 *
 * ⚠️ 表单状态刻意放在**这一层**，由页面用本轮参数当 key 渲染它——参数一变整卡
 * 重挂载，受控控件与提交用的 hidden 字段都从 loaderData 重新初始化。状态若留在
 * 页面组件里，key 换的是卡、不是状态：服务端回落了参数（或 browser back/forward
 * 换了参数）时控件会停在上一轮的值上，页面显示 50 元、算的却是 1000 元
 * （CodeRabbit 评审 #4）。用 useEffect 同步是另一条路，但会多一次渲染，还踩本仓库
 * 明确避免的 react/set-state-in-effect 告警（见 components/ui/chart 的 useIsClient 顶注）。
 */
function ParamsCard({
  code,
  fundName,
  isDefault,
  availablePeriods,
  q,
  results,
  notices,
  initial,
}: ParamsCardProps) {
  const nav = useNavigation();
  const computing = nav.state === "loading";

  // 受控的金额输入：搜索表单的 hidden 也要带上「用户刚敲进去的那个数」，
  // 不受控的话两处会各自为政（一个显示 2000、另一个提交 1000）
  const [amountText, setAmountText] = useState(() => amountDisplay(initial.amountCents));
  const [freqValue, setFreqValue] = useState<string>(initial.frequency);
  // 期数可被清空（InputNumber 清空时给 null），提交后由服务端回落默认值 + 提示
  const [periodsValue, setPeriodsValue] = useState<number | null>(initial.periods);
  const [adjustValue, setAdjustValue] = useState<string>(initial.adjust);

  // 控件的可访问名称：相邻 <span> 不构成程序化标签关联，屏幕阅读器读不出控件用途
  // （CodeRabbit 评审 #5），所以用 aria-labelledby 指过去；useId 保证 SSR 前后一致
  const freqLabelId = useId();
  const adjustLabelId = useId();
  const periodsLabelId = useId();

  /**
   * 切频率时把期数换成该频率的默认值（都是「一年」的量）。
   * 沿用原数字没意义：12 期按月是一年，按天只有 12 天。
   */
  const onFrequencyChange = (v: string) => {
    setFreqValue(v);
    setPeriodsValue(DCA_PAGE_DEFAULT_PERIODS[v as DcaFrequency]);
  };

  /** 搜索结果换标的时把当前参数一起带过去（换基金不该重置金额/频率/期数） */
  const linkFor = (fundCode: string) =>
    `/tools/dca-backtest?code=${fundCode}`
    + `&amount=${encodeURIComponent(amountText)}`
    + `&freq=${freqValue}&periods=${periodsValue ?? ""}&adjust=${adjustValue}`;

  return (
    <SectionCard title="回测设置" className="animate-fade-up">
      {/* 基金选择：搜索走 GET 的 q 参数，与回测口径互不干扰 */}
      <RouterForm method="get">
        {code ? <input type="hidden" name="code" value={code} /> : null}
        <input type="hidden" name="amount" value={amountText} />
        <input type="hidden" name="freq" value={freqValue} />
        <input type="hidden" name="periods" value={periodsValue ?? ""} />
        <input type="hidden" name="adjust" value={adjustValue} />
        <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
          <Input
            name="q"
            size="large"
            defaultValue={q}
            placeholder="搜基金：如 000001 或 华夏成长"
            allowClear
          />
          <Button size="large" htmlType="submit" loading={computing}>搜基金</Button>
        </Space.Compact>
      </RouterForm>

      {q
        ? (
            <div className="mt-3">
              {results.length === 0
                ? <EmptyState description="没搜到，换个关键词试试" />
                : results.map((r, i) => (
                    <FundListItem
                      key={r.code}
                      fundCode={r.code}
                      fundName={r.name}
                      fundType={r.type || undefined}
                      last={i === results.length - 1}
                      actions={(
                        <NavButton size="small" type="link" to={linkFor(r.code)}>
                          用它回测
                        </NavButton>
                      )}
                    />
                  ))}
            </div>
          )
        : null}

      {code
        ? (
            <Paragraph type="secondary" className="mt-3 mb-0 text-[13px]">
              当前标的：
              <Text strong>{`${fundName}（${code}）`}</Text>
              {isDefault
                ? " —— 库里最近有数据的基金，可在上方换成任意基金"
                : null}
              {" "}
              <Link to={`/funds/${code}`}>看它的净值与费率</Link>
            </Paragraph>
          )
        : null}

      {/* 参数区：频率 + 口径 + 金额 + 期数 */}
      <div className="mt-4 grid gap-4">
        <RouterForm method="get">
          {code ? <input type="hidden" name="code" value={code} /> : null}
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <input type="hidden" name="freq" value={freqValue} />
          <input type="hidden" name="periods" value={periodsValue ?? ""} />
          <input type="hidden" name="adjust" value={adjustValue} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="block">
              <span id={freqLabelId} className="mb-1 block text-[13px] text-muted">定投频率</span>
              <Segmented
                block
                aria-labelledby={freqLabelId}
                value={freqValue}
                onChange={v => onFrequencyChange(String(v))}
                options={DCA_PAGE_FREQUENCY_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
              />
            </div>
            <div className="block">
              <span id={adjustLabelId} className="mb-1 block text-[13px] text-muted">净值口径</span>
              <Segmented
                block
                aria-labelledby={adjustLabelId}
                value={adjustValue}
                onChange={v => setAdjustValue(String(v))}
                options={[
                  { label: "累计净值", value: "acc" },
                  { label: "单位净值", value: "unit" },
                ]}
              />
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">每期金额</span>
              <Input
                name="amount"
                value={amountText}
                onChange={e => setAmountText(e.target.value)}
                inputMode="decimal"
                suffix={<span className="text-[12px] text-placeholder">元</span>}
              />
            </label>
            <div className="block">
              <span id={periodsLabelId} className="mb-1 block text-[13px] text-muted">回测期数（可自定义）</span>
              <InputNumber
                aria-labelledby={periodsLabelId}
                value={periodsValue}
                onChange={v => setPeriodsValue(typeof v === "number" ? v : null)}
                min={DCA_BACKTEST_MIN_PERIODS}
                max={DCA_PAGE_PERIOD_HARD_MAX}
                step={1}
                precision={0}
                style={{ width: "100%" }}
                addonAfter="期"
              />
              <span className="mt-1 block text-[12px] text-placeholder">
                {availablePeriods > 0
                  ? `当前频率库里最多 ${availablePeriods} 期，填多了按最多算`
                  : "库里还没有这只基金的净值"}
              </span>
            </div>
          </div>
          <div className="mt-3">
            <Button type="primary" htmlType="submit" loading={computing}>
              开始回测
            </Button>
          </div>
        </RouterForm>
      </div>

      {notices.map(n => (
        <Alert key={n} type="info" showIcon className="mt-3" message={n} />
      ))}
    </SectionCard>
  );
}

export default function DcaBacktestPage({ loaderData }: Route.ComponentProps) {
  const {
    code,
    fundName,
    purchaseRate,
    backtest,
    availablePeriods,
    amountCents,
    frequency,
    periods,
    adjust,
    notices,
    isDefault,
    q,
    results,
  } = loaderData;

  const signed = (rate: number) => `${rate > 0 ? "+" : ""}${rateToPercent(rate)}`;

  // 参数与表单状态都在 ParamsCard 里（见那个组件的顶注），这里按本轮参数当 key
  // 让它整卡重挂载：受控控件与提交用的 hidden 字段因此每轮都从 loaderData 重新
  // 初始化，不会出现「页面显示 50 元、算的却是 1000 元」（CodeRabbit 评审 #4）
  const paramsKey = `${code}-${amountCents}-${frequency}-${periods}-${adjust}`;

  const columns: TableProps<ScheduleRow>["columns"] = [
    { title: "买入日", dataIndex: "navDate", width: 112 },
    {
      title: "买入净值",
      dataIndex: "nav",
      width: 96,
      render: (v: number) => navToDisplay(v),
    },
    {
      title: "累计投入",
      dataIndex: "investedCents",
      width: 104,
      render: (v: number) => fmtYuan(v),
    },
    {
      title: "持仓市值",
      dataIndex: "valueCents",
      width: 104,
      render: (v: number) => fmtYuan(v),
    },
    {
      title: "累计收益率",
      dataIndex: "returnRate",
      width: 104,
      render: (v: number) => <span style={{ color: pnlColor(v) }}>{signed(v)}</span>,
    },
  ];

  const rows: ScheduleRow[] = (backtest?.schedule ?? []).map(p => ({
    ...p,
    key: p.navDate,
  }));

  // 库里的月数不够用户要的期数：说清楚实际算了多少期，别让表格与用户预期对不上
  const truncated = backtest !== null && periods > backtest.periods;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 页标题出卡（liquid-glass spec §5.4）：标题直接压在色雾上 */}
      <div>
        <Title level={3} className="mb-1">基金定投回测</Title>
        <Paragraph type="secondary" className="mb-0">
          用真实历史净值算「定期定额买一只基金」的结果：累计投入、期末市值、
          年化收益、最大回撤与逐期明细。金额、频率（按月 / 按周 / 按天）与期数都可调，
          申购费按站内真实撮合的内扣法计，并与同期一次性买入对照。
        </Paragraph>
      </div>

      <ParamsCard
        key={paramsKey}
        code={code}
        fundName={fundName}
        isDefault={isDefault}
        availablePeriods={availablePeriods}
        q={q}
        results={results}
        notices={notices}
        initial={{ amountCents, frequency, periods, adjust }}
      />

      {truncated
        ? (
            <Alert
              type="info"
              showIcon
              className="animate-fade-up animate-delay-[60ms]"
              message={`这只基金库里的净值只够 ${backtest.periods} 期，已按 ${backtest.periods} 期回测`}
            />
          )
        : null}

      {backtest
        ? (
            <>
              <SectionCard title="回测结果" className="animate-fade-up animate-delay-[60ms]">
                <Space size={[16, 16]} wrap>
                  <StatBig label="累计投入" value={fmtYuan(backtest.investedCents)} suffix="元" size={24} />
                  <StatBig label="期末市值" value={fmtYuan(backtest.finalValueCents)} suffix="元" size={24} />
                  <StatBig
                    label="累计收益率"
                    value={signed(backtest.returnRate)}
                    size={24}
                    color={pnlColor(backtest.returnRate)}
                  />
                  <StatBig label="最大回撤" value={rateToPercent(backtest.maxDrawdown)} size={24} />
                </Space>
                <div className="mt-4">
                  <DataRow
                    label="年化收益率（资金加权）"
                    value={backtest.annualizedRate === null
                      ? "区间不足半年，不折算"
                      : signed(backtest.annualizedRate)}
                    mono
                  />
                  <DataRow label="平均成本净值（含费）" value={navToDisplay(backtest.avgCostNav)} mono />
                  <DataRow
                    label="同期一次性买入"
                    value={signed(backtest.lumpSumRate)}
                    mono
                  />
                  <DataRow
                    label="定投频率与期数"
                    value={`${DCA_FREQUENCY_LABELS[backtest.frequency]} · ${backtest.periods} 期`}
                    mono
                  />
                  <DataRow
                    label="回测区间"
                    value={`${backtest.from} ~ ${backtest.to}`}
                    mono
                  />
                  <DataRow
                    label={`申购费率（${adjust === "unit" ? "单位净值" : "累计净值"}口径）`}
                    value={rateToPercent(purchaseRate)}
                    mono
                    last
                  />
                </div>
              </SectionCard>

              <SectionCard title="逐期明细" className="animate-fade-up animate-delay-[120ms]">
                <div className="fp-h-scroll">
                  <Table<ScheduleRow>
                    size="small"
                    rowKey="key"
                    // 按天定投会有几百行：分页后 SSR 只渲染当前页（爬虫拿到的也不是
                    // 几百行的巨型 HTML），单页时（比如按月 12 期）不显示翻页器
                    pagination={{ pageSize: 12, size: "small", hideOnSinglePage: true }}
                    columns={columns}
                    dataSource={rows}
                  />
                </div>
                <Paragraph type="secondary" className="mt-3 mb-0 text-[12px]">
                  每期在该期首个有净值的交易日买入并立刻按当日净值估值；累计投入与累计收益率是
                  <Text strong>截至本期</Text>
                  的值，最后一行的累计投入等于概览里的总投入。金额单位：元。
                </Paragraph>
              </SectionCard>

              <SectionCard title="累计投入与持仓市值" className="animate-fade-up animate-delay-[180ms]">
                <DcaBacktestChart curve={dcaCurvePoints(backtest)} />
                <Paragraph type="secondary" className="mt-3 mb-0 text-[12px]">
                  市值线跑到成本线之上就是赚、之下就是亏。每期一个点，再加期末那次估值——
                  两条线的终点与概览里的「期末市值」同源；定投的现金本来就是每期进一次，
                  逐日曲线不会多出决策信息。
                </Paragraph>
              </SectionCard>
            </>
          )
        : (
            <SectionCard title="回测结果" className="animate-fade-up animate-delay-[60ms]">
              <EmptyState
                description={code ? "这只基金的净值历史还不够算回测" : "先选一只基金"}
                hint={code
                  ? `回测至少要 ${DCA_BACKTEST_MIN_PERIODS} 期净值（当前频率：${DCA_FREQUENCY_LABELS[frequency]}）；换一只成立更久、或本站已同步过净值的基金试试`
                  : "在上方搜索基金代码或名称，选中后立刻出结果"}
              />
            </SectionCard>
          )}

      <SectionCard title="口径说明" className="animate-fade-up animate-delay-[240ms]">
        <Paragraph className="mb-3">
          <Text strong>买入日 = 每期首个有净值的交易日</Text>
          ：不查节假日表——有净值的那天必然是交易日，逢休市或长假自然顺延；
          某期整期没有净值数据就跳过该期，不拿邻期顶替。回测的净值来自本站库里
          逐日同步的真实数据，K 线之外的每个数字都是算出来的，不是抄来的。
        </Paragraph>
        <Paragraph className="mb-3">
          <Text strong>频率三档：按月 / 按周 / 按天</Text>
          ：按月是每个自然月首个有净值的交易日；按周是每个
          <Text strong>自然周</Text>
          （周一~周日）的首个交易日——不是「每 7 天」，跨年那一周不会被切成两期；
          按天就是每个交易日都买。期数决定窗口长度（按天 250 期 ≈ 一年交易日），
          而次数越多申购费也按次多扣——这正是高频定投的隐性成本。
        </Paragraph>
        <Paragraph className="mb-3">
          <Text strong>申购费走内扣法</Text>
          ：净申购金额 = 每期金额 ÷ (1 + 费率)，费率取该基金在站内的真实费率，
          与模拟盘下单用的是同一个函数。投入记毛额（你实际付出的钱），费用体现在份额上。
          常见误算是「金额 × (1 − 费率)」（外扣法），那样费用会多扣。
        </Paragraph>
        <Paragraph className="mb-3">
          <Text strong>净值口径可选</Text>
          ：默认用累计净值，等价于「分红再投」；切成单位净值就是分红不参与再投。
          累计净值缺失的老数据会回落到单位净值。
        </Paragraph>
        <Paragraph className="mb-3">
          <Text strong>最大回撤</Text>
          取「已投份额市值」的峰谷：还没投出去的钱不算持有，否则定投的回撤会被
          现金垫子永远压成 0，失去意义。
        </Paragraph>
        <Paragraph className="mb-3">
          <Text strong>年化收益率是资金加权（XIRR）</Text>
          ：按每笔现金流各自的日期折算，不是「总收益率 ÷ 年数」（定投的钱是分批进的，
          那样算会高估）。区间不足半年不折算——3 个月涨 50% 折成年化是 +1000% 这种
          误导性数字，页面宁可显示「不折算」。
        </Paragraph>
        <Paragraph type="secondary" className="mb-0 text-[12px]">
          回测用的是历史净值，不代表未来收益；本页不构成投资建议。
        </Paragraph>
      </SectionCard>

      <SectionCard className="animate-fade-up animate-delay-[300ms]">
        <Space wrap>
          <NavButton to="/funds">去挑一只基金</NavButton>
          <NavButton to="/tools/fee-calculator">算一下申购赎回费</NavButton>
          <NavButton to="/leaderboard">看收益排行榜</NavButton>
        </Space>
      </SectionCard>
    </Space>
  );
}

/** 分 → 输入框里的元文本：整元不带小数（1000），有零头保留（2000.5） */
function amountDisplay(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : centsToYuan(cents).replace(/0$/, "");
}
