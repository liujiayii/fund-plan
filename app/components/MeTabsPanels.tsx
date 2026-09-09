import {
  Button,
  Pagination,
  Skeleton,
  Tabs,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { AssetPnlSummary } from "~/components/AssetPnlSummary";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { DcaPlanFormModal } from "~/components/DcaPlanFormModal";
import { DcaPlanList } from "~/components/DcaPlanList";
import { DcaPlanRowActions } from "~/components/DcaPlanRowActions";
import { OrderActions } from "~/components/OrderActions";
import { OrderList } from "~/components/OrderList";
import { OrderTimeline } from "~/components/OrderTimeline";
import { ProfitCalendarCard } from "~/components/ProfitCalendarCard";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { StatBig } from "~/components/ui/StatBig";

const { Text, Paragraph } = Typography;

/**
 * 「收益明细 / 交易记录 / 定投计划」页内 Tabs（2026-09-09，替代 QuickEntries 跳页）。
 *
 * 消费方：/me（全局口径）与 /me/holdings/:code（传 fundCode，交易记录/定投
 * 只看这只基金——与旧 QuickEntries 深链 ?fund= 完全同源）。
 *
 * 数据通道：每个面板一个独立 fetcher，用 fetcher.load() 复用对应路由页的
 * loader（/me/profit、/me/orders、/me/dca）——tab 内容与深链页一份真相，
 * 路由页本身保留不删（外链/收藏夹照常可用）。
 *
 * 加载策略（stale-while-revalidate）：
 *  - 首次激活：fetcher.load 拉全量，期间 Skeleton（无数据时）
 *  - 切走再切回：立即显示旧数据 + 后台重拉一遍
 *  - 面板内动作（撤单/改单/定投 CRUD）提交到对应路由 action，完成后
 *    react-router 自动 revalidate——页面 loader 与面板 fetcher 全部刷新，
 *    列表所见即最新
 *
 * tab 状态记在 ?tab= 查询参数：刷新/分享保持所在 tab；持仓详情页旧深链
 * ?tab=trade（开卖出抽屉）由该页自己的 effect 消费，这里认不出的值回落默认 tab。
 */

/** 全部合法 tab key；?tab= 不认识的一律回落 profit（防 ?tab=trade 之类深链残留） */
const TAB_KEYS = ["profit", "orders", "dca"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** 面板加载骨架：仅「正在加载且尚无数据」时显示，重验证期间旧数据继续展示 */
function PanelSkeleton() {
  return <Skeleton active title={false} paragraph={{ rows: 6 }} />;
}

export function MeTabs({ fundCode }: { fundCode?: string }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get("tab");
  const active: TabKey
    = (TAB_KEYS as readonly string[]).includes(raw ?? "") ? (raw as TabKey) : "profit";

  /** 切 tab = 写 ?tab=（push 进历史，浏览器后退可回上一个 tab） */
  const onChange = (key: string) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", key);
        return p;
      },
    );
  };

  return (
    <Tabs
      activeKey={active}
      onChange={onChange}
      items={[
        // rc-tabs 惰性挂载：面板首次激活才 mount，图表类组件不会在隐藏容器里起 0×0 canvas
        { key: "profit", label: "收益明细", children: <ProfitPanel active={active === "profit"} /> },
        { key: "orders", label: "交易记录", children: <OrdersPanel active={active === "orders"} fundCode={fundCode} /> },
        { key: "dca", label: "定投计划", children: <DcaPanel active={active === "dca"} fundCode={fundCode} /> },
      ]}
    />
  );
}

/* ─────────────────────── 收益明细 ─────────────────────── */

function ProfitPanel({ active }: { active: boolean }) {
  // fetcher.load 复用 /me/profit 的 loader：收益明细数据结构与深链页一份真相
  const fetcher = useFetcher<typeof import("~/routes/me.profit").loader>();

  useEffect(() => {
    // 激活且空闲时拉数据：首次无数据全量拉；切回时旧数据先展示、后台刷一遍。
    // 刻意只依赖 active——effect 只在激活态翻转时跑一次，靠 state 守卫防并发重复
    if (active && fetcher.state === "idle") {
      fetcher.load("/me/profit");
    }
    // eslint-disable-next-line react/exhaustive-deps -- fetcher 引用每渲染都换，进 deps 会配合「idle 即拉」退化成无限循环；此处只需激活沿触发
  }, [active]);

  const detail = fetcher.data?.detail;

  if (!detail) {
    return <PanelSkeleton />;
  }

  const { daily, latest } = detail;

  if (daily.length === 0) {
    return <EmptyState description="买入第一只基金后，这里会展示每日收益" />;
  }

  // 与 /me/profit 深链页同款内容：摘要 + 走势 + 日历（tab 内不套内层 SectionCard，
  // 用间距分隔）
  return (
    <div>
      <AssetPnlSummary daily={daily} latest={latest} />
      <AssetTrendChart data={daily} />
      <div className="mt-6" />
      <ProfitCalendarCard detail={detail} />
      <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
        点击日期切换查看当日各基金收益明细
      </Paragraph>
    </div>
  );
}

/* ─────────────────────── 交易记录 ─────────────────────── */

/** 每页条数。与 /me/orders 深链页一致的翻页手感 */
const ORDERS_PAGE_SIZE = 20;

function OrdersPanel({ active, fundCode }: { active: boolean; fundCode?: string }) {
  const fetcher = useFetcher<typeof import("~/routes/me.orders").loader>();
  // ?fund= 过滤：持仓详情页只看这只基金（与旧 QuickEntries 深链同参数）
  const url = fundCode ? `/me/orders?fund=${encodeURIComponent(fundCode)}` : "/me/orders";

  useEffect(() => {
    // 加载策略与 ProfitPanel 同款（见其注释）
    if (active && fetcher.state === "idle") {
      fetcher.load(url);
    }
    // eslint-disable-next-line react/exhaustive-deps -- url 由 fundCode 定死（组件生命周期内不变），fetcher 见上条同理
  }, [active]);

  // 客户端分页（loader 已带回全量 200 条）；翻页状态在面板内，切 tab 不丢
  const [page, setPage] = useState(1);

  const data = fetcher.data;
  if (!data) {
    return <PanelSkeleton />;
  }

  const orders = data.orders;
  // 待确认委托独立成区：撤单/改单的主战场（与深链页同款分区）
  const pendingOrders = orders.filter(o => o.status === "pending");

  return (
    <div>
      {pendingOrders.length > 0 && (
        <>
          <Text strong>
            待确认委托（
            {pendingOrders.length}
            {" "}
            笔）
          </Text>
          <OrderList orders={pendingOrders} renderActions={o => <OrderActions order={o} />} />
          <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
            真实基金是 T+1 成交：交易日 15:00 前下单按当日净值，之后顺延至下一交易日。
            系统每晚 20:30 拉取当日净值并撮合，此前均可撤单或改单。
          </Paragraph>
          <div className="mt-6" />
        </>
      )}

      <Text strong>
        全部订单（
        {orders.length}
        {" "}
        笔）
      </Text>
      {orders.length === 0
        ? (
            <EmptyState description={fundCode ? "该基金还没有交易记录" : "还没有交易记录"} />
          )
        : (
            <>
              <OrderTimeline
                orders={orders.slice((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE)}
                // 待确认行内挂撤单/改单（OrderActions 自行判断 pending 才渲染）
                renderActions={o => <OrderActions order={o} />}
              />
              {orders.length > ORDERS_PAGE_SIZE && (
                <div className="fp-h-scroll mt-4">
                  <Pagination
                    align="end"
                    responsive
                    current={page}
                    pageSize={ORDERS_PAGE_SIZE}
                    total={orders.length}
                    showSizeChanger={false}
                    onChange={setPage}
                  />
                </div>
              )}
            </>
          )}
      <Paragraph type="secondary" className="mb-0 mt-3 text-xs">
        申购采用真实的
        <Text strong>内扣法</Text>
        ：手续费从申购金额中扣除，
        剩余净额除以确认日净值得到份额。赎回按
        <Text strong>先进先出</Text>
        逐批计费。
      </Paragraph>
    </div>
  );
}

/* ─────────────────────── 定投计划 ─────────────────────── */

function DcaPanel({ active, fundCode }: { active: boolean; fundCode?: string }) {
  // 只 load 数据：动作（创建/修改/暂停/删除）全部内聚在共享组件里
  // （DcaPlanFormModal / DcaPlanRowActions），它们提交到 /me/dca action 后
  // react-router 自动 revalidate，本 fetcher 随之拿到新数据
  const dataFetcher = useFetcher<typeof import("~/routes/me.dca").loader>();
  const url = fundCode ? `/me/dca?fund=${encodeURIComponent(fundCode)}` : "/me/dca";

  useEffect(() => {
    // 加载策略与 ProfitPanel 同款（见其注释）
    if (active && dataFetcher.state === "idle") {
      dataFetcher.load(url);
    }
    // eslint-disable-next-line react/exhaustive-deps -- url 由 fundCode 定死，dataFetcher 见上条同理
  }, [active]);

  const [createOpen, setCreateOpen] = useState(false);

  const data = dataFetcher.data;
  if (!data) {
    return <PanelSkeleton />;
  }

  const plans = data.plans;
  const totalInvested = plans.reduce((s, p) => s + p.totalInvested, 0);
  const activeCount = plans.filter(p => p.status === "active").length;

  return (
    <div>
      {/* [16,16]：统计行间距降档，窄屏折行后不撑高 */}
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <StatBig label="计划总数" value={plans.length} suffix="个" size={24} />
        <StatBig label="执行中" value={activeCount} suffix="个" size={24} />
        <StatBig label="累计投入" value={fmtYuan(totalInvested)} suffix="元" size={24} />
      </div>
      <Paragraph type="secondary" className="mb-0 mt-4 text-xs">
        系统每天北京时间
        {" "}
        <Text strong>10:00</Text>
        {" "}
        扫描到期的定投计划并自动下单，
        当晚 20:30 按当日净值撮合确认。现金不足时该期跳过，不影响其他计划。
      </Paragraph>

      <div className="mt-6" />
      {plans.length === 0
        ? (
            <EmptyState description="还没有定投计划">
              <Button type="primary" onClick={() => setCreateOpen(true)}>
                创建第一个计划
              </Button>
            </EmptyState>
          )
        : (
            <>
              <div className="flex items-center justify-between">
                <Text strong>计划列表</Text>
                <Button size="small" onClick={() => setCreateOpen(true)}>
                  新建计划
                </Button>
              </div>
              {/* 行内操作（修改/暂停/删除）与表单弹窗全走共享组件——与
                  me.dca 深链页、基金/持仓页的定投抽屉一份真相 */}
              <DcaPlanList
                plans={plans}
                renderActions={p => <DcaPlanRowActions plan={p} />}
              />
            </>
          )}

      {/* 条件渲染 = 每次打开全新实例，表单初始值不用手动重置 */}
      {createOpen && (
        <DcaPlanFormModal
          open
          onClose={() => setCreateOpen(false)}
          defaultFundCode={fundCode}
        />
      )}
    </div>
  );
}
