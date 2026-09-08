import type { Route } from "./+types/me.profit";
import { Space, Typography } from "antd";
import { AssetPnlSummary } from "~/components/AssetPnlSummary";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { ProfitCalendarCard } from "~/components/ProfitCalendarCard";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";

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

export default function MeProfit({ loaderData }: Route.ComponentProps) {
  const { daily, latest } = loaderData.detail;

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

              {/* 收益日历：点击日期切换下方固定明细（默认最新有收益的一天） */}
              <SectionCard title="收益日历">
                <ProfitCalendarCard detail={loaderData.detail} />
                <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                  点击日期切换查看当日各基金收益明细
                </Paragraph>
              </SectionCard>
            </>
          )}
    </Space>
  );
}
