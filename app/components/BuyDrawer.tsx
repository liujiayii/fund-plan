import { Alert, Button, Drawer, Form, Input, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import { centsToYuan, navToDisplay, rateToPercent, sharesToDisplay, yuanToCents } from "~/domain/money";
import { calcPurchase } from "~/domain/purchase";

const { Text, Paragraph } = Typography;

export interface BuyDrawerProps {
  open: boolean;
  onClose: () => void;
  fundCode: string;
  fundName: string;
  /** 申购费率（万分之） */
  purchaseRate: number;
  /** 起购金额（分） */
  minPurchaseCents: number;
  /** 最新净值 ×10000，用于试算 */
  navScaled: number;
  /** 最新净值日期 */
  navDate: string | null;
  /** 可用现金（分）；未登录传 null */
  cashCents: number | null;
  /** 提交到哪个 action */
  action: string;
}

/**
 * 买入抽屉。核心价值是**实时预估**：
 * 用当前净值按内扣法算出手续费与预计份额，让用户下单前就知道费用几何。
 * 但必须明确标注「实际以确认日净值为准」——T+1 成交价现在还不知道。
 */
export function BuyDrawer(props: BuyDrawerProps) {
  const {
    open,
    onClose,
    fundCode,
    fundName,
    purchaseRate,
    minPurchaseCents,
    navScaled,
    navDate,
    cashCents,
    action,
  } = props;

  const [amountYuan, setAmountYuan] = useState("");
  const fetcher = useFetcher();
  const submitting = fetcher.state === "submitting";

  // 试算：金额合法且有净值时，按内扣法算费用与份额
  const estimate = useMemo(() => {
    const n = Number(amountYuan);
    if (!Number.isFinite(n) || n <= 0 || navScaled <= 0)
      return null;
    const amountCents = yuanToCents(amountYuan);
    if (amountCents < minPurchaseCents)
      return null;
    try {
      return calcPurchase({ amountCents, navScaled, purchaseRate });
    }
    catch {
      return null;
    }
  }, [amountYuan, navScaled, purchaseRate, minPurchaseCents]);

  const amountCents = (() => {
    const n = Number(amountYuan);
    return Number.isFinite(n) && n > 0 ? yuanToCents(amountYuan) : 0;
  })();

  const belowMin = amountCents > 0 && amountCents < minPurchaseCents;
  const notEnoughCash = cashCents !== null && amountCents > cashCents;
  const canSubmit = amountCents > 0 && !belowMin && !notEnoughCash && !submitting;

  return (
    <Drawer
      title={`买入 ${fundName}`}
      open={open}
      onClose={onClose}
      width={480}
      destroyOnHidden
    >
      <fetcher.Form method="post" action={action}>
        <input type="hidden" name="intent" value="buy" />
        <input type="hidden" name="fundCode" value={fundCode} />

        <div style={{ marginBottom: 16 }}>
          <DataRow label="基金代码" value={fundCode} />
          <DataRow
            label="最新净值"
            value={
              navScaled > 0
                ? `${navToDisplay(navScaled)}${navDate ? `（${navDate}）` : ""}`
                : "暂无"
            }
            mono
          />
          <DataRow label="申购费率" value={rateToPercent(purchaseRate)} mono />
          <DataRow label="起购金额" value={`${fmtYuan(minPurchaseCents)} 元`} mono />
          <DataRow
            label="可用现金"
            value={cashCents === null ? "请先登录" : `${fmtYuan(cashCents)} 元`}
            mono
            last
          />
        </div>

        <Form.Item label="申购金额（元）" layout="vertical" style={{ marginBottom: 12 }}>
          <Input
            name="amount"
            size="large"
            inputMode="decimal"
            // ⚠️ 这里与下方「全部」按钮必须保持 centsToYuan（不换 fmtYuan）：
            // placeholder 是给用户照着输的参考值，带千分位会诱导用户输入
            // 输入框根本不接受的格式（提交时走 Number()，逗号即 NaN）
            placeholder={`最低 ${centsToYuan(minPurchaseCents)} 元`}
            value={amountYuan}
            onChange={e => setAmountYuan(e.target.value)}
            suffix="元"
          />
        </Form.Item>

        {/* 快捷金额 */}
        <Space wrap style={{ marginBottom: 16 }}>
          {[100, 500, 1000, 5000, 10000].map(v => (
            <Button key={v} size="small" onClick={() => setAmountYuan(String(v))}>
              {v}
              {" "}
              元
            </Button>
          ))}
          {cashCents !== null && (
            <Button
              size="small"
              // ⚠️ 这个值直接进 Input，绝不能换成 fmtYuan：
              // Number("100,000.00") 是 NaN → amountCents 归 0 → canSubmit 为 false，
              // 「确认买入」按钮当场置灰点不动（真到了 action 也判「请输入正确的金额」）
              onClick={() => setAmountYuan(centsToYuan(cashCents))}
            >
              全部
            </Button>
          )}
        </Space>

        {belowMin && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`低于起购金额 ${fmtYuan(minPurchaseCents)} 元`}
          />
        )}
        {notEnoughCash && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={`现金不足，可用 ${fmtYuan(cashCents!)} 元`}
          />
        )}

        {/* 内扣法预估 */}
        {estimate && (
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message="费用预估（内扣法）"
            description={(
              <div>
                <div>
                  申购费用：
                  <Text strong>
                    {fmtYuan(estimate.feeCents)}
                    {" "}
                    元
                  </Text>
                  <Text type="secondary">（从申购金额中扣除）</Text>
                </div>
                <div>
                  净申购金额：
                  <Text strong>
                    {fmtYuan(estimate.netAmountCents)}
                    {" "}
                    元
                  </Text>
                </div>
                <div>
                  预计份额：
                  <Text strong>
                    {sharesToDisplay(estimate.sharesScaled)}
                    {" "}
                    份
                  </Text>
                </div>
                <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                  以上按最新净值试算。实际成交份额
                  <Text strong>以确认日净值为准</Text>
                  （交易日 15:00 前下单用当日净值，之后顺延至下一交易日）。
                </Paragraph>
              </div>
            )}
          />
        )}

        {fetcher.data?.error && (
          <Alert type="error" showIcon message={fetcher.data.error} style={{ marginBottom: 16 }} />
        )}

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          loading={submitting}
          disabled={!canSubmit}
        >
          确认买入
        </Button>
      </fetcher.Form>
    </Drawer>
  );
}
