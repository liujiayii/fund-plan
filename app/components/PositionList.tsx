import { Progress } from "antd";
import { rateToPercent } from "~/domain/money";
import { COLOR } from "~/theme";

export interface PositionItem {
  /** 名称（股票/债券/行业名） */
  name: string;
  /** 名称后的小字（如「600519 · 白酒 · 增持」）；行业视图不传 */
  sub?: string;
  /** 占净值比（万分之，645 = 6.45%） */
  ratio: number;
}

/**
 * 持仓占比条列表（重仓股/债券/行业三视图统一，ux-polish spec §4⑥）。
 * 取代旧双渲染（fp-desktop Table + fp-mobile DataRow）——占比条天然响应式，
 * 是这轮「去表格化」里唯一同时消灭两套渲染的改法。
 */
export function PositionList({ items }: { items: PositionItem[] }) {
  return (
    <div>
      {items.map((p, i) => (
        <div key={p.name} style={{ marginBottom: i === items.length - 1 ? 0 : 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 13, minWidth: 0 }}>
              {p.name}
              {p.sub && (
                <span style={{ fontSize: 12, color: COLOR.textSecondary, marginLeft: 8 }}>
                  {p.sub}
                </span>
              )}
            </span>
            {/* 占比大数字：等宽字体右对齐，与行业视图旧实现同款 */}
            <span className="font-num" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
              {rateToPercent(p.ratio)}
            </span>
          </div>
          {/* ratio 是万分之（645 = 6.45%），Progress 吃百分数；strokeColor 默认主色蓝 */}
          <Progress percent={p.ratio / 100} showInfo={false} size="small" />
        </div>
      ))}
    </div>
  );
}
