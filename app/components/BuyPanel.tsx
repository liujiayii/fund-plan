import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import { centsToYuan, navToDisplay, rateToPercent, sharesToDisplay, yuanToCents } from "~/domain/money";
import { calcPurchase } from "~/domain/purchase";

const { Text, Paragraph } = Typography;

export interface BuyPanelProps {
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
  /**
   * 提交成功回调（拿到 action 返回的 message）。
   * BuyDrawer 靠它自动关抽屉；me.holdings 靠它重挂面板清空输入。
   * 不传则仅面板内部表现（提交按钮复位）。
   */
  onSuccess?: (message: string) => void;
}

/**
 * 买入面板。核心价值是**实时预估**：
 * 用当前净值按内扣法算出手续费与预计份额，让用户下单前就知道费用几何。
 * 但必须明确标注「实际以确认日净值为准」——T+1 成交价现在还不知道。
 */
export function BuyPanel(props: BuyPanelProps) {
  const {
    fundCode,
    purchaseRate,
    minPurchaseCents,
    navScaled,
    navDate,
    cashCents,
    action,
    onSuccess,
  } = props;

  const [amountYuan, setAmountYuan] = useState("");
  const fetcher = useFetcher();
  const submitting = fetcher.state === "submitting";

  // 提交成功后通知宿主。⚠️ 成功信号只能从本组件的 fetcher 出：
  // 提交走的是这里的 fetcher.Form，宿主页面自建的 fetcher 拿不到结果
  // （me.holdings 曾因此踩过「成功无提示、输入不清空」的静默 bug）。
  // notifiedRef 按 data 对象判重：同一份结果只回调一次——onSuccess 多为
  // 内联箭头函数（每次渲染新引用），只靠 deps 判变化会重复触发 toast。
  const notifiedRef = useRef<{ ok?: boolean; message?: string } | null>(null);
  useEffect(() => {
    const d = fetcher.data as { ok?: boolean; message?: string } | undefined;
    if (d?.ok && d !== notifiedRef.current) {
      notifiedRef.current = d;
      onSuccess?.(d.message ?? "下单成功");
    }
  }, [fetcher.data, onSuccess]);

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
    <fetcher.Form method="post" action={action}>
      <input type="hidden" name="intent" value="buy" />
      <input type="hidden" name="fundCode" value={fundCode} />

      {/* 基础信息井格（bg-well）：五行裸排收进卡片，权重不再平铺 */}
      <div className="mb-4 rounded-xl bg-well px-4">
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
        {/*
          这里的「10000 元」刻意不加千分位，尽管上方「可用现金」那行已经是
          「100,000.00 元」。两个理由：
          1. fmtYuan 不是即插即用 —— 它强制两位小数，按钮会变成「10,000.00 元」，
             对一个巴掌大的快捷按钮反而更难读；
          2. String(v) 的产物同时也是 setAmountYuan 的入参，会进 Input 再走
             Number()，格式必须保持机器可读（同下方「全部」按钮那条注释）。
          要统一得再写一个「整数元」格式化器，为一处调用点新增第三个格式化函数
          不划算。所以这是个决定，不是漏改。
        */}
        {[100, 500, 1000, 5000, 10000].map(v => (
          <Button key={v} size="small" className="rounded-full px-4" onClick={() => setAmountYuan(String(v))}>
            {v}
            {" "}
            元
          </Button>
        ))}
        {cashCents !== null && (
          <Button
            size="small"
            className="rounded-full px-4"
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

      {/* 内扣法预估结论卡：预计份额是买入的核心输出（花多少得多少份），
          做主视觉；费用与净申购是推导过程，收小字。2026-09-14 从 info Alert
          降维重排——Alert 的语义是提示，试算结果是内容，井格才是它的家 */}
      {estimate && (
        <div className="mb-4 rounded-xl bg-well p-4">
          <div className="text-xs text-muted">费用预估（内扣法）</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-num text-primary">
              {sharesToDisplay(estimate.sharesScaled)}
            </span>
            <span className="text-sm text-muted">份</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              申购费
              <span className="font-num text-ink">
                {" "}
                {fmtYuan(estimate.feeCents)}
                {" "}
                元
              </span>
              （从申购金额中扣）
            </span>
            <span>
              净申购
              <span className="font-num text-ink">
                {" "}
                {fmtYuan(estimate.netAmountCents)}
                {" "}
                元
              </span>
            </span>
          </div>
          <Paragraph type="secondary" className="mt-2 mb-0 text-xs">
            按最新净值试算，实际成交份额
            <Text strong>以确认日净值为准</Text>
            （交易日 15:00 前下单用当日净值，之后顺延至下一交易日）。
          </Paragraph>
        </div>
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
  );
}
