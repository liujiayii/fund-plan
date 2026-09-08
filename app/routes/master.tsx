import type { Route } from "./+types/master";
import { Pagination, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { AssetPnlSummary } from "~/components/AssetPnlSummary";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { DcaPlanList } from "~/components/DcaPlanList";
import { OrderList } from "~/components/OrderList";
import {
  AdminNotReady,
  HoldingListReadonly,
} from "~/components/PortfolioView";
import { ProfitCalendarCard } from "~/components/ProfitCalendarCard";
import { TxList } from "~/components/TxList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { getAdminUser } from "~/services/guard";
import {
  getDcaPlans,
  getOrders,
  getPortfolio,
  getTransactions,
} from "~/services/portfolio-service";

const { Title, Paragraph } = Typography;

/**
 * 每页条数。沿用被卡片列表取代的那两张旧 Table 的 `pageSize: 15`，
 * 交易记录与资金流水各取 50 条，全铺开是 50 张卡片。
 */
const PAGE_SIZE = 15;

export function meta(_: Route.MetaArgs) {
  return [
    { title: "主理人的示范盘 · 模拟基金" },
    { name: "description", content: "围观管理员的模拟基金组合：持仓、定投与交易流水全公开" },
  ];
}

/**
 * 主理人的公开示范盘。游客无需登录即可查看——
 * 这是产品的「围观大佬」卖点，全部只读。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const admin = await getAdminUser(db, env);

  if (!admin) {
    return { admin: null, adminName: env.ADMIN_USERNAME ?? "未配置" } as const;
  }

  const [portfolio, orders, plans, txs, profit] = await Promise.all([
    getPortfolio(db, admin.id),
    getOrders(db, admin.id, 50),
    getDcaPlans(db, admin.id),
    getTransactions(db, admin.id, 50),
    // 换 getAssetTimeline 为 getProfitDetail：日历要各基金归因明细（+1 条 fund 名查询）
    getProfitDetail(db, admin.id),
  ]);

  return { admin, portfolio, orders, plans, txs, profit } as const;
}

export default function Master({ loaderData }: Route.ComponentProps) {
  // 客户端分页：两个 tab 各自一份页码，互不影响。
  // ⚠️ 必须放在下面「主理人未注册」的提前 return **之前** ——
  // hook 调用数量要在两条渲染路径上一致，否则 React 报
  // Rendered fewer hooks than expected
  const [orderPage, setOrderPage] = useState(1);
  const [txPage, setTxPage] = useState(1);

  if (!loaderData.admin) {
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Title level={3}>主理人的示范盘</Title>
        <AdminNotReady adminName={loaderData.adminName} />
      </Space>
    );
  }

  const { admin, portfolio, orders, plans, txs, profit } = loaderData;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {admin.username}
          {" "}
          的示范盘
          <Tag color="blue" style={{ marginLeft: 8 }}>
            公开
          </Tag>
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          这是管理员的模拟组合，持仓、定投与交易流水全部公开，任何人都能围观学习。
        </Paragraph>
      </div>

      {/* 顶部与 /me 同款总览卡（四小格版，Task 3 已升级） */}
      <SectionCard>
        <AssetOverviewCard
          summary={portfolio.summary}
          daily={profit.daily}
          latest={profit.latest}
          totalDepositedCents={profit.totalDepositedCents}
        />
      </SectionCard>

      {/* 资产走势与收益日历：主理人没交易过（daily 为空）时不渲染，空盘不摆空图 */}
      {profit.daily.length > 0 && (
        <>
          <SectionCard title="资产走势">
            <AssetPnlSummary daily={profit.daily} latest={profit.latest} />
            <AssetTrendChart data={profit.daily} />
          </SectionCard>
          <SectionCard title="收益日历">
            <ProfitCalendarCard detail={profit} />
          </SectionCard>
        </>
      )}

      {/* 四块内容拆 Tab 平铺：信息一目了然，不用点来点去（ux-polish #9 决策） */}
      <SectionCard title={`持仓（${portfolio.holdings.length} 只）`}>
        <HoldingListReadonly holdings={portfolio.holdings} />
      </SectionCard>

      <SectionCard title="定投计划">
        {plans.length === 0
          ? <EmptyState description="暂无定投计划" />
          : <DcaPlanList plans={plans} />}
      </SectionCard>

      <SectionCard title={`交易记录（最近 ${orders.length} 条）`}>
        {orders.length === 0
          ? <EmptyState description="暂无交易记录" />
          : (
              <>
                <OrderList orders={orders.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE)} detailed />
                {orders.length > PAGE_SIZE && (
                  // 窄屏包一层横向滚动容器：翻页器页码多了能滑，不顶穿卡片
                  <div className="fp-h-scroll" style={{ marginTop: 16 }}>
                    <Pagination
                      align="end"
                      responsive
                      current={orderPage}
                      pageSize={PAGE_SIZE}
                      total={orders.length}
                      showSizeChanger={false}
                      onChange={setOrderPage}
                    />
                  </div>
                )}
              </>
            )}
      </SectionCard>

      <SectionCard title={`资金流水（最近 ${txs.length} 条）`}>
        {txs.length === 0
          ? <EmptyState description="暂无流水" />
          : (
              <>
                <TxList txs={txs.slice((txPage - 1) * PAGE_SIZE, txPage * PAGE_SIZE)} />
                {txs.length > PAGE_SIZE && (
                  <div className="fp-h-scroll" style={{ marginTop: 16 }}>
                    <Pagination
                      align="end"
                      responsive
                      current={txPage}
                      pageSize={PAGE_SIZE}
                      total={txs.length}
                      showSizeChanger={false}
                      onChange={setTxPage}
                    />
                  </div>
                )}
              </>
            )}
      </SectionCard>
    </Space>
  );
}
