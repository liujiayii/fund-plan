import type { ReactNode } from "react";
import type { HoldingView } from "~/services/portfolio-service";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { centsToYuan, navToDisplay } from "~/domain/money";
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
 * 「净值 X.XXXX（日期）」的 note 渲染器。
 * 公开盘（`HoldingListReadonly`）与仪表盘速览（`me._index`）共用 ——
 * 两处都只需要露出**估值时点**，不需要份额/成本/批次那些明细。
 * ⚠️ 无 `navDate` 时返回 **`undefined`** 而非 `null`：`FundListItem` 的 `note`
 * 判空是 `!== undefined`，返回 `null` 会通过守卫并渲染出一个带 `marginTop: 4`
 * 的空 div。这个约束刻意收敛在这一个函数里 —— 让它在两个消费者之间不会走偏。
 * 另有一层正确性收益：`portfolio-service` 在拉不到净值时用**成本价兜底**填
 * `navScaled`（同时 `navDate` 为 `null`），所以「有 navDate 才显示净值」
 * 顺带避免了把成本价冒充成净值展示。
 */
export function navDateNote(h: HoldingView): ReactNode {
  return h.navDate ? `净值 ${navToDisplay(h.navScaled)}（${h.navDate}）` : undefined;
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
              <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元</span>
            </span>
          )}
          secondary={<PnlText cents={h.pnlCents} rate={h.pnlRate} size={12} />}
          actions={renderActions?.(h)}
        />
      ))}
    </div>
  );
}
