import type { DcaBacktestResult } from "~/domain/dca-backtest";
import { Space, Typography } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { navToDisplay, rateToPercent } from "~/domain/money";
import { pnlColor } from "~/theme";

const { Paragraph } = Typography;

export interface DcaBacktestCardProps {
  /** 回测结果（由 runDcaBacktest 算出，期数不足时调用方不渲染本卡） */
  result: DcaBacktestResult;
  /** 每期投入（分）：文案里的金额必须与算的一致，所以由调用方传入而不是写死 */
  amountCents: number;
  /** 申购费率（万分之）：文案要说清费用口径 */
  purchaseRate: number;
  className?: string;
}

/**
 * 基金页的「定投回测」卡。
 *
 * 数字全部来自我们库里的逐日净值（domain/dca-backtest 纯函数），
 * 不是东财的字段——这是这一页唯一「别处抄不到」的内容，也是搜索引擎
 * 愿意收录它的理由（2026-09-17 关键词方向的结论）。
 *
 * 口径文案必须与 domain/dca-backtest 的文件头注释一致：每月首个交易日、
 * 内扣申购费、累计净值（分红再投）。改口径要同步改这里。
 */
export function DcaBacktestCard({
  result,
  amountCents,
  purchaseRate,
  className,
}: DcaBacktestCardProps) {
  // 正号拼接沿用页面既有写法（日涨跌那格同款），不额外抽公共函数
  const signed = (rate: number) => `${rate > 0 ? "+" : ""}${rateToPercent(rate)}`;

  return (
    <SectionCard title="定投回测" className={className}>
      <Space size={[16, 16]} wrap>
        <StatBig label="累计投入" value={fmtYuan(result.investedCents)} suffix="元" size={24} />
        <StatBig label="期末市值" value={fmtYuan(result.finalValueCents)} suffix="元" size={24} />
        <StatBig
          label="累计收益率"
          value={signed(result.returnRate)}
          size={24}
          color={pnlColor(result.returnRate)}
        />
        <StatBig label="最大回撤" value={rateToPercent(result.maxDrawdown)} size={24} />
      </Space>

      <Paragraph type="secondary" className="mt-3 mb-0 text-[12px]">
        {result.from}
        {" ~ "}
        {result.to}
        ，每月首个交易日买入
        {" "}
        {fmtYuan(amountCents)}
        {" "}
        元、共
        {" "}
        {result.periods}
        {" "}
        期，平均成本净值
        {" "}
        {navToDisplay(result.avgCostNav)}
        ；同期一次性买入
        {" "}
        {signed(result.lumpSumRate)}
        。净值取累计净值（分红再投），申购费按
        {" "}
        {rateToPercent(purchaseRate)}
        {" "}
        内扣，与站内真实撮合同口径。
      </Paragraph>
    </SectionCard>
  );
}
