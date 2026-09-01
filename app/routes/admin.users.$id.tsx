import type { Route } from "./+types/admin.users.$id";
import { Button, Space, Tag, Typography } from "antd";
import { OrderList } from "~/components/OrderList";
import { HoldingListReadonly, PortfolioSummary } from "~/components/PortfolioView";
import { SectionCard } from "~/components/ui/SectionCard";
import { toBeijing } from "~/domain/trading-calendar";
import { getUserDetail } from "~/services/admin-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "用户详情 · 管理后台 · 模拟基金" }];
}

/** admin 看某个用户的盘：只读。渲染复用 /master 那套（PortfolioSummary + 只读列表） */
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

  return { detail };
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
          {user.role === "admin" && <Tag color="blue" style={{ marginLeft: 8 }}>主理人</Tag>}
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
      <Button href="/admin">← 返回用户列表</Button>

      <SectionCard>
        <PortfolioSummary portfolio={portfolio} />
      </SectionCard>

      <SectionCard title={`持仓（${portfolio.holdings.length}）`}>
        <HoldingListReadonly holdings={portfolio.holdings} />
      </SectionCard>

      <SectionCard title={`订单（最近 ${orders.length} 条）`}>
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
