import type { ReactNode } from "react";
import { Tag } from "antd";
import { COLOR } from "~/theme";

export interface FundListItemProps {
  fundCode: string;
  fundName: string;
  /** 基金类型，如「混合型」；空串按不传处理 */
  fundType?: string;
  /** 名称下方的补充说明（如「3 批 · 1200.00 份待赎回」「2026-08-24 下单」） */
  note?: ReactNode;
  /** 右侧主值（如市值、委托金额） */
  primary?: ReactNode;
  /** 右侧副值（如盈亏、成交明细） */
  secondary?: ReactNode;
  /**
   * 最右侧操作区（按钮组）。
   *
   * ⚠️ 同一列表内各行的 actions 宽度应保持一致 —— 右侧数值是相对于
   * 「容器右边 − actions 宽 − gap」右对齐的，若某些行的按钮少一个，
   * 那些行的数字列会与其他行对不齐。
   */
  actions?: ReactNode;
  /**
   * 名称链接目标，默认 /funds/{fundCode}。
   * 期一没有调用方传它——留着是给期三用：`/me/holdings` 的行要链到
   * 单只持仓详情页 `/me/holdings/{code}` 而不是基金详情页。
   */
  href?: string;
  /** 列表最后一行传 true，不画分割线 */
  last?: boolean;
}

/**
 * 基金行骨架：左侧名称 + 代码 + 类型 + 备注，右侧主副双值，最右操作区。
 *
 * 存在的理由：重构前「基金」这一列的 render 在 8 个文件里各写了一遍
 * （`<a href={/funds/{code}}>{name}<br/><Text type="secondary">{code}</Text></a>`），
 * 改一处样式要改 8 个地方。持仓 / 订单 / 定投三个列表统一消费这个骨架。
 *
 * ⚠️ 资金流水（`TxList`）**不用**它 —— 流水的行没有基金主体：
 * `transactions` 表无 fund 字段，`checkin` / `init` 行天然与基金无关。
 * 所以 `fundCode` / `fundName` 在这里是必填的。
 */
export function FundListItem(props: FundListItemProps) {
  const {
    fundCode,
    fundName,
    fundType,
    note,
    primary,
    secondary,
    actions,
    href,
    last,
  } = props;

  return (
    <div
      className="fp-fli"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 0",
        borderBottom: last ? undefined : `1px solid ${COLOR.border}`,
      }}
    >
      {/* 左侧：名称与标识。minWidth: 0 让长名字能被 flex 压缩而不撑破布局。
          fp-fli-main 是窄屏两段式的锚点（responsive.css §5，spec §8） */}
      <div className="fp-fli-main" style={{ flex: 1, minWidth: 0 }}>
        {/*
          ⚠️ <a> 必须同时包住名称与代码两行。
          旧表格的写法是 <a>{name}<br/><Text>{code}</Text></a> —— 两行都可点。
          若只把 fundName 放进 <a>，点代码就不跳转了，是可验证的功能退化。
          display: block 让链接铺满左列宽度，整块可点 —— 这也更接近支付宝
          基金列表「整行可点」的观感。
          note 刻意留在 <a> 外面：它装的是状态 Tag 与流水说明，不该整段变成链接。
        */}
        <a
          href={href ?? `/funds/${fundCode}`}
          style={{ display: "block", color: COLOR.textPrimary }}
        >
          <div style={{ fontSize: 15, fontWeight: 500 }}>{fundName}</div>
          <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
            {fundCode}
            {fundType ? <Tag style={{ marginInlineStart: 8 }}>{fundType}</Tag> : null}
          </div>
        </a>
        {note !== undefined && (
          <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
            {note}
          </div>
        )}
      </div>

      {/* 右侧：主副数值。刻意不写 inline nowrap —— 它正是 OrderList 长副值
          （min-content 约 380px）在窄屏顶穿整页的根因（spec §8）。
          桌面 768px+ 由 responsive.css 的 .fp-fli-side 补回 nowrap
          （金额断行难看）；窄屏允许收缩折行 */}
      {(primary !== undefined || secondary !== undefined) && (
        <div className="fp-fli-side" style={{ textAlign: "right" }}>
          {primary !== undefined && <div>{primary}</div>}
          {secondary !== undefined && <div style={{ marginTop: 2 }}>{secondary}</div>}
        </div>
      )}

      {actions !== undefined && (
        <div style={{ whiteSpace: "nowrap" }}>{actions}</div>
      )}
    </div>
  );
}
