import type { RedeemTier, ShareLotInput } from "~/domain/redeem";
import {
  Alert,
  Button,
  Form,
  Input,
  Space,
  Table,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { DataRow } from "~/components/ui/DataRow";
import { fmtYuan } from "~/components/ui/format";
import {
  navToDisplay,
  rateToPercent,
  SHARE_SCALE,
  sharesToDisplay,
} from "~/domain/money";
import { calcRedeem } from "~/domain/redeem";
import { COLOR, pnlColor } from "~/theme";

const { Text, Paragraph } = Typography;

export interface SellPanelProps {
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
  /**
   * 提交成功回调（拿到 action 返回的 message）。与 BuyPanel 同款：
   * 提交走本组件内部的 fetcher，宿主页面拿不到结果，成功只能从这里通知出去。
   */
  onSuccess?: (message: string) => void;
}

/**
 * 赎回面板。亮点是**按 FIFO 逐批试算赎回费**并展示明细——
 * 让用户看清「哪批持有多久、按几档费率、扣多少钱」，
 * 这是模拟盘能教会人东西的地方。
 */
export function SellPanel(props: SellPanelProps) {
  const {
    fundCode,
    availableSharesScaled,
    navScaled,
    navDate,
    lots,
    tiers,
    confirmDate,
    action,
    onSuccess,
  } = props;

  const [sharesInput, setSharesInput] = useState("");
  const fetcher = useFetcher();
  const submitting = fetcher.state === "submitting";

  // 提交成功后通知宿主，判重逻辑与 BuyPanel 相同（notifiedRef 按 data 对象
  // 判重，同一份结果只回调一次，防内联回调引用变化导致重复触发）
  const notifiedRef = useRef<{ ok?: boolean; message?: string } | null>(null);
  useEffect(() => {
    const d = fetcher.data as { ok?: boolean; message?: string } | undefined;
    if (d?.ok && d !== notifiedRef.current) {
      notifiedRef.current = d;
      onSuccess?.(d.message ?? "下单成功");
    }
  }, [fetcher.data, onSuccess]);

  const sharesScaled = useMemo(() => {
    const n = Number(sharesInput);
    if (!Number.isFinite(n) || n <= 0)
      return 0;
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
    }
    catch {
      return null;
    }
  }, [sharesScaled, overLimit, navScaled, lots, confirmDate, tiers]);

  const canSubmit = sharesScaled > 0 && !overLimit && !submitting;

  return (
    <fetcher.Form method="post" action={action}>
      <input type="hidden" name="intent" value="sell" />
      <input type="hidden" name="fundCode" value={fundCode} />

      <div style={{ marginBottom: 16 }}>
        <DataRow label="基金代码" value={fundCode} />
        <DataRow
          label="最新净值"
          value={`${navToDisplay(navScaled)}${navDate ? `（${navDate}）` : ""}`}
          mono
        />
        <DataRow
          label="可赎份额"
          value={`${sharesToDisplay(availableSharesScaled)} 份`}
          mono
        />
        <DataRow label="预计确认日" value={confirmDate} last />
      </div>

      <Form.Item label="赎回份额" layout="vertical" style={{ marginBottom: 12 }}>
        <Input
          name="shares"
          size="large"
          inputMode="decimal"
          placeholder={`最多 ${sharesToDisplay(availableSharesScaled)} 份`}
          value={sharesInput}
          onChange={e => setSharesInput(e.target.value)}
          suffix="份"
        />
      </Form.Item>

      {availableSharesScaled > 0 && (
        <Space wrap style={{ marginBottom: 16 }}>
          {/* 快捷份额按钮。取代 Slider：279px 宽上 100 档 = 2.8px/档，
              手指无法定位（spec §9）；BuyPanel 的快捷金额就是这个形态 */}
          {[0.25, 0.5, 0.75, 1].map(r => (
            <Button
              key={r}
              size="small"
              onClick={() =>
                setSharesInput((availableSharesScaled * r / SHARE_SCALE).toFixed(4))}
            >
              {r === 1 ? "全部" : `${r * 100}%`}
            </Button>
          ))}
        </Space>
      )}

      {overLimit && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`超过可赎份额 ${sharesToDisplay(availableSharesScaled)} 份`}
        />
      )}

      {/* FIFO 逐批费用明细。⚠️ 曾经整块塞在 Alert 的 description 里 ——
          Alert 自带 padding 20/24 + showIcon，任何宽度下都在挤压这张表，
          这是既有缺陷，两端一起修（spec §1.3 唯一豁免的桌面变更） */}
      {estimate && (
        <div style={{ marginBottom: 16 }}>
          <Text strong>赎回费用预估（先进先出，逐批计费）</Text>

          {/* 桌面视图：原 4 列 Table 原样保留。
              表与汇总间的 12px 底距从 Table 挪到本 wrapper（margin 折叠，
              观感不变）；窄屏整个 wrapper 被 display:none 掉，这份间距
              不会泄漏进卡片视图 */}
          <div className="fp-desktop" style={{ marginBottom: 12 }}>
            <Table
              size="small"
              pagination={false}
              style={{ marginBottom: 0 }}
              rowKey="lotId"
              dataSource={estimate.lotResults}
              columns={[
                {
                  title: "批次份额",
                  dataIndex: "consumedSharesScaled",
                  align: "right",
                  render: (v: number) => sharesToDisplay(v),
                },
                {
                  title: "持有天数",
                  dataIndex: "holdDays",
                  align: "right",
                  render: (v: number) => `${v} 天`,
                },
                {
                  title: "费率",
                  dataIndex: "rate",
                  align: "right",
                  render: (v: number) => rateToPercent(v),
                },
                {
                  title: "赎回费",
                  dataIndex: "feeCents",
                  align: "right",
                  render: (v: number) => `${fmtYuan(v)} 元`,
                },
              ]}
            />
          </div>

          {/* 窄屏视图：同一数据源降级成 DataRow 行，字段不缺（spec §11） */}
          <div className="fp-mobile">
            {estimate.lotResults.map((lot, i) => (
              <div key={lot.lotId} style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>
                  第
                  {" "}
                  {i + 1}
                  {" "}
                  批
                </Text>
                <DataRow label="批次份额" value={`${sharesToDisplay(lot.consumedSharesScaled)} 份`} mono />
                <DataRow label="持有天数" value={`${lot.holdDays} 天`} mono />
                <DataRow label="费率" value={rateToPercent(lot.rate)} mono />
                <DataRow label="赎回费" value={`${fmtYuan(lot.feeCents)} 元`} mono last />
              </div>
            ))}
          </div>

          <div>
            赎回总额：
            <Text strong>
              {fmtYuan(estimate.totalGrossCents)}
              {" "}
              元
            </Text>
          </div>
          <div>
            赎回费合计：
            {/*
              刻意不标红：手续费是成本，既不是盈亏也不是收益，就是个金额。
              在「红=涨」的系统里给它上红色，会被读成收益；而 antd 的
              type="danger"（#ff4d4f）与两行下面 pnlColor 的涨红（#F5222D）
              肉眼分不出来，同一小块里出现两种红只有一个是盈亏，更糟。
              这块的读法：赎回总额、赎回费合计是推导过程（朴素），
              预计到账（蓝）与已实现盈亏（红绿）才是结论。
              费率高的警示由下方 Paragraph 的文案承载，不需要颜色再喊一遍。
            */}
            <Text strong>
              {fmtYuan(estimate.totalFeeCents)}
              {" "}
              元
            </Text>
          </div>
          <div>
            预计到账：
            <Text strong style={{ color: COLOR.primary }}>
              {fmtYuan(estimate.totalNetCents)}
              {" "}
              元
            </Text>
          </div>
          <div>
            已实现盈亏：
            <Text
              strong
              style={{ color: pnlColor(estimate.realizedPnlCents) }}
            >
              {estimate.realizedPnlCents > 0 ? "+" : ""}
              {fmtYuan(estimate.realizedPnlCents)}
              {" "}
              元
            </Text>
          </div>
          <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            按最新净值试算，实际
            <Text strong>以确认日净值为准</Text>
            。
            持有不满 7 天的批次赎回费高达 1.5%，可考虑再等等。
          </Paragraph>
        </div>
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
  );
}
