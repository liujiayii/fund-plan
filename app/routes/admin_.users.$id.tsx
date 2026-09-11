import type { Route } from "./+types/admin_.users.$id";
import type { DcaPlanView, HoldingView, OrderView } from "~/services/portfolio-service";
import { Pagination, Space, Tabs, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { DcaPlanList } from "~/components/DcaPlanList";
import { HoldingList, sharesAndNavNote } from "~/components/HoldingList";
import { OrderList } from "~/components/OrderList";
import { ProfitContent } from "~/components/ProfitContent";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { PeriodTabs } from "~/components/ui/PeriodTabs";
import { SectionCard } from "~/components/ui/SectionCard";
import { toBeijing } from "~/domain/trading-calendar";
import { getUserDetail } from "~/services/admin-service";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Paragraph } = Typography;

/**
 * 每页条数。沿用 /master 交易记录 tab 的 `pageSize: 15`，
 * 订单全铺开会变成几十张卡。
 */
const PAGE_SIZE = 15;

export function meta(_: Route.MetaArgs) {
  return [{ title: "用户详情 · 管理后台 · 模拟基金" }];
}
/**
 * admin 看某个用户的盘：只读。IA 对齐 /me（钱 → 仓 → tabs），
 * 只读铁律不变——全页没有任何操作按钮。
 *
 * ⚠️ 文件名里的 `admin_.` 尾下划线是刻意的：断开与 admin.tsx 的嵌套。
 * 此前叫 admin.users.$id.tsx（点号串联=嵌套路由），但 admin.tsx 是普通
 * 页面组件没有 <Outlet/>，嵌套子路由永远渲染不出来——整页访问时 title
 * 换了正文却还是列表页（PR #34 起就坏，SPA 化后症状放大成「URL 变了
 * 内容不变」）。改名后两条路由各自整屏渲染，互不包裹。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  await requireAdmin(request, db);

  const id = Number(params.id);
  // 非数字 id（如 /admin/users/abc）与不存在的用户一并 404
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("用户不存在", { status: 404 });
  }

  // 详情包（组合/订单/在途/定投）与收益三件套互不依赖，一波并行。
  // 用户不存在时 getProfitDetail 只是空序列，多查几条换掉串行的一跳往返划算
  const [detail, profit] = await Promise.all([
    getUserDetail(db, id),
    getProfitDetail(db, id),
  ]);
  if (!detail) {
    throw new Response("用户不存在", { status: 404 });
  }

  return { detail, profit };
}

export default function AdminUserDetail({ loaderData }: Route.ComponentProps) {
  const { detail, profit } = loaderData;
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
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {user.username}
          {" 的盘"}
          {user.role === "admin" && <Tag style={{ marginLeft: 8 }}>主理人</Tag>}
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          注册于
          {" "}
          {toBeijing(new Date(user.createdAt)).format("YYYY-MM-DD")}
          {" "}
          ·
          管理员只读视图，与用户自己的 /me 同口径
        </Paragraph>
      </div>

      {/* 返回列表的入口放标题区下方，排查问题时在多个用户间跳转是高频动作 */}
      <NavButton to="/admin">← 返回用户列表</NavButton>

      {/* 钱：总览卡是门面，挂 fp-glass-specular 高光（宪法 §2.3 白名单：总资产卡）。
          pendingBuyCents 把申购中在途并回持仓金额与总资产——pending 窗口内
          总资产才跟 /me 同口径，排查「钱凭空少一笔」靠它 */}
      <SectionCard className="animate-fade-up fp-glass-specular">
        <AssetOverviewCard
          summary={summary}
          daily={profit.daily}
          latest={profit.latest}
          totalDepositedCents={profit.totalDepositedCents}
          pendingBuyCents={pendingBuyCents}
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
          走势+日历并进收益明细 tab，不再单独占两张卡把钱和仓切开。
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

/** 定投面板：只读计划列表。renderActions 刻意不传——admin 绝不出现暂停/删除 */
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
