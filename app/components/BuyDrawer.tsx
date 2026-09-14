import type { BuyPanelProps } from "~/components/BuyPanel";
import { message } from "antd";
import { BuyPanel } from "~/components/BuyPanel";
import { TradeDrawerShell } from "~/components/ui/TradeDrawerShell";

export interface BuyDrawerProps extends Omit<BuyPanelProps, "onSuccess"> {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / 头部关闭钮 / 提交成功后自动调） */
  onClose: () => void;
}

/**
 * 买入抽屉：BuyPanel 的弹层壳。外观交给 TradeDrawerShell（2026-09-14
 * 起三个交易抽屉统一 App 式自绘头部，杀 antd 默认 header 的后台脸）。
 *
 * 为什么抽屉形态又回来了：期三曾删光 BuyDrawer/SellDrawer 把交易收进详情页，
 * 那次收敛解决的是「持仓页交易入口分散」；自选页行内买入是新场景——
 * 用户要「看中就买、不跳页」，弹层 + 复用 BuyPanel 是唯一不动金融逻辑的做法。
 * 决策链详见 .superpowers/specs/2026-09-01-buy-drawer-design.md。
 *
 * 成功处理由本壳接管（onSuccess 不外露）：toast + 关抽屉。
 */
export function BuyDrawer({ open, onClose, ...panel }: BuyDrawerProps) {
  return (
    <TradeDrawerShell
      open={open}
      onClose={onClose}
      actionLabel="买入"
      tone="primary"
      fundName={panel.fundName}
      fundCode={panel.fundCode}
    >
      <BuyPanel
        {...panel}
        onSuccess={(msg) => {
          message.success(msg);
          onClose();
        }}
      />
    </TradeDrawerShell>
  );
}
