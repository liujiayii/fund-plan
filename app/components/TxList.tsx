import type { TransactionView } from "~/services/portfolio-service";
import { Tag } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { COLOR, NUM_FONT } from "~/theme";

/** 流水类型的中文与配色。⚠️ 本组件全程不用红绿——红绿专属涨跌，这里是资金流向分类 */
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
 * 每行：左侧类型 Tag + 备注 + 时间，右侧金额与变动后余额，金额一律正文色。
 *
 * ⚠️ 金额刻意**不用红绿**，这是相对旧表格（`v >= 0 ? 红 : 绿`）的有意偏离：
 * 红绿在本项目专属涨跌，而 /master 把「资金流水」与「持仓」「交易记录」做成同一张卡
 * 的相邻 tab —— 同一片红绿两种含义，一次点击就能看见冲突。而且申购（现金换份额）
 * 会被判成绿、读作「亏」，签到奖励会被判成红、读作「赚」，两者都不是涨跌。
 * 方向已经由 `+`/`-` 号和类型 Tag（申购 / 赎回到账 / 签到奖励）说清，颜色是冗余的。
 *
 * 同类的有意偏离还有：身份 Tag 红→蓝、状态绿→蓝、手续费 danger→常规色、预计到账 红→蓝。
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
              // 8px：319px 内容宽下 Tag+备注 与右侧金额的挤压是既有缺陷，两端同改
              gap: 8,
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
                  color: COLOR.textPrimary,
                }}
              >
                {t.amount > 0 ? "+" : ""}
                {fmtYuan(t.amount)}
                {/* 「元」必须留。旧表格两列都带「元」，靠列头是撑不起单位的。
                    灰 12px 与 HoldingList / DcaPlanList / OrderList 统一：
                    这三处在 /master 是同一张卡的相邻 tab，单位写法不齐一眼就看出来 */}
                <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元</span>
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
                {`余额 ${fmtYuan(t.balance)} 元`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
