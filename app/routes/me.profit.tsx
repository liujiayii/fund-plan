import type { Route } from "./+types/me.profit";
import { Modal, Space, Typography } from "antd";
import { useState } from "react";
import { AssetPnlSummary } from "~/components/AssetPnlSummary";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { ProfitCalendar } from "~/components/ProfitCalendar";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { COLOR, NUM_FONT, pnlColor } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "收益明细 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const detail = await getProfitDetail(db, user.id);
  return { detail };
}

/** 日期串 → 「9 月 5 日」（去前导零，与 AssetOverviewCard 同款手法） */
function fmtDateLabel(date: string): string {
  return `${String(Number(date.slice(5, 7)))} 月 ${String(Number(date.slice(8, 10)))} 日`;
}

export default function MeProfit({ loaderData }: Route.ComponentProps) {
  const { daily, latest, fundPnlByDate, fundNames } = loaderData.detail;
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  // 弹层数据：合计（重放口径）+ 各基金条目（按当日收益降序）
  const pickedDay = pickedDate
    ? daily.find(d => d.date === pickedDate) ?? null
    : null;
  const pickedEntries = pickedDate
    ? [...(fundPnlByDate[pickedDate] ?? [])].sort((a, b) => b.dayPnlCents - a.dayPnlCents)
    : [];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        收益明细
      </Title>

      {daily.length === 0
        ? (
            <SectionCard>
              <EmptyState description="买入第一只基金后，这里会展示每日收益" />
            </SectionCard>
          )
        : (
            <>
              {/* 资产走势：与 /me 原版同款（摘要两格 + 曲线图），口径注释见 AssetPnlSummary */}
              <SectionCard title="资产走势">
                <AssetPnlSummary daily={daily} latest={latest} />
                <AssetTrendChart data={daily} />
              </SectionCard>

              {/* 收益日历：点击有数据的日期看当日各基金收益 */}
              <SectionCard title="收益日历">
                <ProfitCalendar data={daily} onPickDate={setPickedDate} />
                <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                  点击日期查看当日各基金收益明细
                </Paragraph>
              </SectionCard>
            </>
          )}

      {/* 当日收益明细弹层：合计 + 各基金贡献（含已清仓基金的历史条目） */}
      <Modal
        open={pickedDate !== null}
        footer={null}
        title={pickedDate ? `${fmtDateLabel(pickedDate)} 收益` : ""}
        onCancel={() => setPickedDate(null)}
      >
        {pickedDay && (
          <>
            <StatBig
              label="当日收益"
              value={`${pickedDay.dayPnlCents > 0 ? "+" : ""}${fmtYuan(pickedDay.dayPnlCents)}`}
              suffix="元"
              color={pnlColor(pickedDay.dayPnlCents)}
              extra={`收益率 ${(pickedDay.dayPnlRate * 100).toFixed(2)}%`}
            />
            <div style={{ marginTop: 16 }}>
              {pickedEntries.length === 0
                ? (
                    <EmptyState description="当日无持仓收益变动" />
                  )
                : pickedEntries.map((f, i) => (
                    <FundListItem
                      key={f.fundCode}
                      fundCode={f.fundCode}
                      fundName={fundNames[f.fundCode] ?? f.fundCode}
                      // 行链基金详情页：已清仓基金没有持仓详情页，/funds/:code 对两者都成立
                      href={`/funds/${f.fundCode}`}
                      last={i === pickedEntries.length - 1}
                      primary={(
                        <span
                          style={{
                            fontFamily: NUM_FONT,
                            fontSize: 16,
                            color: pnlColor(f.dayPnlCents),
                          }}
                        >
                          {`${f.dayPnlCents > 0 ? "+" : ""}${fmtYuan(f.dayPnlCents)}`}
                          <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元</span>
                        </span>
                      )}
                      secondary={<PnlText rate={f.dayNavRate} size={12} />}
                    />
                  ))}
            </div>
          </>
        )}
      </Modal>
    </Space>
  );
}
