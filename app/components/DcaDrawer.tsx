import type { DcaPlanView } from "~/services/portfolio-service";
import { DcaFundPanel } from "~/components/DcaFundPanel";
import { TradeDrawerShell } from "~/components/ui/TradeDrawerShell";

export interface DcaDrawerProps {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / 头部关闭钮） */
  onClose: () => void;
  fundCode: string;
  fundName: string;
  /** 该基金的定投计划（loader 里 getDcaPlans(db, user.id, code)） */
  plans: DcaPlanView[];
}

/**
 * 定投抽屉：DcaFundPanel 的弹层壳，外观交给 TradeDrawerShell（2026-09-14
 * 起三个交易抽屉统一 App 式自绘头部）。
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
  return (
    <TradeDrawerShell
      open={open}
      onClose={onClose}
      actionLabel="定投"
      tone="primary"
      fundName={fundName}
      fundCode={fundCode}
      zIndex={900}
    >
      <DcaFundPanel
        fundCode={fundCode}
        fundName={fundName}
        plans={plans}
      />
    </TradeDrawerShell>
  );
}
