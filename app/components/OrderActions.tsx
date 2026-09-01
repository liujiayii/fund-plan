import type { OrderView } from "~/services/portfolio-service";
import { Button, Input, message, Modal, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { centsToYuan, sharesToDisplay } from "~/domain/money";

const { Text } = Typography;

/** /me/orders action 的返回形状（面板下单同款约定） */
interface ActionData {
  ok?: boolean;
  message?: string;
  error?: string;
}

export interface OrderActionsProps {
  order: OrderView;
}

/**
 * 待确认订单的行内操作：改单 + 撤单。
 *
 * - 非 pending 订单直接不渲染（列表对全部行传本组件即可，无需调用方判断）
 * - 提交统一 post 到 /me/orders 的 action——持仓详情页的订单列表也走
 *   这条通道（订单按 id 寻址，与宿主页面无关），fetcher 提交完成后
 *   react-router 自动 revalidate，两个页面的 loader 都会拿到新数据
 * - 反馈：成功 message.success toast、失败 message.error toast，
 *   与面板下单（BuyPanel/卖出面板）的模式一致
 */
export function OrderActions({ order }: OrderActionsProps) {
  const fetcher = useFetcher();
  const submitting = fetcher.state !== "idle";
  const [amendOpen, setAmendOpen] = useState(false);
  const [value, setValue] = useState("");

  // 结果 toast。notifiedRef 按 data 对象判重，同一份结果只报一次
  // （防内联回调/重渲染导致重复弹 toast，同 BuyPanel 的套路）
  const notifiedRef = useRef<ActionData | null>(null);
  useEffect(() => {
    const d = fetcher.data as ActionData | undefined;
    if (!d || d === notifiedRef.current)
      return;
    notifiedRef.current = d;
    if (d.ok) {
      message.success(d.message ?? "操作成功");
      // 异步提交完成后的副作用（关掉改单弹窗），effect 正是该用的工具
      // ——me.dca 关创建弹窗同款豁免理由：改成派生状态反而出 bug
      // eslint-disable-next-line react/set-state-in-effect
      setAmendOpen(false);
    }
    else if (d.error) {
      message.error(d.error);
    }
  }, [fetcher.data]);

  if (order.status !== "pending")
    return null;

  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post", action: "/me/orders" });

  /** 撤单：两步确认，文案按单侧说明资金/份额的去向 */
  const confirmCancel = () => {
    Modal.confirm({
      title: "撤销这笔订单？",
      content: order.side === "buy"
        ? "撤单后冻结的资金立即退回现金。"
        : "撤单后占用的份额立即释放。",
      okText: "撤单",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => submit({ intent: "cancel", orderId: String(order.id) }),
    });
  };

  /** 改单弹窗：买单改金额（元）、赎回单改份额，预填当前委托值 */
  const openAmend = () => {
    setValue(
      order.side === "buy"
        ? centsToYuan(order.amount ?? 0)
        : sharesToDisplay(order.shares ?? 0, 4),
    );
    setAmendOpen(true);
  };

  const isBuy = order.side === "buy";
  const currentLabel = isBuy
    ? `当前委托 ${centsToYuan(order.amount ?? 0)} 元`
    : `当前委托 ${sharesToDisplay(order.shares ?? 0, 4)} 份`;

  const submitAmend = () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      message.warning(isBuy ? "请输入正确的金额" : "请输入正确的份额");
      return;
    }
    submit(
      isBuy
        ? { intent: "amend", orderId: String(order.id), amount: value }
        : { intent: "amend", orderId: String(order.id), shares: value },
    );
  };

  return (
    <>
      {/* 放 note 行内而非 FundListItem 的 actions 槽：右侧主值按
          「容器宽 − actions 宽」对齐，只给 pending 行挂按钮会把
          待确认行与已成交行的数字列错开一截（FundListItem 注释有警告） */}
      <Space size={0}>
        <Button type="link" size="small" style={{ paddingInline: 4 }} disabled={submitting} onClick={openAmend}>
          改单
        </Button>
        <Button type="link" size="small" danger style={{ paddingInline: 4 }} disabled={submitting} onClick={confirmCancel}>
          撤单
        </Button>
      </Space>

      <Modal
        title={isBuy ? "修改申购金额" : "修改赎回份额"}
        open={amendOpen}
        onCancel={() => setAmendOpen(false)}
        onOk={submitAmend}
        okText="确认修改"
        cancelText="取消"
        okButtonProps={{ loading: submitting }}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">
            {currentLabel}
            ，输入新的委托值：
          </Text>
          <Input
            value={value}
            onChange={e => setValue(e.target.value)}
            onPressEnter={submitAmend}
            inputMode="decimal"
            suffix={isBuy ? "元" : "份"}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            改单不改变下单与确认时间；新金额同样需满足起购金额与现金约束。
          </Text>
        </Space>
      </Modal>
    </>
  );
}
