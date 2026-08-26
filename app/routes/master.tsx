import type { Route } from "./+types/master";
import { Pagination, Space, Tabs, Tag, Typography } from "antd";
import { useState } from "react";
import { DcaPlanList } from "~/components/DcaPlanList";
import { OrderList } from "~/components/OrderList";
import {
  AdminNotReady,
  HoldingListReadonly,
  PortfolioSummary,
} from "~/components/PortfolioView";
import { TxList } from "~/components/TxList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
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
    { title: "主人的示范盘 · 模拟基金" },
    { name: "description", content: "围观管理员的模拟基金组合：持仓、定投与交易流水全公开" },
  ];
}

/**
 * 主人的公开示范盘。游客无需登录即可查看——
 * 这是产品的「围观大佬」卖点，全部只读。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const admin = await getAdminUser(db, env);

  if (!admin) {
    return { admin: null, adminName: env.ADMIN_USERNAME ?? "未配置" } as const;
  }

  const [portfolio, orders, plans, txs] = await Promise.all([
    getPortfolio(db, admin.id),
    getOrders(db, admin.id, 50),
    getDcaPlans(db, admin.id),
    getTransactions(db, admin.id, 50),
  ]);

  return { admin, portfolio, orders, plans, txs } as const;
}

export default function Master({ loaderData }: Route.ComponentProps) {
  // 客户端分页：两个 tab 各自一份页码，互不影响。
  // ⚠️ 必须放在下面「主人未注册」的提前 return **之前** ——
  // hook 调用数量要在两条渲染路径上一致，否则 React 报
  // Rendered fewer hooks than expected
  const [orderPage, setOrderPage] = useState(1);
  const [txPage, setTxPage] = useState(1);

  if (!loaderData.admin) {
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Title level={3}>主人的示范盘</Title>
        <AdminNotReady adminName={loaderData.adminName} />
      </Space>
    );
  }

  const { admin, portfolio, orders, plans, txs } = loaderData;

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

      <SectionCard>
        <Tabs
          items={[
            {
              key: "holdings",
              label: `持仓（${portfolio.holdings.length}）`,
              children: <HoldingListReadonly holdings={portfolio.holdings} />,
            },
            {
              key: "dca",
              label: `定投计划（${plans.length}）`,
              children:
                plans.length === 0
                  ? <EmptyState description="暂无定投计划" />
                  : <DcaPlanList plans={plans} />,
            },
            {
              key: "orders",
              label: `交易记录（${orders.length}）`,
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
                          <Pagination
                            align="end"
                            current={orderPage}
                            pageSize={PAGE_SIZE}
                            total={orders.length}
                            showSizeChanger={false}
                            style={{ marginTop: 16 }}
                            onChange={setOrderPage}
                          />
                        )}
                      </>
                    ),
            },
            {
              key: "txs",
              label: `资金流水（${txs.length}）`,
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
                          <Pagination
                            align="end"
                            current={txPage}
                            pageSize={PAGE_SIZE}
                            total={txs.length}
                            showSizeChanger={false}
                            style={{ marginTop: 16 }}
                            onChange={setTxPage}
                          />
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
