import type { BuyPanelProps } from "~/components/BuyPanel";
import { Drawer, message } from "antd";
import { BuyPanel } from "~/components/BuyPanel";
import { useIsMobile } from "~/hooks/useIsMobile";

export interface BuyDrawerProps extends Omit<BuyPanelProps, "onSuccess"> {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / 右上角 × / 提交成功后自动调） */
  onClose: () => void;
}

/**
 * 买入抽屉：BuyPanel 的弹层壳，桌面右侧抽屉、移动端底部弹层（支付宝式）。
 *
 * 为什么抽屉形态又回来了：期三曾删光 BuyDrawer/SellDrawer 把交易收进详情页，
 * 那次收敛解决的是「持仓页交易入口分散」；自选页行内买入是新场景——
 * 用户要「看中就买、不跳页」，弹层 + 复用 BuyPanel 是唯一不动金融逻辑的做法。
 * 决策链详见 docs/superpowers/specs/2026-09-01-buy-drawer-design.md。
 *
 * 成功处理由本壳接管（onSuccess 不外露）：toast + 关抽屉。
 */
export function BuyDrawer({ open, onClose, ...panel }: BuyDrawerProps) {
  const isMobile = useIsMobile();

  return (
    <Drawer
      title={`买入 ${panel.fundName}`}
      open={open}
      onClose={onClose}
      // 桌面右侧抽屉 400px（面板内容主体宽度）；移动端底部弹层 88%
      // （面板整高约 600px，留出顶部透气，超高内容抽屉体内自滚动）
      placement={isMobile ? "bottom" : "right"}
      width={400}
      height="88%"
      // 关闭即销毁内容：每次打开都是全新的 BuyPanel，输入框与 fetcher
      // 状态一并重置——等价于 me.holdings 的 tick 重挂，但宿主零状态
      destroyOnHidden
    >
      <BuyPanel
        {...panel}
        onSuccess={(msg) => {
          message.success(msg);
          onClose();
        }}
      />
    </Drawer>
  );
}
