import type { Route } from "./+types/master";
import { Pagination, Space, Tabs, Tag, Typography } from "antd";
import { useState } from "react";
import { AssetPnlSummary } from "~/components/AssetPnlSummary";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { DcaPlanList } from "~/components/DcaPlanList";
import { OrderList } from "~/components/OrderList";
import {
  AdminNotReady,
  HoldingListReadonly,
  PortfolioSummary,
} from "~/components/PortfolioView";
import { ProfitCalendar } from "~/components/ProfitCalendar";
import { TxList } from "~/components/TxList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAssetTimeline } from "~/services/asset-service";
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

  const [portfolio, orders, plans, txs, timeline] = await Promise.all([
    getPortfolio(db, admin.id),
    getOrders(db, admin.id, 50),
    getDcaPlans(db, admin.id),
    getTransactions(db, admin.id, 50),
    getAssetTimeline(db, admin.id),
  ]);

  return { admin, portfolio, orders, plans, txs, timeline } as const;
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

  const { admin, portfolio, orders, plans, txs, timeline } = loaderData;

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

      <SectionCard>
        <PortfolioSummary portfolio={portfolio} />
      </SectionCard>

      {/* 收益详情：与 /me 完全同款（AssetPnlSummary 单日+累计两格 + 曲线图 + 收益日历），
          游客围观主理人时也能看到「这个盘到底赚没赚」的完整故事 */}
      <SectionCard title="资产走势">
        <AssetPnlSummary daily={timeline.daily} latest={timeline.latest} />
        <AssetTrendChart data={timeline.daily} />
      </SectionCard>

      <SectionCard title="收益日历">
        <ProfitCalendar data={timeline.daily} />
      </SectionCard>

      <SectionCard>
        <Tabs
          items={[
            {
              key: "holdings",
              label: `持仓`,
              children: <HoldingListReadonly holdings={portfolio.holdings} />,
            },
            {
              key: "dca",
              label: `定投计划`,
              children:
                plans.length === 0
                  ? <EmptyState description="暂无定投计划" />
                  : <DcaPlanList plans={plans} />,
            },
            {
              key: "orders",
              label: `交易记录`,
              children:
                orders.length === 0
                  ? <EmptyState description="暂无交易记录" />
                  : (
                      <>
                        <OrderList
                          orders={orders.slice(
                            (orderPage - 1) * PAGE_SIZE,
                            orderPage * PAGE_SIZE,
                          )}
                          detailed
                        />
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
                    ),
            },
            {
              key: "txs",
              label: `资金流水`,
              children:
                txs.length === 0
                  ? <EmptyState description="暂无流水" />
                  : (
                      <>
                        <TxList
                          txs={txs.slice(
                            (txPage - 1) * PAGE_SIZE,
                            txPage * PAGE_SIZE,
                          )}
                        />
                        {txs.length > PAGE_SIZE && (
                          // 窄屏包一层横向滚动容器：翻页器页码多了能滑，不顶穿卡片
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
                    ),
            },
          ]}
        />
      </SectionCard>
    </Space>
  );
}
