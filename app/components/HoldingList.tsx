import type { ReactNode } from "react";
import type { HoldingView } from "~/services/portfolio-service";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { centsToYuan } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

export interface HoldingListProps {
  holdings: HoldingView[];
  /**
   * 名称下方的补充说明。
   * 只读页不传（保持简洁）；持仓管理页传份额/净值/成本。
   */
  renderNote?: (h: HoldingView) => ReactNode;
  /** 每行最右的操作按钮。只读页不传 */
  renderActions?: (h: HoldingView) => ReactNode;
}

/**
 * 持仓列表。收敛此前 4 处各写一遍 columns 的 <Table<HoldingView>>。
 *
 * 支付宝式信息层级：右侧主值是**市值**（用户最关心「我这只值多少钱」），
 * 副值是盈亏金额 + 盈亏率。份额/净值/成本属于二级信息，
 * 由调用方通过 renderNote 决定要不要露出。
 */
export function HoldingList({
  holdings,
  renderNote,
  renderActions,
}: HoldingListProps) {
  return (
    <div>
      {holdings.map((h, i) => (
        <FundListItem
          key={h.fundCode}
          fundCode={h.fundCode}
          fundName={h.fundName}
          fundType={h.fundType || undefined}
          note={renderNote?.(h)}
          last={i === holdings.length - 1}
          primary={(
            <span
              style={{
                fontFamily: NUM_FONT,
                fontSize: 16,
                color: COLOR.textPrimary,
              }}
            >
              {centsToYuan(h.marketValueCents)}
            </span>
          )}
          secondary={<PnlText cents={h.pnlCents} rate={h.pnlRate} size={12} />}
          actions={renderActions?.(h)}
        />
      ))}
    </div>
  );
}
