import {
  Button,
  Skeleton,
  Tabs,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { DcaPlanFormModal } from "~/components/DcaPlanFormModal";
import { DcaPlanList } from "~/components/DcaPlanList";
import { DcaPlanRowActions } from "~/components/DcaPlanRowActions";
import { OrdersContent } from "~/components/OrdersContent";
import { ProfitContent } from "~/components/ProfitContent";
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
 * 面板本体是纯懒加载壳（fetcher + 骨架屏），内容体全在共享组件里：
 * OrdersContent / ProfitContent /（DcaPanel 内联，动作走 DcaPlanFormModal
 * 与 DcaPlanRowActions）——深链页与 tab 渲染同一份，不会漂移。
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
  // fetcher.load 复用 /me/profit 的 loader：内容体在 ProfitContent（与深链页一份真相）
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
  return <ProfitContent detail={detail} />;
}

/* ─────────────────────── 交易记录 ─────────────────────── */

function OrdersPanel({ active, fundCode }: { active: boolean; fundCode?: string }) {
  // fetcher.load 复用 /me/orders 的 loader；内容体在 OrdersContent（与深链页一份真相）
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

  const data = fetcher.data;
  if (!data) {
    return <PanelSkeleton />;
  }
  return <OrdersContent orders={data.orders} fundCode={fundCode} />;
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
