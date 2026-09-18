import type { DailyAsset } from "~/domain/asset-timeline";
import type { PortfolioValuation } from "~/domain/portfolio";
import { Col, Row } from "antd";
import { CountUpText } from "~/components/ui/count-up";
import { fmtRate, fmtSignedYuan, fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { StatBig } from "~/components/ui/StatBig";
import { safeRate } from "~/domain/money";
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
   * pending 买单的在途资金（分）。买单冻结的现金已从余额扣、份额未生成，
   * 不并回的话 pending 窗口内总资产凭空少一笔——并回「持仓金额」与「总资产」，
   * 四格拆解才自洽（总资产 = 持仓 + 余额）。
   * 三个身份（/me、/master、/admin/users/:id）**都必须传**：此前 /master 与首页
   * 刻意不传，导致每个交易日 10:00→20:30 之间同一个用户在两个公开页上的
   * 总资产不同（差额正好是当日定投额），净值拉不到顺延时能持续一整个周末。
   */
  pendingBuyCents?: number;
  /**
   * 可见性分层（2026-09-18 加）：
   *
   * - `private`（默认）：/me 与 /admin/users/:id。主位「总资产」，
   *   一行四格 = 昨日收益 / 累计收益 / 持仓金额 / 可用余额。
   * - `public`：/master 与首页。「总资产」「可用余额」是钱包信息，
   *   基金类产品从不向他人展示；主位换成「累计收益率」，
   *   一行三格 = 昨日收益 / 持仓金额 / 累计入金。持仓金额与累计入金是
   *   「仓位与投入」而非「钱包余额」，属于可以公示的投资信息。
   */
  visibility?: "private" | "public";
}

/** 盈亏金额带符号：负号 fmtYuan 自带，正数补 +（沿用旧总览卡的手法） */
function signedYuan(cents: number): string {
  return fmtSignedYuan(cents);
}

/**
 * 资产总览卡（支付宝式）：/me、/master、/admin/users/:id 共用——主理人的盘就是
 * 公开盘，一份口径三种身份。公开身份由 visibility 降级（见该字段注释）。
 *
 * 口径（spec §2/§8）：
 *  - 昨日收益 = 最新有净值交易日的 dayPnlCents（净值延迟同步、周末顺延），
 *    extra 标注「截至 M 月 D 日」，不写死字面上的昨天
 *  - 累计收益 = Σ dayPnl（含已实现盈亏与全部费用、剔除净入金），
 *    与资产走势曲线、收益日历逐日同口径
 *  - 累计收益率 = 累计收益 ÷ 累计投入本金（分母 0 显示 —，防御性兜底）。
 *    ⚠️ 这是**账户口径**（分母含没投出去的闲置现金），与持仓列表的
 *    「持有收益率」（分母是持仓成本）不是同一个数
 *  - 持仓金额 = 市值 + 申购中在途（传 pendingBuyCents 时；标注「含申购中」）
 */
export function AssetOverviewCard({
  summary,
  daily,
  latest,
  totalDepositedCents,
  pendingBuyCents,
  visibility = "private",
}: AssetOverviewCardProps) {
  // 在途资金：未传视为 0（正常情况下三个调用方都会传）
  const inFlightCents = pendingBuyCents ?? 0;
  const isPublic = visibility === "public";

  // 累计收益：分整数域求和（远低于 2^53，零误差），与资产走势曲线同口径
  const totalPnlCents = daily.reduce((s, d) => s + d.dayPnlCents, 0);
  // 累计收益率：Decimal 除法收口在 safeRate（分母 0 → null → 显示 —）
  const totalRate = safeRate(totalPnlCents, totalDepositedCents);
  const rateColor = totalRate === null ? undefined : pnlColor(totalRate);
  // 收益率辉光：辉光白名单（宪法 §2.4）。0 或不展示不加
  const rateGlow = totalRate === null || totalRate === 0
    ? undefined
    : (totalRate > 0 ? "rise" as const : "fall" as const);

  // 昨日收益的截至日期：去前导零（「9 月 5 日」而非「09 月 05 日」）
  const untilLabel = latest
    ? `截至 ${String(Number(latest.date.slice(5, 7)))} 月 ${String(Number(latest.date.slice(8, 10)))} 日`
    : null;

  /** 昨日收益格：私密 / 公开两版共用（公开侧不因分层而少信息） */
  const yesterdayCell = (
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
  );

  /** 累计收益格（不带率；率的落点由两版各自决定） */
  const cumCell = (
    <StatBig
      label="累计收益"
      value={signedYuan(totalPnlCents)}
      suffix="元"
      color={pnlColor(totalPnlCents)}
      size={20}
      extra={isPublic
        ? undefined
        : totalRate === null
          ? "收益率 —"
          : (
              <>
                收益率
                {" "}
                <PnlText rate={totalRate} size={12} />
              </>
            )}
    />
  );

  // 持仓金额格：市值 + 申购中在途。「总资产 = 持仓 + 余额」的拆解在 pending
  // 窗口内依然成立（在途已从余额扣，这里补回到持仓侧）
  const holdingCell = (
    <StatBig
      label="持仓金额"
      value={fmtYuan(summary.marketValueCents + inFlightCents)}
      suffix="元"
      size={20}
      extra={inFlightCents > 0 ? `含申购中 ${fmtYuan(inFlightCents)} 元` : undefined}
    />
  );

  if (isPublic) {
    return (
      <div>
        {/* 公开身份主位：累计收益率（相对数，不泄露资产规模） */}
        <StatBig
          label="累计收益率"
          glow={rateGlow}
          value={totalRate === null ? "—" : fmtRate(totalRate)}
          color={rateColor}
          extra={`累计收益 ${signedYuan(totalPnlCents)} 元`}
        />
        <Row gutter={[24, 16]} style={{ marginTop: 16 }}>
          <Col xs={12} sm={8}>{yesterdayCell}</Col>
          <Col xs={12} sm={8}>{cumCell}</Col>
          <Col xs={12} sm={8}>{holdingCell}</Col>
        </Row>
      </div>
    );
  }

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
          {yesterdayCell}
        </Col>
        <Col xs={12} sm={6}>
          {cumCell}
        </Col>
        <Col xs={12} sm={6}>
          {holdingCell}
        </Col>
        <Col xs={12} sm={6}>
          <StatBig label="可用余额" value={fmtYuan(summary.cashCents)} suffix="元" size={20} />
        </Col>
      </Row>
    </div>
  );
}
