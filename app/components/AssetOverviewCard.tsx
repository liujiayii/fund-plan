import type { DailyAsset } from "~/domain/asset-timeline";
import type { PortfolioValuation } from "~/domain/portfolio";
import { Col, Row } from "antd";
import Decimal from "decimal.js";
import { CountUpText } from "~/components/ui/count-up";
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
  /**
   * pending 买单的在途资金（分），/me 专用。
   * 买单冻结的现金已从余额扣、份额未生成，不并回的话 pending 窗口内
   * 总资产凭空少一笔——并回「持仓金额」与「总资产」，四格拆解才自洽
   * （总资产 = 持仓 + 余额）。/master 与首页不传，保持纯市值口径。
   */
  pendingBuyCents?: number;
}

/** 盈亏金额带符号：负号 fmtYuan 自带，正数补 +（沿用旧总览卡的手法） */
function signedYuan(cents: number): string {
  return `${cents > 0 ? "+" : ""}${fmtYuan(cents)}`;
}

/**
 * 资产总览卡（支付宝式）：总资产主位 + 昨日收益/累计收益/持仓金额/可用余额一行四格。
 * /me 与 /master 共用——主理人的盘就是公开盘，一份口径两种身份。
 *
 * 口径（spec §2/§8）：
 *  - 昨日收益 = 最新有净值交易日的 dayPnlCents（净值延迟同步、周末顺延），
 *    extra 标注「截至 M 月 D 日」，不写死字面上的昨天
 *  - 累计收益 = Σ dayPnl（含已实现盈亏与全部费用、剔除净入金），
 *    与资产走势曲线、收益日历逐日同口径
 *  - 累计收益率 = 累计收益 ÷ 累计投入本金（分母 0 显示 —，防御性兜底）
 *  - 持仓金额 = 市值 + 申购中在途（仅 /me 传 pendingBuyCents 时；标注「含申购中」）
 */
export function AssetOverviewCard({
  summary,
  daily,
  latest,
  totalDepositedCents,
  pendingBuyCents,
}: AssetOverviewCardProps) {
  // 在途资金：未传（公开镜像）视为 0，四个数字退化为纯市值口径
  const inFlightCents = pendingBuyCents ?? 0;

  // 累计收益：分整数域求和（远低于 2^53，零误差），与资产走势曲线同口径
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
      <StatBig
        label="总资产"
        // 辉光白名单之一（宪法 §2.4）：总资产
        glow="ink"
        value={(
          // 数字滚动：SSR 直出终值，客户端从 0 滚到位（spec §5 #3）
          <CountUpText
            value={summary.totalAssetCents + inFlightCents}
            format={v => fmtYuan(Math.round(v))}
          />
        )}
        suffix="元"
      />
      {/* 一行四格（xs 两列 / sm+ 单行）：四小格共用 size 20，
          桌面一行放下不折行；窄屏 2×2 保持可读 */}
      <Row gutter={[24, 16]} style={{ marginTop: 16 }}>
        <Col xs={12} sm={6}>
          {/* 昨日收益（原三小格版原样保留） */}
          <StatBig
            label="昨日收益"
            value={latest
              ? (
                  <CountUpText
                    value={latest.dayPnlCents}
                    format={v => signedYuan(Math.round(v))}
                  />
                )
              : "—"}
            suffix={latest ? "元" : undefined}
            color={latest ? pnlColor(latest.dayPnlCents) : undefined}
            // 辉光白名单之二：当日涨跌，同色辉光；0 或无数据不加
            glow={latest && latest.dayPnlCents !== 0 ? (latest.dayPnlCents > 0 ? "rise" : "fall") : undefined}
            size={20}
            extra={untilLabel ?? undefined}
          />
        </Col>
        <Col xs={12} sm={6}>
          {/* 累计收益（原样保留） */}
          <StatBig
            label="累计收益"
            value={signedYuan(totalPnlCents)}
            suffix="元"
            color={pnlColor(totalPnlCents)}
            size={20}
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
        <Col xs={12} sm={6}>
          {/* 持仓金额：市值 + 申购中在途（/me）。总资产 = 持仓 + 余额的拆解
              在 pending 窗口内依然成立（在途已从余额扣，这里补回到持仓侧） */}
          <StatBig
            label="持仓金额"
            value={fmtYuan(summary.marketValueCents + inFlightCents)}
            suffix="元"
            size={20}
            extra={inFlightCents > 0 ? `含申购中 ${fmtYuan(inFlightCents)} 元` : undefined}
          />
        </Col>
        <Col xs={12} sm={6}>
          <StatBig label="可用余额" value={fmtYuan(summary.cashCents)} suffix="元" size={20} />
        </Col>
      </Row>
    </div>
  );
}
