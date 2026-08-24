import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Space,
  Table,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { useFetcher } from 'react-router';
import {
  centsToYuan,
  navToDisplay,
  rateToPercent,
  sharesToDisplay,
  SHARE_SCALE,
} from '~/domain/money';
import { calcRedeem, type RedeemTier, type ShareLotInput } from '~/domain/redeem';

const { Text, Paragraph } = Typography;

export interface SellDrawerProps {
  open: boolean;
  onClose: () => void;
  fundCode: string;
  fundName: string;
  /** 可赎回份额 ×10000（已扣除待确认赎回单占用） */
  availableSharesScaled: number;
  /** 最新净值 ×10000 */
  navScaled: number;
  navDate: string | null;
  /** 该基金的份额批次，用于 FIFO 费用试算 */
  lots: ShareLotInput[];
  tiers: RedeemTier[];
  /** 预计确认日（用于算持有天数） */
  confirmDate: string;
  action: string;
}

/**
 * 赎回抽屉。亮点是**按 FIFO 逐批试算赎回费**并展示明细——
 * 让用户看清「哪批持有多久、按几档费率、扣多少钱」，
 * 这是模拟盘能教会人东西的地方。
 */
export function SellDrawer(props: SellDrawerProps) {
  const {
    open, onClose, fundCode, fundName, availableSharesScaled,
    navScaled, navDate, lots, tiers, confirmDate, action,
  } = props;

  const [sharesInput, setSharesInput] = useState('');
  const fetcher = useFetcher();
  const submitting = fetcher.state === 'submitting';

  const sharesScaled = useMemo(() => {
    const n = Number(sharesInput);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * SHARE_SCALE);
  }, [sharesInput]);

  const overLimit = sharesScaled > availableSharesScaled;

  // FIFO 试算
  const estimate = useMemo(() => {
    if (sharesScaled <= 0 || overLimit || navScaled <= 0 || lots.length === 0) {
      return null;
    }
    try {
      return calcRedeem({
        lots,
        redeemSharesScaled: sharesScaled,
        navScaled,
        confirmDate,
        tiers,
      });
    } catch {
      return null;
    }
  }, [sharesScaled, overLimit, navScaled, lots, confirmDate, tiers]);

  const canSubmit = sharesScaled > 0 && !overLimit && !submitting;

  return (
    <Drawer
      title={`赎回 ${fundName}`}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
    >
      <fetcher.Form method="post" action={action}>
        <input type="hidden" name="intent" value="sell" />
        <input type="hidden" name="fundCode" value={fundCode} />

        <Descriptions
          size="small"
          column={1}
          bordered
          style={{ marginBottom: 16 }}
          items={[
            { key: 'code', label: '基金代码', children: fundCode },
            {
              key: 'nav',
              label: '最新净值',
              children: `${navToDisplay(navScaled)}${navDate ? `（${navDate}）` : ''}`,
            },
            {
              key: 'avail',
              label: '可赎份额',
              children: `${sharesToDisplay(availableSharesScaled)} 份`,
            },
            { key: 'confirm', label: '预计确认日', children: confirmDate },
          ]}
        />

        <Form.Item label="赎回份额" layout="vertical" style={{ marginBottom: 12 }}>
          <Input
            name="shares"
            size="large"
            inputMode="decimal"
            placeholder={`最多 ${sharesToDisplay(availableSharesScaled)} 份`}
            value={sharesInput}
            onChange={(e) => setSharesInput(e.target.value)}
            suffix="份"
          />
        </Form.Item>

        <Space wrap style={{ marginBottom: 16 }}>
          {[
            { label: '25%', ratio: 0.25 },
            { label: '50%', ratio: 0.5 },
            { label: '75%', ratio: 0.75 },
            { label: '全部', ratio: 1 },
          ].map((b) => (
            <Button
              key={b.label}
              size="small"
              onClick={() =>
                setSharesInput(
                  (
                    Math.floor(availableSharesScaled * b.ratio) / SHARE_SCALE
                  ).toFixed(4),
                )
              }
            >
              {b.label}
            </Button>
          ))}
        </Space>

        {overLimit && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={`超过可赎份额 ${sharesToDisplay(availableSharesScaled)} 份`}
          />
        )}

        {/* FIFO 逐批费用明细 */}
        {estimate && (
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message="赎回费用预估（先进先出，逐批计费）"
            description={
              <div>
                <Table
                  size="small"
                  pagination={false}
                  style={{ marginBottom: 12 }}
                  rowKey="lotId"
                  dataSource={estimate.lotResults}
                  columns={[
                    {
                      title: '批次份额',
                      dataIndex: 'consumedSharesScaled',
                      align: 'right',
                      render: (v: number) => sharesToDisplay(v),
                    },
                    {
                      title: '持有天数',
                      dataIndex: 'holdDays',
                      align: 'right',
                      render: (v: number) => `${v} 天`,
                    },
                    {
                      title: '费率',
                      dataIndex: 'rate',
                      align: 'right',
                      render: (v: number) => rateToPercent(v),
                    },
                    {
                      title: '赎回费',
                      dataIndex: 'feeCents',
                      align: 'right',
                      render: (v: number) => `${centsToYuan(v)} 元`,
                    },
                  ]}
                />
                <div>
                  赎回总额：<Text strong>{centsToYuan(estimate.totalGrossCents)} 元</Text>
                </div>
                <div>
                  赎回费合计：
                  <Text strong type="danger">
                    {centsToYuan(estimate.totalFeeCents)} 元
                  </Text>
                </div>
                <div>
                  预计到账：
                  <Text strong style={{ color: '#c62828' }}>
                    {centsToYuan(estimate.totalNetCents)} 元
                  </Text>
                </div>
                <div>
                  已实现盈亏：
                  <Text
                    strong
                    style={{
                      color: estimate.realizedPnlCents >= 0 ? '#c62828' : '#2e7d32',
                    }}
                  >
                    {estimate.realizedPnlCents > 0 ? '+' : ''}
                    {centsToYuan(estimate.realizedPnlCents)} 元
                  </Text>
                </div>
                <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                  按最新净值试算，实际<Text strong>以确认日净值为准</Text>。
                  持有不满 7 天的批次赎回费高达 1.5%，可考虑再等等。
                </Paragraph>
              </div>
            }
          />
        )}

        {fetcher.data?.error && (
          <Alert type="error" showIcon message={fetcher.data.error} style={{ marginBottom: 16 }} />
        )}

        <Button
          type="primary"
          danger
          htmlType="submit"
          size="large"
          block
          loading={submitting}
          disabled={!canSubmit}
        >
          确认赎回
        </Button>
      </fetcher.Form>
    </Drawer>
  );
}
