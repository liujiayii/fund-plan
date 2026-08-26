import type { TransactionView } from "~/services/portfolio-service";
import { Tag } from "antd";
import { centsToYuan } from "~/domain/money";
import { COLOR, NUM_FONT, pnlColor } from "~/theme";

/** 流水类型的中文与配色。⚠️ 类型 Tag 不用红绿——红绿专属涨跌，这里是资金流向分类 */
const TX_TYPE_MAP: Record<TransactionView["type"], { color: string; text: string }> = {
  init: { color: "blue", text: "初始本金" },
  checkin: { color: "gold", text: "签到奖励" },
  buy: { color: "geekblue", text: "申购" },
  sell: { color: "cyan", text: "赎回到账" },
  fee: { color: "volcano", text: "手续费" },
};

export interface TxListProps {
  txs: TransactionView[];
}

/**
 * 资金流水列表。取代 master.tsx 里 5 列的 <Table<TransactionView>>。
 *
 * 每行：左侧类型 Tag + 备注 + 时间，右侧金额（正入账红、负出账绿）与变动后余额。
 * 这里复用 pnlColor 是合适的 —— 资金的「进」与「出」和涨跌同一套红绿语义。
 */
export function TxList({ txs }: TxListProps) {
  return (
    <div>
      {txs.map((t, i) => {
        // ⚠️ 显式标注 `| undefined` 再兜底，这个 `??` 不是多余的。
        // `type` 来自 D1 的 text 列，Drizzle 的 `text({ enum })` 只是**类型层**
        // 约束、不生成 CHECK 约束，所以库里物理上可能出现表外的值
        // （手工 d1 execute、或将来加了新类型但漏改这张表）。
        // 被取代的旧代码是 `Record<string, …>` + `?? { color: "default", text: t }`，
        // 遇到未知类型优雅降级成显示原始串；直接 `m.color` 会 TypeError
        // 把**整个公开页**炸给游客看。Record 的键仍用联合类型以保证穷尽性。
        const known: { color: string; text: string } | undefined = TX_TYPE_MAP[t.type];
        const m = known ?? { color: "default", text: t.type };
        return (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "12px 0",
              borderBottom:
                i === txs.length - 1 ? undefined : `1px solid ${COLOR.border}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>
                <Tag color={m.color}>{m.text}</Tag>
                <span style={{ fontSize: 13, color: COLOR.textPrimary }}>
                  {t.note}
                </span>
              </div>
              <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
                {new Date(t.createdAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </div>
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: 15,
                  color: pnlColor(t.amount),
                }}
              >
                {t.amount > 0 ? "+" : ""}
                {centsToYuan(t.amount)}
                {/* 「元」必须留。旧表格两列都带「元」，靠列头是撑不起单位的 */}
                <span style={{ fontSize: 12 }}> 元</span>
              </div>
              {/* 余额也走 NUM_FONT：它和上面的金额同属一个右对齐数值列，
                  少了等宽字体，行与行之间金额对齐、余额却参差 */}
              <div
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: 12,
                  color: COLOR.textSecondary,
                  marginTop: 2,
                }}
              >
                {`余额 ${centsToYuan(t.balance)} 元`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
