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
  /** 最右侧操作区（按钮组） */
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
 * 改一处样式要改 8 个地方。所有实体列表统一消费这个骨架。
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 0",
        borderBottom: last ? undefined : `1px solid ${COLOR.border}`,
      }}
    >
      {/* 左侧：名称与标识。minWidth: 0 让长名字能被 flex 压缩而不撑破布局 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={href ?? `/funds/${fundCode}`}
          style={{ fontSize: 15, fontWeight: 500, color: COLOR.textPrimary }}
        >
          {fundName}
        </a>
        <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
          {fundCode}
          {fundType ? <Tag style={{ marginInlineStart: 8 }}>{fundType}</Tag> : null}
        </div>
        {note !== undefined && (
          <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
            {note}
          </div>
        )}
      </div>

      {/* 右侧：主副数值。whiteSpace: nowrap 防止金额被折行 */}
      {(primary !== undefined || secondary !== undefined) && (
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
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
