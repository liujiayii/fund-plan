import type { Route } from "./+types/tools.fee-calculator";
import { Input, Space, Typography } from "antd";
import { useState } from "react";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { navToDisplay, rateToPercent, sharesToDisplay, yuanToCents } from "~/domain/money";
import { calcPurchase } from "~/domain/purchase";
import { DEFAULT_REDEEM_TIERS, quoteRedeemByHoldDays } from "~/domain/redeem";
import { pageMeta } from "~/domain/seo";
import { pnlColor } from "~/theme";

const { Title, Paragraph, Text } = Typography;

/**
 * 基金费用计算器（公开落地页，/tools/fee-calculator）。
 *
 * 为什么值得单独做一页：**强意图长尾词**（"基金赎回费计算器""申购费 内扣法"
 * "阶梯赎回费率"）竞争小、转化明确，而本站恰好把这套规则实现过两遍
 * （下单走 calcPurchase、赎回走 FIFO 的 calcRedeem）——算出来的数字与站内真实
 * 账本同源，这是别家计算器给不了的。页面正文（公式、档位表、口径说明）
 * 全部 SSR 进 HTML，爬虫不跑 JS 也能读到。
 *
 * 页面内所有计算都在渲染期用 domain 纯函数完成，没有异步、没有副作用；
 * 首屏用一组常见默认值，保证爬虫与"没填就想看看"的用户都能立刻看到结果。
 */

/** 表单初值（受控 Input 的天然类型就是字符串，别让它收窄成字面量类型） */
interface FormInitial {
  amountYuan: string;
  ratePercent: string;
  buyNav: string;
  holdDays: string;
  sellNav: string;
}

/** 试算表单默认值：刻意给一组常见数字，让首屏就有结果 */
const DEFAULTS = {
  amountYuan: "10000",
  ratePercent: "1.50",
  buyNav: "1.0000",
  holdDays: "30",
  sellNav: "1.2000",
} as const;

export function meta(_: Route.MetaArgs) {
  return pageMeta({
    title: "基金费用计算器",
    description:
      "申购费内扣法 + FIFO 阶梯赎回费的真口径试算：输入金额、费率、净值与持有天数，算出净申购金额、确认份额、适用费率档、赎回费与到账金额。",
    path: "/tools/fee-calculator",
  });
}

/**
 * 从基金页的「赎回费率阶梯」卡带参进来时预填（`?rate=150&nav=12345`，
 * 分别是万分之费率与 ×10000 的净值——与库里口径一致，省得基金页做转换）。
 * 参数越界/非法一律回落默认值：这是公开页，别让 URL 把首屏填成乱码。
 */
export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // ⚠️ 参数缺失时 get() 返回 null，而 Number(null) === 0——直接 Number() 会把
  // "没带参"误判成"费率 0%"，首屏静默少算申购费（本地冒烟实测抓到过）。
  // 先判 null，再交给同一个合法性检查
  const rateParam = url.searchParams.get("rate");
  const navParam = url.searchParams.get("nav");
  const rate = rateParam === null ? Number.NaN : Number(rateParam);
  const nav = navParam === null ? Number.NaN : Number(navParam);
  const initial: FormInitial = {
    amountYuan: DEFAULTS.amountYuan,
    ratePercent:
        Number.isFinite(rate) && rate >= 0 && rate <= 500
          ? (rate / 100).toFixed(2)
          : DEFAULTS.ratePercent,
    buyNav:
        Number.isFinite(nav) && nav > 0 && nav <= 100_000
          ? navToDisplay(Math.round(nav))
          : DEFAULTS.buyNav,
    holdDays: DEFAULTS.holdDays,
    sellNav: DEFAULTS.sellNav,
  };
  return { initial };
}

/** 一行带标签的输入。antd Input 受控，值统一是字符串，渲染期再解析 */
function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] text-muted">{label}</span>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        inputMode="decimal"
        suffix={suffix ? <span className="text-[12px] text-placeholder">{suffix}</span> : undefined}
      />
    </label>
  );
}

export default function FeeCalculator({ loaderData }: Route.ComponentProps) {
  const { initial } = loaderData;
  const [amountYuan, setAmountYuan] = useState(initial.amountYuan);
  const [ratePercent, setRatePercent] = useState(initial.ratePercent);
  const [buyNav, setBuyNav] = useState(initial.buyNav);
  const [holdDays, setHoldDays] = useState(initial.holdDays);
  const [sellNav, setSellNav] = useState(initial.sellNav);

  // 纯计算 + try/catch：输入是自由文本，解析失败就给提示，绝不把页面打崩
  const result = (() => {
    try {
      const amountCents = yuanToCents(amountYuan.trim());
      const purchaseRate = Math.round(Number(ratePercent) * 100); // % → 万分之
      const buyNavScaled = Math.round(Number(buyNav) * 10000);
      const days = Math.floor(Number(holdDays));
      const sellNavScaled = Math.round(Number(sellNav) * 10000);

      if (!Number.isFinite(amountCents) || amountCents <= 0)
        throw new Error("申购金额要大于 0");
      if (!Number.isFinite(purchaseRate) || purchaseRate < 0 || purchaseRate > 500)
        throw new Error("申购费率请在 0% ~ 5% 之间");
      if (!Number.isFinite(buyNavScaled) || buyNavScaled <= 0)
        throw new Error("买入净值要大于 0");
      if (!Number.isFinite(days) || days < 0)
        throw new Error("持有天数不能为负");
      if (!Number.isFinite(sellNavScaled) || sellNavScaled <= 0)
        throw new Error("赎回净值要大于 0");

      const buy = calcPurchase({ amountCents, navScaled: buyNavScaled, purchaseRate });
      const sell = quoteRedeemByHoldDays({
        sharesScaled: buy.sharesScaled,
        navScaled: sellNavScaled,
        holdDays: days,
        tiers: DEFAULT_REDEEM_TIERS,
      });
      return {
        ok: true as const,
        amountCents,
        buy,
        sell,
        pnlCents: sell.netCents - amountCents,
      };
    }
    catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : "输入有误" };
    }
  })();

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <SectionCard className="animate-fade-up">
        <Title level={3} style={{ marginTop: 0 }}>
          基金费用计算器
        </Title>
        <Paragraph type="secondary" className="mb-0">
          按本站模拟盘的真实规则试算：申购费走
          <Text strong>内扣法</Text>
          （净申购金额 = 金额 ÷ (1 + 费率)），赎回费按
          <Text strong>持有天数查阶梯档位</Text>
          。算法与站内下单、赎回用的是同一份实现，数字对得上。
        </Paragraph>
      </SectionCard>

      <SectionCard title="输入" className="animate-fade-up animate-delay-[60ms]">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="申购金额" value={amountYuan} onChange={setAmountYuan} suffix="元" />
          <Field label="申购费率" value={ratePercent} onChange={setRatePercent} suffix="%" />
          <Field label="买入确认净值" value={buyNav} onChange={setBuyNav} suffix="元/份" />
          <Field label="持有天数" value={holdDays} onChange={setHoldDays} suffix="天" />
          <Field label="赎回确认净值" value={sellNav} onChange={setSellNav} suffix="元/份" />
        </div>
      </SectionCard>

      {result.ok
        ? (
            <>
              <SectionCard title="试算结果" className="animate-fade-up animate-delay-[120ms]">
                <Space size={[16, 16]} wrap>
                  <StatBig
                    label="到账金额"
                    value={fmtYuan(result.sell.netCents)}
                    suffix="元"
                  />
                  <StatBig
                    label="净收益"
                    value={`${result.pnlCents > 0 ? "+" : ""}${fmtYuan(result.pnlCents)}`}
                    suffix="元"
                    color={pnlColor(result.pnlCents)}
                  />
                </Space>
                <div className="mt-4">
                  <DataRow label="申购金额" value={`${fmtYuan(result.amountCents)} 元`} mono />
                  <DataRow
                    label="净申购金额（真正买份额的钱）"
                    value={`${fmtYuan(result.buy.netAmountCents)} 元`}
                    mono
                  />
                  <DataRow
                    label="申购费用（内扣）"
                    value={`${fmtYuan(result.buy.feeCents)} 元`}
                    mono
                  />
                  <DataRow
                    label="确认份额"
                    value={`${sharesToDisplay(result.buy.sharesScaled, 4)} 份`}
                    mono
                  />
                  <DataRow label="赎回金额（未扣费）" value={`${fmtYuan(result.sell.grossCents)} 元`} mono />
                  <DataRow
                    label={`适用赎回费率（持有 ${holdDays} 天）`}
                    value={rateToPercent(result.sell.rate)}
                    mono
                    last
                  />
                  <DataRow label="赎回费" value={`${fmtYuan(result.sell.feeCents)} 元`} mono />
                  <DataRow label="到账金额" value={`${fmtYuan(result.sell.netCents)} 元`} mono last />
                </div>
              </SectionCard>
            </>
          )
        : (
            <SectionCard title="试算结果" className="animate-fade-up animate-delay-[120ms]">
              <Paragraph type="warning" className="mb-0">
                {result.message}
              </Paragraph>
            </SectionCard>
          )}

      <SectionCard title="费率口径" className="animate-fade-up animate-delay-[180ms]">
        <Paragraph className="mb-3">
          <Text strong>申购费是内扣的</Text>
          ：费用从你付的钱里扣，而不是在金额之外另收。所以 10000 元按 1.5% 申购，
          净申购金额是 10000 ÷ 1.015 ≈ 9852.22 元，申购费 ≈ 147.78 元。
          （常见误算成 10000 × 1.5% = 150 元——那是外扣法，与真实对账对不上。）
        </Paragraph>
        <Paragraph className="mb-3">
          <Text strong>赎回费按批次查阶梯</Text>
          ：同一只基金的份额按确认日
          <Text strong>先进先出</Text>
          逐批消耗，每批按自己的持有天数查下表档位。所以一笔赎回可能同时按两档费率计费——
          本站持仓详情页的赎回抽屉走的就是这套 FIFO 逻辑，本页是单批试算。
        </Paragraph>
        <div className="mb-3">
          {DEFAULT_REDEEM_TIERS.map((t, i) => (
            <DataRow
              key={t.minDays}
              label={
                t.maxDays === null
                  ? `持有满 ${t.minDays} 天`
                  : `持有 ${t.minDays} ~ 不满 ${t.maxDays} 天`
              }
              value={rateToPercent(t.rate)}
              mono
              last={i === DEFAULT_REDEEM_TIERS.length - 1}
            />
          ))}
        </div>
        <Paragraph type="secondary" className="mb-3 text-[12px]">
          档位是公募基金通行值；个别基金在档案里另有覆盖，实际以下单页面的费率为准。
          试算不含分红再投、认申购期间的净值波动差异。
        </Paragraph>
        <Paragraph type="secondary" className="mb-0 text-[12px]">
          本页只是费用口径的试算工具，不构成投资建议。
        </Paragraph>
      </SectionCard>

      <SectionCard className="animate-fade-up animate-delay-[240ms]">
        <Space wrap>
          <NavButton to="/funds">去挑一只基金</NavButton>
          <NavButton to="/leaderboard">看收益排行榜</NavButton>
        </Space>
      </SectionCard>
    </Space>
  );
}
