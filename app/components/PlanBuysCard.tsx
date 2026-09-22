import type { TableProps } from "antd";
import { Alert, Button, Input, Table } from "antd";
import { useState } from "react";
import { Form as RouterForm, useNavigation } from "react-router";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { bpsToInputText } from "~/domain/undervalued-plan";

/** 表格里的一行：主理人的实盘明细 + 按你自己的资金换算出来的金额 */
export interface PlanRow {
  fundCode: string;
  fundName: string;
  /** 第一行的大字：从全称自动缩出来的简称（如「标普500」） */
  shortName: string;
  fundType: string;
  /** 主理人本期买入金额（分） */
  masterCents: number;
  /** 按你的资金 × 比例换算出的本期金额（分） */
  mineCents: number;
  /** 该基金起购金额（分） */
  minPurchaseCents: number;
}

export interface PlanBuysCardProps {
  /** 本期日期（周二 YYYY-MM-DD）；主理人一期都没发过车时为 null */
  period: string | null;
  /** 主理人这周二还没买入（页面停在上一期）时传 true */
  stale: boolean;
  rows: PlanRow[];
  /** 主理人本期买入总额（分） */
  masterTotalCents: number;
  /** 换算后的本期总额（分），= 资金 × 比例 */
  targetCents: number;
  /** 「换算后低于起购金额」的品种数，> 0 才提示 */
  belowMinCount: number;
  notices: string[];
  /** 本轮参数（表单的初始值）：只有跟投比例——换算的基准是主理人的买入合计 */
  initial: { ratioBps: number };
}

/**
 * 「本期实盘定投品种」卡：明细表 + 一键换算本期金额。
 *
 * 明细完全来自主理人的真实买单（`services/undervalued-plan`），页面不维护品种名单。
 * 卡里有两件事要区分清楚，文案上刻意分开写：
 *   - 「买入金额」= 主理人真金白银投了多少（**参考**，别人的钱）
 *   - 「你的金额」= 按跟投比例（他的几成）换算出来的（**你的**方案）
 * 两者混着说会让人以为主理人在推荐具体金额。
 *
 * ⚠️ 表单状态放在这一层，由页面用本轮参数当 key 渲染它——参数一变整卡重挂载，
 * 受控输入与提交用的 name 字段都从 loaderData 重新初始化。状态若留在页面组件里，
 * key 换的是卡不是状态：服务端回落了参数（或浏览器 back/forward 换了参数）时，
 * 输入框会停在上一轮的值上，页面显示 50%、算的却是 10%
 * （`/tools/dca-backtest` 的 ParamsCard 踩过同一个坑，CodeRabbit 评审 #4）。
 */
export function PlanBuysCard({
  period,
  stale,
  rows,
  masterTotalCents,
  targetCents,
  belowMinCount,
  notices,
  initial,
}: PlanBuysCardProps) {
  const nav = useNavigation();
  const computing = nav.state === "loading";

  // 受控输入：与换算用的口径是同一份文本，不会出现「框里显示 50%、算的是 10%」
  const [ratioText, setRatioText] = useState(() => bpsToInputText(initial.ratioBps));

  const columns: TableProps<PlanRow>["columns"] = [
    {
      title: `基金明细（${rows.length}）`,
      dataIndex: "fundName",
      render: (_: unknown, r: PlanRow) => (
        <div>
          <div className="text-[14px] leading-snug font-medium text-ink">{r.shortName}</div>
          <div className="text-[11px] leading-snug text-tertiary">
            {/* 简称剥不出东西时它等于全称，别把同一串字显示两遍 */}
            {r.shortName === r.fundName ? r.fundCode : `${r.fundName} · ${r.fundCode}`}
          </div>
        </div>
      ),
    },
    {
      title: "买入金额",
      dataIndex: "masterCents",
      align: "right",
      // 列宽容下「1,002.00元」这种最长的一档（9 个字符），两列共 200px——
      // 390 宽的手机上剩下的 158px 刚好还放得下「沪港深红利成长低波」这类九字简称。
      // 第一版给 112+128 且表头是六个字，名字被挤到只剩 90px、折成三四行
      // （2026-09-22 Playwright 截图走查）
      width: 100,
      render: (v: number) => (
        <span className="font-num">
          {fmtYuan(v)}
          元
        </span>
      ),
    },
    {
      title: "你的金额",
      dataIndex: "mineCents",
      align: "right",
      width: 100,
      render: (v: number, r: PlanRow) => (
        // 低于起购的金额用暖色标出来：小额资金下这是最容易踩的坑
        // （换算出的钱不够起购，实际下单会被拒），颜色比文字更早被眼睛抓到
        <span
          className={`font-num ${
            r.minPurchaseCents > 0 && v < r.minPurchaseCents ? "text-pending" : "text-primary"
          }`}
        >
          {fmtYuan(v)}
          元
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="本期实盘定投品种"
      extra={<span className="font-num text-[13px] text-muted">{period ?? "—"}</span>}
      className="animate-fade-up"
    >
      {stale && period
        ? (
            <Alert
              type="info"
              showIcon
              className="mb-3"
              message={`主理人本周二还没买入，以下停留在 ${period} 这一期`}
            />
          )
        : null}

      {rows.length === 0
        ? (
            <EmptyState
              description="主理人还没有发过车"
              hint="这一页每周二跟随主理人的实盘买入更新；等他这周二买了，品种与金额会自动出现在这里"
            />
          )
        : (
            <>
              <div className="fp-h-scroll">
                <Table<PlanRow>
                  size="small"
                  rowKey="fundCode"
                  pagination={false}
                  columns={columns}
                  dataSource={rows}
                />
              </div>

              {/* 一键换算：按主理人本期买入合计 × 跟投比例，拆到每只上 */}
              <RouterForm method="get" className="mt-4 rounded-[12px] bg-well p-3">
                <label className="block max-w-[260px]">
                  <span className="mb-1 block text-[13px] text-muted">跟投比例</span>
                  <Input
                    name="ratio"
                    value={ratioText}
                    onChange={e => setRatioText(e.target.value)}
                    inputMode="decimal"
                    suffix={<span className="text-[12px] text-placeholder">%</span>}
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button type="primary" htmlType="submit" loading={computing}>
                    一键算出本期金额
                  </Button>
                  <span className="text-[13px] text-muted">
                    本期合计
                    {" "}
                    <span className="font-num text-ink">{fmtYuan(targetCents)}</span>
                    {" "}
                    元
                  </span>
                </div>
                <p className="mt-2 mb-0 text-[12px] text-tertiary">
                  {/* 文案里的比例用**服务端实际生效**的那个（initial.ratioBps），
                      不用输入框里的文本：填了非法值回落时，输入框会留着用户敲的
                      那串字让他改，但页面上算的必须是生效值（另有 Alert 说明回落） */}
                  按主理人本期买入合计的
                  {" "}
                  {bpsToInputText(initial.ratioBps)}
                  % 换算，再照各基金的买入金额占比分摊；「你的金额」四舍五入到分，
                  已做余数补齐，逐只加起来正好等于上面的合计。
                </p>
              </RouterForm>

              {belowMinCount > 0
                ? (
                    <Alert
                      type="warning"
                      showIcon
                      className="mt-3"
                      message={`有 ${belowMinCount} 只换算后低于起购金额，实际下单会被拒`}
                      description="资金不多时可以把比例调大、或者自己在这几只里挑一部分跟，不必照单全买。"
                    />
                  )
                : null}

              {/* 发车参考金额的用法（原图里的说明块） */}
              <div className="mt-3 rounded-[12px] bg-well p-3 text-[13px] leading-relaxed text-muted">
                <div className="mb-1 text-ink">如何使用发车参考金额</div>
                <ul className="m-0 list-disc pl-5">
                  <li>实际使用的时候，可以根据自己的资金，按照一定比例来定投。</li>
                  <li>例如资金较少的情况下，可以按照百分之几的金额来投资。</li>
                </ul>
              </div>
            </>
          )}

      {notices.map(n => (
        <Alert key={n} type="info" showIcon className="mt-3" message={n} />
      ))}

      {rows.length > 0
        ? (
            <p className="mt-3 mb-0 text-[12px] text-tertiary">
              主理人本期买入合计
              {" "}
              <span className="font-num">{fmtYuan(masterTotalCents)}</span>
              {" "}
              元。「买入金额」是主理人的真实委托，只作参考；
              「你的金额」是按上面填的跟投比例换算的结果，两边不可混算。
            </p>
          )
        : null}
    </SectionCard>
  );
}
