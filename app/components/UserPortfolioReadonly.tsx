import type { ReactNode } from "react";
import type { AdminUserDetail } from "~/services/admin-service";
import type { ProfitDetailView } from "~/services/asset-service";
import type { DcaPlanView, HoldingView, OrderView } from "~/services/portfolio-service";
import { Pagination, Space, Tabs, Typography } from "antd";
import { useMemo, useState } from "react";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { DcaPlanList } from "~/components/DcaPlanList";
import { HoldingList, sharesAndNavNote } from "~/components/HoldingList";
import { OrderList } from "~/components/OrderList";
import { ProfitContent } from "~/components/ProfitContent";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { SectionCard } from "~/components/ui/SectionCard";

const { Paragraph } = Typography;

/**
 * 每页条数。沿用 /master 交易记录 tab 的 `pageSize: 15`，
 * 订单全铺开会变成几十张卡。
 */
const PAGE_SIZE = 15;

/**
 * 只读盘面：总览 → 持仓 → 收益/订单/定投。
 * admin 详情与公开组合页共用，鉴权和标题由调用方负责。
 */
export function UserPortfolioReadonly({
  detail,
  profit,
  header,
  visibility = "private",
}: {
  detail: Pick<AdminUserDetail, "user" | "portfolio" | "orders" | "pendingBuyCents" | "plans">;
  profit: ProfitDetailView;
  /** 标题区（用户名、说明、返回按钮）。盘面本身不猜是 admin 还是公开页 */
  header: ReactNode;
  /** public 时总览卡不展示总资产与可用余额（排行榜承诺不公示这两项） */
  visibility?: "private" | "public";
}) {
  const { user, portfolio, orders, pendingBuyCents, plans } = detail;
  const { summary, holdings } = portfolio;

  // 持仓排序：持有金额（市值）/ 持有收益两键切换，降序；默认持有金额。
  // 客户端排——持仓数据 loader 已全量带回，几十只以内零成本（/me 同款）
  const [sortKey, setSortKey] = useState<"amount" | "pnl">("amount");
  const sortedHoldings = useMemo(
    () =>
      [...holdings].sort((a, b) =>
        sortKey === "amount"
          ? b.marketValueCents - a.marketValueCents
          : b.pnlCents - a.pnlCents),
    [holdings, sortKey],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {header}

      {/* 钱：总览卡是门面，挂 fp-glass-specular 高光（宪法 §2.3 白名单：总资产卡）。
          pendingBuyCents 把申购中在途并回持仓金额与总资产——pending 窗口内
          总资产才跟 /me 同口径 */}
      <SectionCard className="animate-fade-up fp-glass-specular">
        <AssetOverviewCard
          summary={summary}
          daily={profit.daily}
          latest={profit.latest}
          totalDepositedCents={profit.totalDepositedCents}
          investedCents={profit.investedCents}
          pendingBuyCents={pendingBuyCents}
          visibility={visibility}
        />
      </SectionCard>

      {/* 仓：持仓紧跟钱（/me 同款 IA）。标题带只数与合计市值；
          只读——无买入/卖出，行链仍走默认 /funds/:code */}
      <SectionCard
        title={`持仓（${holdings.length} 只 · 市值 ${fmtYuan(summary.marketValueCents)} 元）`}
        className="animate-fade-up animate-delay-[60ms]"
        extra={(
          <PeriodTabs
            options={[
              { key: "amount", label: "持有金额" },
              { key: "pnl", label: "持有收益" },
            ]}
            value={sortKey}
            onChange={v => setSortKey(v as "amount" | "pnl")}
          />
        )}
      >
        <HoldingsPane holdings={sortedHoldings} />
      </SectionCard>

      {/* 账：收益明细 / 交易记录 / 定投计划 tabs 垫底（/me 同款三 tab）。
          rc-tabs 惰性挂载：图表首次激活才 mount，不会在隐藏容器里起 0×0 canvas */}
      <SectionCard className="animate-fade-up animate-delay-[120ms]">
        <Tabs
          defaultActiveKey="profit"
          items={[
            {
              key: "profit",
              label: "收益明细",
              children: <ProfitContent detail={profit} />,
            },
            {
              key: "orders",
              label: `交易记录（${orders.length}）`,
              // key=user.id：同路由换用户时组件会复用（RR 不按 params 卸载），
              // 不换 key 的话上一个用户翻到第 2 页、下一个用户订单不足 16 条，
              // slice 出空数组却走不到 EmptyState（CodeRabbit PR #82）
              children: <OrdersPane key={user.id} orders={orders} />,
            },
            {
              key: "dca",
              label: `定投计划（${plans.length}）`,
              children: <DcaPane plans={plans} />,
            },
          ]}
        />
      </SectionCard>
    </Space>
  );
}

/* ─────────── 三个只读面板 ─────────── */

/** 持仓面板：只读列表。note 补成本（/me 持仓模块同款信息密度），无操作按钮 */
function HoldingsPane({ holdings }: { holdings: HoldingView[] }) {
  if (holdings.length === 0) {
    return <EmptyState description="暂无持仓" />;
  }
  return (
    <>
      <HoldingList
        holdings={holdings}
        renderNote={h => `${sharesAndNavNote(h)} · 成本 ${fmtYuan(h.costCents)} 元`}
      />
      <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
        「批次」是同一只基金分次买入形成的份额批，赎回时按买入时间先进先出消耗，
        每批按各自持有天数计赎回费。
      </Paragraph>
    </>
  );
}

/** 定投面板：只读计划列表。renderActions 刻意不传——绝不出现暂停/删除 */
function DcaPane({ plans }: { plans: DcaPlanView[] }) {
  return plans.length === 0
    ? <EmptyState description="暂无定投计划" />
    : <DcaPlanList plans={plans} />;
}

/** 交易记录面板：只读订单卡 + 客户端分页。detailed 展开成交明细，failed 原因在 Tooltip */
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
            <div className="fp-h-scroll mt-4">
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
