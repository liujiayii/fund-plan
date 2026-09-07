import type { SellPanelProps } from "~/components/SellPanel";
import { Drawer, message } from "antd";
import { SellPanel } from "~/components/SellPanel";
import { useIsMobile } from "~/hooks/useIsMobile";

export interface SellDrawerProps extends Omit<SellPanelProps, "onSuccess"> {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / 右上角 × / 提交成功后自动调） */
  onClose: () => void;
}

/**
 * 卖出抽屉：SellPanel 的弹层壳，与 BuyDrawer 同款范式
 * （桌面右侧抽屉 400px / 移动端底部弹层 88%，destroyOnHidden 重开即重置——
 * 等价于旧版页面的 tick 重挂，宿主零状态）。
 * 成功处理由本壳接管（onSuccess 不外露）：toast + 关抽屉。
 */
export function SellDrawer({ open, onClose, ...panel }: SellDrawerProps) {
  const isMobile = useIsMobile();

  return (
    <Drawer
      title={`卖出 ${panel.fundName}`}
      open={open}
      onClose={onClose}
      placement={isMobile ? "bottom" : "right"}
      width={400}
      height="88%"
      destroyOnHidden
    >
      <SellPanel
        {...panel}
        onSuccess={(msg) => {
          message.success(msg);
          onClose();
        }}
      />
    </Drawer>
  );
}
