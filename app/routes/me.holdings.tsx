import type { Route } from "./+types/me.holdings";
import { Button, Space, Typography } from "antd";
import { eq } from "drizzle-orm";
import { HoldingList, sharesAndNavNote } from "~/components/HoldingList";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { account } from "~/db/schema";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getPortfolio } from "~/services/portfolio-service";
import { pnlColor } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的持仓 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  // 本页只是「列表 → 点进单只持仓详情」的入口：批次、待赎回占用、费率档等
  // 细节都归 `/me/holdings/:code`（getHoldingDetail）管，这里不再查。
  const portfolio = await getPortfolio(db, user.id);
  const acc = await db.query.account.findFirst({
    where: eq(account.userId, user.id),
  });

  return {
    portfolio,
    cash: acc?.cash ?? 0,
  };
}

export default function MeHoldings({ loaderData }: Route.ComponentProps) {
  const { portfolio, cash } = loaderData;
  const { summary, holdings } = portfolio;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的持仓
      </Title>

      <SectionCard>
        {/* [16,16]：统计行间距降档（Task 10），窄屏折行后 rowGap 不再是 48 */}
        <Space size={[16, 16]} wrap>
          {/* ⚠️ 这里刻意不传 size，吃 StatBig 的 32px 默认值。
              StatBig 的规则是「主位 32、次位 24」—— 那是按**角色**定的，不是按标签定的。
              /me 与 /master 上主位是「总资产」，所以那两页的「持仓市值」是次位 24；
              本页根本不显示总资产，「持仓市值」就是这一页的主位。
              全分支 review 曾按「同一标签跨页不该变字号」建议统一成 24，
              那会让本页三个数字齐平、**一页没有视觉锚点**。不要再统一。 */}
          <StatBig
            label="持仓市值"
            value={fmtYuan(summary.marketValueCents)}
            suffix="元"
          />
          <StatBig
            label="可用现金"
            value={fmtYuan(cash)}
            suffix="元"
            size={24}
          />
          <StatBig
            label="浮动盈亏"
            value={`${summary.totalPnlCents > 0 ? "+" : ""}${fmtYuan(summary.totalPnlCents)}`}
            suffix="元"
            size={24}
            color={pnlColor(summary.totalPnlCents)}
          />
        </Space>
      </SectionCard>

      <SectionCard title={`持仓明细（${holdings.length} 只）`}>
        {holdings.length === 0
          ? (
              <EmptyState description="还没有持仓">
                <Button type="primary" href="/funds">
                  去挑一只基金
                </Button>
              </EmptyState>
            )
          : (
              <HoldingList
                holdings={holdings}
                // 份额 + 估值时点 + 成本；批次数/待赎回已下沉到单只详情页
                renderNote={h => `${sharesAndNavNote(h)} · 成本 ${fmtYuan(h.costCents)} 元`}
                // 行点进单只持仓详情，不再链到 /funds/{code}
                getHref={h => `/me/holdings/${h.fundCode}`}
                // 行内「详情 / 卖出」：卖出深链直达交易页签（?tab=trade）。
                // 每行按钮一致（FundListItem 的 actions 宽度契约），不加买入——
                // 买入入口在自选页/基金详情页，这里再加就回到「到处都是」
                renderActions={h => (
                  <Space size={8}>
                    <Button size="small" href={`/me/holdings/${h.fundCode}`}>
                      详情
                    </Button>
                    <Button size="small" type="primary" href={`/me/holdings/${h.fundCode}?tab=trade`}>
                      卖出
                    </Button>
                  </Space>
                )}
              />
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          「批次」是同一只基金分次买入形成的份额批，赎回时按买入时间先进先出消耗，
          每批按各自持有天数计赎回费。
        </Paragraph>
      </SectionCard>
    </Space>
  );
}
