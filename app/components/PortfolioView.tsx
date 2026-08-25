import type { HoldingView, PortfolioView } from "~/services/portfolio-service";
import { Col, Row, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { centsToYuan, navToDisplay } from "~/domain/money";
import { pnlColor } from "~/theme";
import { HoldingList } from "./HoldingList";

const { Paragraph } = Typography;

export interface PortfolioViewProps {
  portfolio: PortfolioView;
  /** 是否展示可用现金（公开盘只给总资产，不露现金明细） */
  showCash?: boolean;
}

/**
 * 组合总览。被 /me（本人）与 /master、/（公开只读）共用——
 * 主人的盘就是那个公开盘，一份代码两种身份。
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
          value={centsToYuan(summary.totalAssetCents)}
          suffix="元"
        />
      </Col>
      <Col xs={12} md={6}>
        <StatBig
          label="持仓市值"
          value={centsToYuan(summary.marketValueCents)}
          suffix="元"
          size={24}
        />
      </Col>
      {showCash && (
        <Col xs={12} md={6}>
          <StatBig
            label="可用现金"
            value={centsToYuan(summary.cashCents)}
            suffix="元"
            size={24}
          />
        </Col>
      )}
      <Col xs={12} md={6}>
        <StatBig
          label="浮动盈亏"
          value={`${summary.totalPnlCents > 0 ? "+" : ""}${centsToYuan(summary.totalPnlCents)}`}
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
  return (
    <HoldingList
      holdings={holdings}
      // 净值与其日期必须露出：净值可能合法滞后数天（拉不到净值时订单顺延），
      // 不标估值时点，围观者就分不清今天的估值与上周五的估值。
      // 逐行标注比页面级单一日期更准 —— 各基金的净值日期可能不同。
      //
      // ⚠️ 无 navDate 时返回 undefined 而非 null：FundListItem 的 note
      // 判空是 `!== undefined`，返回 null 会通过守卫并渲染出空的 div。
      renderNote={h =>
        h.navDate ? `净值 ${navToDisplay(h.navScaled)}（${h.navDate}）` : undefined}
    />
  );
}

/** 主人还没注册时的引导提示 */
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
              用该用户名注册即成为主人，其组合会自动对所有访客公开。
            </Paragraph>
          </div>
        )}
      />
    </SectionCard>
  );
}
