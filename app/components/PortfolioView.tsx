import { Card, Col, Empty, Row, Statistic, Table, Tag, Typography } from 'antd';
import { centsToYuan, navToDisplay, sharesToDisplay } from '~/domain/money';
import type { HoldingView, PortfolioView } from '~/services/portfolio-service';

const { Text, Paragraph } = Typography;

/** 涨红跌绿（国内习惯） */
export function pnlColor(v: number): string | undefined {
  if (v > 0) return '#c62828';
  if (v < 0) return '#2e7d32';
  return undefined;
}

export interface PortfolioViewProps {
  portfolio: PortfolioView;
  /** 只读模式（公开围观）时不展示金额敏感的现金明细与操作 */
  readonly?: boolean;
  /** 是否隐藏现金（公开盘展示总资产即可） */
  showCash?: boolean;
  title?: string;
}

/**
 * 组合展示组件。被 /me（本人可操作）与 /master、/（公开只读）共用——
 * 主人的盘就是那个公开盘，一份代码两种身份。
 */
export function PortfolioSummary({
  portfolio,
  showCash = true,
}: PortfolioViewProps) {
  const { summary } = portfolio;
  return (
    <Row gutter={[24, 16]}>
      <Col xs={12} md={6}>
        <Statistic
          title="总资产"
          value={centsToYuan(summary.totalAssetCents)}
          suffix="元"
        />
      </Col>
      <Col xs={12} md={6}>
        <Statistic
          title="持仓市值"
          value={centsToYuan(summary.marketValueCents)}
          suffix="元"
        />
      </Col>
      {showCash && (
        <Col xs={12} md={6}>
          <Statistic
            title="可用现金"
            value={centsToYuan(summary.cashCents)}
            suffix="元"
          />
        </Col>
      )}
      <Col xs={12} md={6}>
        <Statistic
          title="浮动盈亏"
          value={centsToYuan(summary.totalPnlCents)}
          suffix="元"
          valueStyle={{ color: pnlColor(summary.totalPnlCents) }}
          prefix={summary.totalPnlCents > 0 ? '+' : ''}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          收益率 {(summary.totalPnlRate * 100).toFixed(2)}%
        </Text>
      </Col>
    </Row>
  );
}

/** 持仓表格（只读版，公开页用） */
export function HoldingTableReadonly({ holdings }: { holdings: HoldingView[] }) {
  if (holdings.length === 0) {
    return <Empty description="暂无持仓" />;
  }

  return (
    <Table<HoldingView>
      rowKey="fundCode"
      dataSource={holdings}
      pagination={false}
      scroll={{ x: 760 }}
      columns={[
        {
          title: '基金',
          dataIndex: 'fundName',
          fixed: 'left',
          width: 200,
          render: (name: string, r) => (
            <a href={`/funds/${r.fundCode}`}>
              {name}
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {r.fundCode}
                {r.fundType ? ` · ${r.fundType}` : ''}
              </Text>
            </a>
          ),
        },
        {
          title: '持有份额',
          dataIndex: 'sharesScaled',
          align: 'right',
          render: (v: number) => sharesToDisplay(v),
        },
        {
          title: '净值',
          dataIndex: 'navScaled',
          align: 'right',
          render: (v: number, r) => (
            <span>
              {navToDisplay(v)}
              {r.navDate && (
                <>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.navDate}
                  </Text>
                </>
              )}
            </span>
          ),
        },
        {
          title: '市值',
          dataIndex: 'marketValueCents',
          align: 'right',
          render: (v: number) => `${centsToYuan(v)} 元`,
        },
        {
          title: '盈亏',
          dataIndex: 'pnlCents',
          align: 'right',
          render: (v: number, r) => (
            <span style={{ color: pnlColor(v) }}>
              {v > 0 ? '+' : ''}
              {centsToYuan(v)}
              <br />
              <Text style={{ color: pnlColor(v), fontSize: 12 }}>
                {(r.pnlRate * 100).toFixed(2)}%
              </Text>
            </span>
          ),
        },
      ]}
    />
  );
}

/** 主人还没注册时的引导提示 */
export function AdminNotReady({ adminName }: { adminName: string }) {
  return (
    <Card>
      <Empty
        description={
          <div>
            <Paragraph>
              管理员账号 <Tag>{adminName}</Tag> 还没注册，公开示范盘暂时为空。
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              用该用户名注册即成为主人，其组合会自动对所有访客公开。
            </Paragraph>
          </div>
        }
      />
    </Card>
  );
}
