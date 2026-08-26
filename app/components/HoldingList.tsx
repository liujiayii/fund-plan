import type { ReactNode } from "react";
import type { HoldingView } from "~/services/portfolio-service";
import { fmtYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { navToDisplay, sharesToDisplay } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

export interface HoldingListProps {
  holdings: HoldingView[];
  /**
   * 名称下方的补充说明。**必填**。
   * 只读页（公开盘、仪表盘速览）传 `sharesAndNavNote` —— 份额 + 估值时点；
   * 持仓管理页传份额/成本/净值/批次/待赎回。
   * ⚠️ 刻意做成必填而非可选：「只读页也得给份额和净值」这条规则此前只写在注释里，
   * 结果被漏掉过两轮（期四引入、期八延续，「持有份额」「净值」各丢过一次）——
   * 旧表格的五列里两者都在，只读不等于可以少给字段。必填把注释约束换成编译错误。
   */
  renderNote: (h: HoldingView) => ReactNode;
  /** 每行最右的操作按钮。只读页不传 */
  renderActions?: (h: HoldingView) => ReactNode;
}

/**
 * 只读持仓行的 note：「X 份 · 净值 Y（日期）」。
 * 公开盘（`HoldingListReadonly`）与仪表盘速览（`me._index`）共用 ——
 * 两处的旧表格列完全一致，所以 note 也该一致。
 *
 * ⚠️ 「份」必须显式写。旧表格的 `持有份额` 列渲染的是裸 `sharesToDisplay(v)`，
 * 单位由**列头**承载；卡片里没有列头，去掉后缀就是丢单位。
 *
 * ⚠️ 无 `navDate` 时**只返回份额、不渲染净值**，这是刻意偏离旧表格的一处：
 * 旧列无条件渲染 `navToDisplay(navScaled)`，而 `portfolio-service` 在拉不到
 * 净值时用**成本价兜底**填 `navScaled`（同时 `navDate` 置 null）——
 * 旧列等于把成本价当净值给用户看，那是错的，不继承。
 * 份额恒存在，所以 note 恒非空，藏掉净值不会留下空白。
 */
export function sharesAndNavNote(h: HoldingView): ReactNode {
  const shares = `${sharesToDisplay(h.sharesScaled)} 份`;
  return h.navDate
    ? `${shares} · 净值 ${navToDisplay(h.navScaled)}（${h.navDate}）`
    : shares;
}

/**
 * 持仓列表。收敛此前 4 处各写一遍 columns 的 <Table<HoldingView>>。
 *
 * 支付宝式信息层级：右侧主值是**市值**（用户最关心「我这只值多少钱」），
 * 副值是盈亏金额 + 盈亏率。份额/净值/成本属于二级信息，
 * 放在名称下方的 note 里，由调用方通过 renderNote 决定给到多细（但必须给）。
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
          note={renderNote(h)}
          last={i === holdings.length - 1}
          primary={(
            <span
              style={{
                fontFamily: NUM_FONT,
                fontSize: 16,
                color: COLOR.textPrimary,
              }}
            >
              {fmtYuan(h.marketValueCents)}
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
