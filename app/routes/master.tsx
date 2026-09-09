import type { Route } from "./+types/master";
import type { DcaPlanView, HoldingView, OrderView, TransactionView } from "~/services/portfolio-service";
import { Pagination, Space, Tabs, Tag, Typography } from "antd";
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
  // 「主理人未注册」的提前 return 前没有 hook 了——分页状态全部收进各 tab 面板
  // 组件里（面板被 rc-tabs 惰性挂载且切走不卸载，翻页状态天然各自独立）
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

      {/* 顶部与 /me 同款总览卡（一行四格版） */}
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

      {/* 持仓/定投/交易/流水四块合一 tab：平铺版页面太长（ux-polish #9 的决策
          被主人 2026-09-09 推翻），条数进 tab 标签、一眼可扫；数据 loader
          全量带回（查询数零变化），纯展示层重组 */}
      <SectionCard>
        <Tabs
          defaultActiveKey="holdings"
          items={[
            {
              key: "holdings",
              label: `持仓（${portfolio.holdings.length}）`,
              children: <HoldingsPane holdings={portfolio.holdings} />,
            },
            {
              key: "dca",
              label: `定投计划（${plans.length}）`,
              children: <DcaPane plans={plans} />,
            },
            {
              key: "orders",
              label: `交易记录（${orders.length}）`,
              children: <OrdersPane orders={orders} />,
            },
            {
              key: "txs",
              label: `资金流水（${txs.length}）`,
              children: <TxsPane txs={txs} />,
            },
          ]}
        />
      </SectionCard>
    </Space>
  );
}

/* ─────────── 四个 tab 面板：只读展示 + 各自的空态与分页 ─────────── */

/** 持仓面板：只读列表（与 /me 的可操作版共用 HoldingList 家族） */
function HoldingsPane({ holdings }: { holdings: HoldingView[] }) {
  return holdings.length === 0
    ? <EmptyState description="暂无持仓" />
    : <HoldingListReadonly holdings={holdings} />;
}

/** 定投面板：只读计划列表 */
function DcaPane({ plans }: { plans: DcaPlanView[] }) {
  return plans.length === 0
    ? <EmptyState description="暂无定投计划" />
    : <DcaPlanList plans={plans} />;
}

/** 交易记录面板：只读订单卡 + 客户端分页 */
function OrdersPane({ orders }: { orders: OrderView[] }) {
  // 翻页状态在面板内：切 tab 再切回不丢（rc-tabs 切走不卸载）
  const [page, setPage] = useState(1);
  return orders.length === 0
    ? <EmptyState description="暂无交易记录" />
    : (
        <>
          <OrderList orders={orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} detailed />
          {orders.length > PAGE_SIZE && (
            // 窄屏包一层横向滚动容器：翻页器页码多了能滑，不顶穿卡片
            <div className="fp-h-scroll" style={{ marginTop: 16 }}>
              <Pagination
                align="end"
                responsive
                current={page}
                pageSize={PAGE_SIZE}
                total={orders.length}
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          )}
        </>
      );
}

/** 资金流水面板：只读流水卡 + 客户端分页 */
function TxsPane({ txs }: { txs: TransactionView[] }) {
  const [page, setPage] = useState(1);
  return txs.length === 0
    ? <EmptyState description="暂无流水" />
    : (
        <>
          <TxList txs={txs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} />
          {txs.length > PAGE_SIZE && (
            <div className="fp-h-scroll" style={{ marginTop: 16 }}>
              <Pagination
                align="end"
                responsive
                current={page}
                pageSize={PAGE_SIZE}
                total={txs.length}
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          )}
        </>
      );
}
