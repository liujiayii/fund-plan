import type { SellPanelProps } from "~/components/SellPanel";
import { message } from "antd";
import { SellPanel } from "~/components/SellPanel";
import { TradeDrawerShell } from "~/components/ui/TradeDrawerShell";

export interface SellDrawerProps extends Omit<SellPanelProps, "onSuccess"> {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / 头部关闭钮 / 提交成功后自动调） */
  onClose: () => void;
}

/**
 * 卖出抽屉：SellPanel 的弹层壳，外观交给 TradeDrawerShell（2026-09-14
 * 起三个交易抽屉统一 App 式自绘头部）。pill 走 danger 红——卖出/赎回的
 * 动作语义，与面板里「确认赎回」按钮（type="primary" danger）同源。
 * 成功处理由本壳接管（onSuccess 不外露）：toast + 关抽屉。
 */
export function SellDrawer({ open, onClose, ...panel }: SellDrawerProps) {
  return (
    <TradeDrawerShell
      open={open}
      onClose={onClose}
      actionLabel="卖出"
      tone="danger"
      fundName={panel.fundName}
      fundCode={panel.fundCode}
    >
      <SellPanel
        {...panel}
        onSuccess={(msg) => {
          message.success(msg);
          onClose();
        }}
      />
    </TradeDrawerShell>
  );
}
