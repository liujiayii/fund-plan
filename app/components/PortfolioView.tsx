import type { HoldingView, PortfolioView } from "~/services/portfolio-service";
import { Col, Row, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { pnlColor } from "~/theme";
import { HoldingList, sharesAndNavNote } from "./HoldingList";

const { Paragraph } = Typography;

export interface PortfolioViewProps {
  portfolio: PortfolioView;
  /**
   * 是否展示「可用现金」这一格，默认展示。
   * 全站只有首页 `/` 的引流卡片传 false；/me 与 /master 都不传，即都露现金 ——
   * ⚠️ 别把它读成「公开盘不露现金」：/master 就是公开盘，它页面上写着
   * 「持仓、定投与交易流水全部公开」，藏现金反而自相矛盾。
   */
  showCash?: boolean;
}

/**
 * 组合总览。被 /me（本人）、/master 与 /（公开只读）三处共用 ——
 * 主理人的盘就是那个公开盘，一份代码两种身份。
 *
 * ⚠️ me._index 曾逐字复制过一份同样的 Row（期十三收掉），两份独立漂移过。
 * 要加字段就加在这里，别再复制。
 *
 * ⚠️ pnlColor 已迁到 ~/theme，本文件不再导出它。
 */
export function PortfolioSummary({
  portfolio,
  showCash = true,
}: PortfolioViewProps) {
  const { summary } = portfolio;
  return (
    <Row gutter={[24, 16]}>
      <Col xs={12} md={6}>
        <StatBig
          label="总资产"
          value={fmtYuan(summary.totalAssetCents)}
          suffix="元"
        />
      </Col>
      <Col xs={12} md={6}>
        <StatBig
          label="持仓市值"
          value={fmtYuan(summary.marketValueCents)}
          suffix="元"
          size={24}
        />
      </Col>
      {showCash && (
        <Col xs={12} md={6}>
          <StatBig
            label="可用现金"
            value={fmtYuan(summary.cashCents)}
            suffix="元"
            size={24}
          />
        </Col>
      )}
      <Col xs={12} md={6}>
        <StatBig
          label="浮动盈亏"
          value={`${summary.totalPnlCents > 0 ? "+" : ""}${fmtYuan(summary.totalPnlCents)}`}
          suffix="元"
          size={24}
          color={pnlColor(summary.totalPnlCents)}
          extra={(
            <>
              收益率
              {" "}
              <PnlText rate={summary.totalPnlRate} size={12} />
            </>
          )}
        />
      </Col>
    </Row>
  );
}

/** 持仓列表（只读版，公开页用） */
export function HoldingListReadonly({ holdings }: { holdings: HoldingView[] }) {
  if (holdings.length === 0) {
    return <EmptyState description="暂无持仓" />;
  }
  // 份额与估值时点必须露出，理由与条件渲染的取舍都在 sharesAndNavNote 里
  return <HoldingList holdings={holdings} renderNote={sharesAndNavNote} />;
}

/** 主理人还没注册时的引导提示 */
export function AdminNotReady({ adminName }: { adminName: string }) {
  return (
    <SectionCard>
      <EmptyState
        description={(
          <div>
            <Paragraph>
              管理员账号
              {" "}
              <Tag>{adminName}</Tag>
              {" "}
              还没注册，公开示范盘暂时为空。
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              用该用户名注册即成为主理人，其组合会自动对所有访客公开。
            </Paragraph>
          </div>
        )}
      />
    </SectionCard>
  );
}
