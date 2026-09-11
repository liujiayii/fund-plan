import type { ReactNode } from "react";
import type { HoldingView } from "~/services/portfolio-service";
import { fmtYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { navToDisplay, sharesToDisplay } from "~/domain/money";
import { COLOR } from "~/theme";

export interface HoldingListProps {
  holdings: HoldingView[];
  /**
   * 名称下方的补充说明。**必填**。
   * 只读页（`HoldingListReadonly`：公开盘）传 `sharesAndNavNote`
   * —— 份额 + 估值时点；/me 与 /admin/users/:id 持仓模块传份额 + 估值时点 + 成本
   * （`sharesAndNavNote` 外再拼一层成本，批次/待赎回留在单只持仓详情页）。
   * ⚠️ 刻意做成必填而非可选：「只读页也得给份额和净值」这条规则此前只写在注释里，
   * 结果被漏掉过两轮（期四引入、期八延续，「持有份额」「净值」各丢过一次）——
   * 旧表格的五列里两者都在，只读不等于可以少给字段。必填把注释约束换成编译错误。
   */
  renderNote: (h: HoldingView) => ReactNode;
  /** 每行最右的操作按钮。只读页不传 */
  renderActions?: (h: HoldingView) => ReactNode;
  /**
   * 行内名称链接的目标地址。不传则 `FundListItem` 用默认 `/funds/{code}`。
   *
   * 这是期一在 `FundListItem` 上预留的 `href` 口子的兑现：
   * `/me` 持仓列表行的语义是「点进单只持仓详情」，应链到 `/me/holdings/{code}`
   * 而非基金详情页 `/funds/{code}`；不传本 prop 的是公开盘（HoldingListReadonly）
   * 与 admin 只读后台——继续走默认基金详情页链接。
   */
  getHref?: (h: HoldingView) => string;
}

/**
 * 只读持仓行的 note：「X 份 · 净值 Y（日期）」。
 * 只读页（`HoldingListReadonly`）直接用它；/me 持仓模块以它为底、后面再拼
 * 「成本」—— 份额与估值时点的语义两处一致，成本只在持仓模块多给一层。
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
  getHref,
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
          // 不传 getHref 时落到 FundListItem 默认 /funds/{code}，只读页不受影响
          href={getHref ? getHref(h) : undefined}
          last={i === holdings.length - 1}
          primary={(
            <span
              className="font-num"
              style={{
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
