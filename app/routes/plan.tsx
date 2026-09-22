import type { ReactNode } from "react";
import type { Route } from "./+types/plan";
import type { PlanRow } from "~/components/PlanBuysCard";
import { Space, Typography } from "antd";
import { PlanBuysCard } from "~/components/PlanBuysCard";
import { MethodCurve, TriVenn } from "~/components/PlanDiagrams";
import { AdminNotReady } from "~/components/PortfolioView";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { buildPlanMeta, pageMeta } from "~/domain/seo";
import { toBeijing } from "~/domain/trading-calendar";
import {
  allocateByWeight,
  currentPlanDay,
  parsePlanQuery,
  planTargetCents,
} from "~/domain/undervalued-plan";
import { getAppContext } from "~/services/context";
import { getAdminUser } from "~/services/guard";
import { getPlanPeriod } from "~/services/undervalued-plan";

const { Paragraph, Text } = Typography;

/**
 * 低估指数定投计划（公开页，`/plan`）。
 *
 * 这一页讲的是**主理人的实盘**：每周二他按低估指数理念买一批基金，页面跟着更新
 * （他没买的那一周就停在上一期）。品种与金额全部来自真实订单
 * （`services/undervalued-plan`），页面不维护一份写死的基金名单——
 * 主理人换了品种，这一页自己就变了。
 *
 * 为什么值得单独一页而不是塞进 `/master`：那边是「他持有什么」的全景账本，
 * 这边是「他这周买了什么、为什么这么买、我怎么跟」的**一期复盘 + 换算工具**。
 * 混在一起，两件事都讲不清（`/master` 的 tabs 里已经塞了四块）。
 *
 * 计算时机与 `/tools/dca-backtest` 一致：**服务端**。URL 即状态
 * （`?ratio=`），表单 GET 提交让 loader 重算，首屏的数字与明细都在
 * SSR 的 HTML 里，爬虫不跑 JS 也读得到；canonical 剥 query，参数变体不会变成
 * 一堆重复 URL。
 */
export function meta({ loaderData }: Route.MetaArgs) {
  const { title, description } = buildPlanMeta({
    period: loaderData?.period ?? null,
    fundCount: loaderData?.rows.length ?? 0,
    totalCents: loaderData?.masterTotalCents ?? 0,
  });
  return pageMeta({ title, description, path: "/plan" });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const url = new URL(request.url);
  const parsed = parsePlanQuery(url.searchParams);

  // 北京时间今天：本页所有「本周 / 上一期」的判断都以北京时间为准
  // （Worker 可能在 UTC 里跑，用本地时钟会在周二凌晨那几个小时判错一天）
  const today = toBeijing(new Date()).format("YYYY-MM-DD");
  const thisWeek = currentPlanDay(today);

  const admin = await getAdminUser(db, env);
  const view = admin
    ? await getPlanPeriod(db, admin.id, today)
    : { period: null, buys: [], totalCents: 0 };

  // 换算：以**主理人本期的买入合计**为基准 × 跟投比例，再按各基金的买入金额占比
  // 拆到每只上。纯函数在 domain 层（最大余数法，Σ一分不差），这里只管接线
  const targetCents = planTargetCents(view.totalCents, parsed.ratioBps);
  const mineMap = new Map(
    allocateByWeight(
      view.buys.map(b => ({ fundCode: b.fundCode, weightCents: b.amountCents })),
      targetCents,
    ).map(a => [a.fundCode, a.amountCents]),
  );

  const rows: PlanRow[] = view.buys.map(b => ({
    fundCode: b.fundCode,
    fundName: b.fundName,
    shortName: b.shortName,
    fundType: b.fundType,
    masterCents: b.amountCents,
    mineCents: mineMap.get(b.fundCode) ?? 0,
    minPurchaseCents: b.minPurchaseCents,
  }));

  return {
    ready: admin !== null,
    // 主理人还没注册时给个名字，页面照 /master 的口径显示引导而不是报错
    adminName: admin?.username ?? env.ADMIN_USERNAME ?? "未配置",
    today,
    period: view.period,
    // 页面上那一期不是本周二 → 说清「他这周还没买，这是上一期」
    stale: view.period !== null && thisWeek !== null && view.period !== thisWeek,
    rows,
    masterTotalCents: view.totalCents,
    targetCents,
    belowMinCount: rows.filter(r => r.minPurchaseCents > 0 && r.mineCents < r.minPurchaseCents).length,
    notices: parsed.notices,
    ratioBps: parsed.ratioBps,
  };
}

/**
 * 理念小节：小标题 + 一句正文 + 一张示意图。
 *
 *  试过「文左图右」的弹性两栏（图能大一圈），又退回来了（主人 2026-09-22 一眼看出不对）：
 *  「定投品种」「基金选择」的正文只有一行，左栏会剩下三百多像素的空白，跟右边的图
 *  完全不成比例；三块里只有「定投方法」文字够长、配得上两栏——同一张卡里混两种
 *  排版反而乱。上下堆叠与主人给的原图一致，图的大小靠 SVG 自己的 maxWidth 调。
 *
 * 2026-09-22 第四版改了两件事，都是为了「图不再淹在空板里」：
 *   1. 图框**贴着图身收窄**（`max-w-[552px]` / `max-w-[692px]` = SVG 的 maxWidth
 *      + 两侧 padding）。以前框撑满整卡（约 1008px），图只占中间 520px，
 *      左右各空 240px，三张图 = 三块空板——这是这一节最丑的地方
 *   2. 桌面 ≥md 时 01/02 两张 venn **并排两列**、03 定投方法满宽。
 *      与上次被否掉的「文左图右」是两回事：那次是**一行文案**去配一张大图，
 *      左栏自然剩下三百多像素空白；这次是两块**同构内容**并排，谁也不比谁空。
 *      移动端仍是一列（UnoCSS 的 md 断点，见 responsive 约定）
 *
 * 间距用 className 从外面给：并排时两列靠 grid 的 gap，堆叠时才要 mt-*，
 * 间距是版式的事，组件自己不该替调用方决定。
 */
function PhilosophyBlock({
  title,
  children,
  diagram,
  /** 满宽的图（定投方法曲线）走大一号的框；两张 venn 并排时用默认档 */
  wide = false,
  className,
}: {
  title: string;
  children: ReactNode;
  diagram: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    // flex-col + 正文 flex-1：两列并排时两个块被 grid 拉成等高，多出来的高度
    // 全给正文那一行，图框就被压到同一水平线上。否则「定投品种」的正文在两列里
    // 折成两行、「基金选择」只有一行，两张图的顶边差 20 多像素，一眼看得出歪
    <div className={`flex flex-col ${className ?? ""}`}>
      <div className="mb-2 text-[16px] font-semibold text-ink">{title}</div>
      <p className="mt-0 mb-3 flex-1 text-[14px] leading-relaxed text-muted">{children}</p>
      <div
        className={
          wide
            ? "mx-auto w-full max-w-[692px] rounded-[12px] bg-well p-4"
            : "mx-auto w-full max-w-[552px] rounded-[12px] bg-well p-4"
        }
      >
        {diagram}
      </div>
    </div>
  );
}

export default function PlanPage({ loaderData }: Route.ComponentProps) {
  const {
    ready,
    adminName,
    period,
    stale,
    rows,
    masterTotalCents,
    targetCents,
    belowMinCount,
    notices,
    ratioBps,
  } = loaderData;

  // 比例一变整卡重挂载：受控输入与提交用的字段都从 loaderData 重新初始化，
  // 不会出现「输入框显示 50%、算的却是 10%」（见 PlanBuysCard 顶注）
  const paramsKey = String(ratioBps);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 页头走站内规范「标题出卡」（liquid-glass spec §5.4）：标题直接压在色雾上，
          与 /master /leaderboard /tools/* 一致——之前那版把标题裹在玻璃卡里、
          右边还挂一张插画，在一堆平铺页头的页面里显得是另一套设计。
          标签用真 <h1>（全站目前只有首页有 h1，docs/seo.md 记为技术债），
          字号行高按 antd Title level={3} 的度量手写：这样既拿到了语义，
          又不必碰 level（它会连带字号一起变）。 */}
      <div>
        <h1 className="m-0 mb-1 text-[24px] leading-[1.35] font-semibold text-ink">
          低估指数定投计划
        </h1>
        <Paragraph type="secondary" className="mb-0">
          主理人每周二买入一批处于低估阶段的指数基金，这一页跟着他的实盘逐期更新；
          你也可以按自己的比例，一键换算出本期投入。
        </Paragraph>
      </div>

      {ready
        ? (
            <PlanBuysCard
              key={paramsKey}
              period={period}
              stale={stale}
              rows={rows}
              masterTotalCents={masterTotalCents}
              targetCents={targetCents}
              belowMinCount={belowMinCount}
              notices={notices}
              initial={{ ratioBps }}
            />
          )
        : (
            <SectionCard className="animate-fade-up">
              <AdminNotReady adminName={adminName} />
            </SectionCard>
          )}

      <SectionCard title="指数基金投资理念" className="animate-fade-up animate-delay-[60ms]">
        {/* 01 / 02 并排两列（窄屏回落成一列）：两张 venn 是同构内容，
            并排既不产生「文左图右」那种三百多像素的空白，也把这一节的高度砍掉近三成 */}
        <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
          <PhilosophyBlock
            title="定投品种"
            diagram={(
              <TriVenn
                idPrefix="plan-venn-variety"
                labels={["宽基指数基金", "策略指数基金", "行业指数基金"]}
                center={["低估阶段", "投资价值较高"]}
                ariaLabel="定投品种的挑选：在宽基、策略与行业指数基金里，选处于低估阶段、投资价值较高的"
              />
            )}
          >
            精选当前处于低估阶段，投资价值较高的宽基指数基金、策略指数基金以及优秀行业指数基金。
          </PhilosophyBlock>

          <PhilosophyBlock
            title="基金选择"
            diagram={(
              <TriVenn
                idPrefix="plan-venn-selection"
                // line 档：描边圈 + 虚线刻度环，与「定投品种」那枚实心雾圈拉开重量，
                // 不然两张图读起来是同一张印了两遍（构图不变，只换表现）
                variant="line"
                labels={["费率较低", "跟踪误差较小", "规模较大"]}
                center={["场外基金"]}
                ariaLabel="基金选择的三个条件：费率较低、跟踪误差较小、规模较大，集中在场外基金里挑"
              />
            )}
          >
            综合考虑，优先选择费率较低、跟踪误差较小、规模较大的场外基金。
          </PhilosophyBlock>
        </div>

        {/* 03 满宽：这条曲线是「时间轴上的动作」，本身就想要宽度 */}
        <PhilosophyBlock wide className="mt-6" title="定投方法" diagram={<MethodCurve />}>
          采用定期不定额投资，相比普通定投，基于市场估值调整定投金额，估值越低每周买入越多，
          未来有机会获得更好的长期收益。当定投品种的估值进入高估阶段，也会给出相应的分批止盈建议。
        </PhilosophyBlock>
      </SectionCard>

      {/* 底部提示：扁的材料（不模糊、不起一层玻璃），按 §4「必须是扁的」那一档 */}
      <div className="rounded-[12px] bg-well p-3 text-[12px] leading-relaxed text-tertiary">
        提示：该定投计划为低估指数基金投资实盘，仅作示例，页面内容均不构成任何投资建议。
      </div>

      <SectionCard className="animate-fade-up animate-delay-[120ms]">
        <Space wrap>
          <NavButton to="/master">看主理人的完整持仓</NavButton>
          <NavButton to="/tools/dca-backtest">算一下定投回测</NavButton>
          <NavButton to="/funds">去挑一只基金</NavButton>
        </Space>
        <Paragraph type="secondary" className="mt-3 mb-0 text-[12px]">
          品种与金额来自主理人的
          <Text strong>真实委托</Text>
          ，每周二他买入后这一页实时更新；他哪一周没买，页面就停在上一期，
          不会凭空造出一期。
        </Paragraph>
      </SectionCard>
    </Space>
  );
}
