import type { DailyAsset } from "~/domain/asset-timeline";
import { Col, Row } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { StatBig } from "~/components/ui/StatBig";
import { pnlColor } from "~/theme";

/**
 * 资产收益摘要：单日收益 + 累计收益 两格并排。
 * 被 /me 与 /master 的「资产走势」卡共用——主理人的盘与自己的盘一份口径。
 *
 * ⚠️ 为什么要两格：曾只显示 latest.dayPnlCents（单日口径）且标签只写「收益」，
 * 用户必然读成「总收益」，与组合总览「浮动盈亏」（累计未实现口径）打架。
 * 两个口径都对，只摆一个必被误读（2026-08-31 主理人实测反馈：
 * 浮动盈亏 +11.40 元 vs 「收益」-6.98 元，后者其实是 8/28 单日回撤）。
 */
export function AssetPnlSummary({
  daily,
  latest,
}: {
  /** 逐日资产序列（升序），来自 getAssetTimeline */
  daily: DailyAsset[];
  /** 最新一天快照，daily 非空时与末位元素同值；null 时不渲染 */
  latest: DailyAsset | null;
}) {
  if (!latest)
    return null;

  // 累计收益 = Σ dayPnl。与收益日历逐日口径一致：
  // 含已实现盈亏与全部费用（申购内扣、赎回费），净入金已逐日扣除。
  // 它与「浮动盈亏」（未实现口径）的差异就是已落袋的部分。
  const totalPnlCents = daily.reduce((s, d) => s + d.dayPnlCents, 0);

  // 去前导零：Number("08") → 8，显示「8 月 28 日」而非「08 月 28 日」
  const [m, d] = latest.date.slice(5).split("-");

  return (
    <Row gutter={[24, 16]}>
      <Col xs={24} sm={12}>
        <StatBig
          label={`单日收益（截至 ${String(Number(m))} 月 ${String(Number(d))} 日）`}
          value={`${latest.dayPnlCents > 0 ? "+" : ""}${fmtYuan(latest.dayPnlCents)}`}
          suffix="元"
          color={pnlColor(latest.dayPnlCents)}
          size={24}
        />
      </Col>
      <Col xs={24} sm={12}>
        <StatBig
          label="累计收益"
          value={`${totalPnlCents > 0 ? "+" : ""}${fmtYuan(totalPnlCents)}`}
          suffix="元"
          color={pnlColor(totalPnlCents)}
          size={24}
        />
      </Col>
    </Row>
  );
}
