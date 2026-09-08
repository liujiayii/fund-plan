import type { DailyAsset } from "~/domain/asset-timeline";
import type { PortfolioValuation } from "~/domain/portfolio";
import { Col, Row } from "antd";
import Decimal from "decimal.js";
import { fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { StatBig } from "~/components/ui/StatBig";
import { pnlColor } from "~/theme";

export interface AssetOverviewCardProps {
  /** 组合汇总（总资产、可用余额） */
  summary: PortfolioValuation;
  /** 逐日资产序列（升序），来自 getAssetTimeline */
  daily: DailyAsset[];
  /** 最新一天快照；null（新用户无数据）时昨日收益显示 — */
  latest: DailyAsset | null;
  /** 累计投入本金（分）= 初始 + 历次签到。累计收益率的分母 */
  totalDepositedCents: number;
}

/** 盈亏金额带符号：负号 fmtYuan 自带，正数补 +（与 PortfolioSummary 同款手法） */
function signedYuan(cents: number): string {
  return `${cents > 0 ? "+" : ""}${fmtYuan(cents)}`;
}

/**
 * 资产总览卡（支付宝式）：总资产主位 + 昨日收益/累计收益/可用余额三小格。
 * /me 与 /master 共用——主理人的盘就是公开盘，一份口径两种身份。
 *
 * 口径（spec §2/§8）：
 *  - 昨日收益 = 最新有净值交易日的 dayPnlCents（净值延迟同步、周末顺延），
 *    extra 标注「截至 M 月 D 日」，不写死字面上的昨天
 *  - 累计收益 = Σ dayPnl（含已实现盈亏与全部费用、剔除净入金），
 *    与资产走势曲线、收益日历逐日同口径
 *  - 累计收益率 = 累计收益 ÷ 累计投入本金（分母 0 显示 —，防御性兜底）
 */
export function AssetOverviewCard({
  summary,
  daily,
  latest,
  totalDepositedCents,
}: AssetOverviewCardProps) {
  // 累计收益：分整数域求和（远低于 2^53，零误差），与 AssetPnlSummary/曲线同口径
  const totalPnlCents = daily.reduce((s, d) => s + d.dayPnlCents, 0);
  // 累计收益率：Decimal 除法（精度铁律：率也要走 Decimal）
  const totalRate = totalDepositedCents > 0
    ? new Decimal(totalPnlCents).div(totalDepositedCents).toNumber()
    : null;

  // 昨日收益的截至日期：去前导零（「9 月 5 日」而非「09 月 05 日」）
  const untilLabel = latest
    ? `截至 ${String(Number(latest.date.slice(5, 7)))} 月 ${String(Number(latest.date.slice(8, 10)))} 日`
    : null;

  return (
    <div>
      <StatBig label="总资产" value={fmtYuan(summary.totalAssetCents)} suffix="元" />
      <Row gutter={[24, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={8}>
          <StatBig
            label="昨日收益"
            value={latest ? signedYuan(latest.dayPnlCents) : "—"}
            suffix={latest ? "元" : undefined}
            color={latest ? pnlColor(latest.dayPnlCents) : undefined}
            size={24}
            extra={untilLabel ?? undefined}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatBig
            label="累计收益"
            value={signedYuan(totalPnlCents)}
            suffix="元"
            color={pnlColor(totalPnlCents)}
            size={24}
            extra={totalRate === null
              ? "收益率 —"
              : (
                  <>
                    收益率
                    {" "}
                    <PnlText rate={totalRate} size={12} />
                  </>
                )}
          />
        </Col>
        <Col xs={24} sm={8}>
          <StatBig label="可用余额" value={fmtYuan(summary.cashCents)} suffix="元" size={24} />
        </Col>
      </Row>
    </div>
  );
}
