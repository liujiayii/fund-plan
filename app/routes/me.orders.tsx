import type { Route } from "./+types/me.orders";
import { Space, Typography } from "antd";
import { OrdersContent } from "~/components/OrdersContent";
import { NavButton } from "~/components/ui/NavButton";
import { SHARE_SCALE, yuanToCents } from "~/domain/money";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getOrders, getOrdersByFund } from "~/services/portfolio-service";
import { amendOrder, cancelOrder } from "~/services/trade";

const { Title } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的订单 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  // ?fund= 过滤：持仓详情页「交易记录」入口带该参数进来（spec §8）
  const fundCode = new URL(request.url).searchParams.get("fund");
  if (fundCode) {
    const orders = await getOrdersByFund(db, user.id, fundCode, 200);
    // 过滤指示要显示基金名；where 回调风格与 me.dca.tsx 的 action 一致（不引 drizzle 帮手）
    const f = await db.query.fund.findFirst({
      where: (f, { eq }) => eq(f.code, fundCode),
    });
    return {
      orders,
      fundFilter: { code: fundCode, name: f?.name ?? fundCode },
    };
  }

  const orders = await getOrders(db, user.id, 200);
  return { orders, fundFilter: null };
}

/**
 * 撤单 / 改单的统一入口。持仓详情页的订单列表也 post 到这里
 * （订单按 id 寻址，与所在页面无关），返回约定与面板下单一致：
 * { ok, message } 或 { error }。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const orderId = Number(fd.get("orderId"));

  try {
    if (intent === "cancel") {
      await cancelOrder(db, user.id, orderId);
      return { ok: true, message: "已撤销，冻结资金/占用份额即时释放" };
    }

    if (intent === "amend") {
      if (fd.get("amount") !== null) {
        const amount = String(fd.get("amount"));
        const n = Number(amount);
        if (!Number.isFinite(n) || n <= 0)
          return { error: "请输入正确的金额" };
        await amendOrder(db, user.id, orderId, {
          amountCents: yuanToCents(amount),
        });
        return { ok: true, message: "改单成功，差额已调整" };
      }
      if (fd.get("shares") !== null) {
        const shares = String(fd.get("shares"));
        const n = Number(shares);
        if (!Number.isFinite(n) || n <= 0)
          return { error: "请输入正确的份额" };
        await amendOrder(db, user.id, orderId, {
          sharesScaled: Math.round(n * SHARE_SCALE),
        });
        return { ok: true, message: "改单成功" };
      }
      return { error: "缺少改单参数" };
    }

    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

/**
 * 我的订单页（深链 /me/orders、/me/orders?fund=）。
 *
 * 页面本体只剩标题与返回入口——内容体全在共享组件 OrdersContent 里，
 * 与 /me、持仓详情页的「交易记录」tab（MeTabsPanels.OrdersPanel 懒加载
 * 本路由 loader）一份真相。撤单/改单走 OrderActions（提交到本 action）。
 */
export default function MeOrders({ loaderData }: Route.ComponentProps) {
  const { orders, fundFilter } = loaderData;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的订单
      </Title>

      {/* 来自 ?fund= 深链时旁挂返回入口；过滤口径由 URL 与列表内容自明 */}
      {fundFilter && (
        <NavButton size="small" to={`/me/holdings/${fundFilter.code}`}>
          ← 返回持仓详情
        </NavButton>
      )}

      <OrdersContent orders={orders} fundCode={fundFilter?.code} />
    </Space>
  );
}
