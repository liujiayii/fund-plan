import type { DcaPlanView } from "~/services/portfolio-service";
import { Drawer } from "antd";
import { DcaFundPanel } from "~/components/DcaFundPanel";
import { useIsMobile } from "~/hooks/useIsMobile";

export interface DcaDrawerProps {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / 右上角 ×） */
  onClose: () => void;
  fundCode: string;
  fundName: string;
  /** 该基金的定投计划（loader 里 getDcaPlans(db, user.id, code)） */
  plans: DcaPlanView[];
}

/**
 * 定投抽屉：DcaFundPanel 的弹层壳，与 BuyDrawer 同款范式
 * （桌面右侧抽屉 400px / 移动端底部弹层 88%，destroyOnHidden 重开即重置）。
 *
 * 面板内部的创建/修改/暂停/删除统一提交到 /me/dca 的 action（共享组件
 * 内已写死）——持仓详情页与基金详情页共用一个真相；从这两页发起时基金
 * 必已建档（ensureFund / 持有在前），不会触发 me.dca 的「请先访问基金页」
 * 建档裂缝。
 *
 * zIndex 压到 900：面板内部会弹表单 Modal（默认 zIndex 1000），
 * 抽屉不压它，弹窗才能浮在抽屉之上。
 */
export function DcaDrawer({
  open,
  onClose,
  fundCode,
  fundName,
  plans,
}: DcaDrawerProps) {
  const isMobile = useIsMobile();

  return (
    <Drawer
      title={`定投 · ${fundName}`}
      open={open}
      onClose={onClose}
      placement={isMobile ? "bottom" : "right"}
      width={400}
      height="88%"
      zIndex={900}
      destroyOnHidden
    >
      <DcaFundPanel
        fundCode={fundCode}
        fundName={fundName}
        plans={plans}
      />
    </Drawer>
  );
}
