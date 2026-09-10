import type { Route } from "./+types/admin_.users.$id";
import { Space, Tag, Typography } from "antd";
import { AssetOverviewCard } from "~/components/AssetOverviewCard";
import { AssetTrendChart } from "~/components/AssetTrendChart";
import { OrderList } from "~/components/OrderList";
import { HoldingListReadonly } from "~/components/PortfolioView";
import { ProfitCalendarCard } from "~/components/ProfitCalendarCard";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { toBeijing } from "~/domain/trading-calendar";
import { getUserDetail } from "~/services/admin-service";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "用户详情 · 管理后台 · 模拟基金" }];
}
/**
 * admin 看某个用户的盘：只读。总览/走势/日历已换 /me 同款布局（ux-polish #11），
 * 持仓与订单仍是只读列表；只读铁律不变——全页没有任何操作按钮。
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
  const detail = Number.isInteger(id) && id > 0
    ? await getUserDetail(db, id)
    : null;
  if (!detail) {
    throw new Response("用户不存在", { status: 404 });
  }

  // 收益三件套（走势+日历+明细）的序列数据；查询数 3+N+1，单用户页面远低于 D1 硬顶
  const profit = await getProfitDetail(db, id);

  return { detail, profit };
}

export default function AdminUserDetail({ loaderData }: Route.ComponentProps) {
  const { detail } = loaderData;
  const { user, portfolio, orders } = detail;

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

      {/* 总览与收益三件套：与 /me 同款布局（ux-polish #11）。
          只读铁律不变——没有任何操作按钮。
          animate-fade-up：区块进场淡入（首卡无延迟），第 N 卡延迟 (N-1)×60ms
          （animate-delay 写法的坑见 uno.config.ts 注释） */}
      <SectionCard className="animate-fade-up">
        <AssetOverviewCard
          summary={portfolio.summary}
          daily={loaderData.profit.daily}
          latest={loaderData.profit.latest}
          totalDepositedCents={loaderData.profit.totalDepositedCents}
        />
      </SectionCard>

      {/* 走势与日历仅 daily 非空时渲染：该用户从没交易过就不摆空图（/master 同款守卫）。
          走势卡不再叠 AssetPnlSummary 两格（2026-09-09 删）：与顶部总览
          四小格的昨日/累计收益重复，曲线末点 + tooltip 全覆盖 */}
      {loaderData.profit.daily.length > 0 && (
        <>
          <SectionCard title="资产走势" className="animate-fade-up animate-delay-[60ms]">
            <AssetTrendChart data={loaderData.profit.daily} />
          </SectionCard>
          <SectionCard title="收益日历" className="animate-fade-up animate-delay-[120ms]">
            <ProfitCalendarCard detail={loaderData.profit} />
          </SectionCard>
        </>
      )}

      <SectionCard title={`持仓（${portfolio.holdings.length} 只）`} className="animate-fade-up animate-delay-[180ms]">
        <HoldingListReadonly holdings={portfolio.holdings} />
      </SectionCard>

      <SectionCard title={`订单（最近 ${orders.length} 条）`} className="animate-fade-up animate-delay-[240ms]">
        {/* detailed 模式：成交净值/份额/手续费全展开，failed 的原因在
            OrderList 的 failReason Tooltip 里——排查「为什么没成交」就靠它。
            renderActions 刻意不传：admin 只读，绝不出现撤单/改单按钮 */}
        {orders.length === 0
          ? <Paragraph type="secondary" style={{ marginBottom: 0 }}>无订单</Paragraph>
          : <OrderList orders={orders} detailed />}
      </SectionCard>
    </Space>
  );
}
