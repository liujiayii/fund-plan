import type { Route } from "./+types/me.orders";
import { Alert, Pagination, Space, Typography } from "antd";
import { useState } from "react";
import { OrderActions } from "~/components/OrderActions";
import { OrderTimeline } from "~/components/OrderTimeline";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { SHARE_SCALE, yuanToCents } from "~/domain/money";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getOrders } from "~/services/portfolio-service";
import { amendOrder, cancelOrder } from "~/services/trade";

const { Title, Text, Paragraph } = Typography;

/**
 * 每页条数。沿用被卡片列表取代的那张旧 Table 的 `pageSize: 20`，
 * 翻页手感与改版前一致 —— loader 一次取 200 条，全铺在一页上是 200 张卡片。
 */
const PAGE_SIZE = 20;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的订单 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const orders = await getOrders(db, user.id, 200);
  return { orders };
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

export default function MeOrders({ loaderData }: Route.ComponentProps) {
  const { orders } = loaderData;
  const pendingCount = orders.filter(o => o.status === "pending").length;
  // 客户端分页：loader 已经把 200 条全取回来了，翻页不用再请求服务端
  const [page, setPage] = useState(1);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的订单
      </Title>

      {pendingCount > 0 && (
        <Alert
          type="info"
          showIcon
          message={`有 ${pendingCount} 笔订单待确认`}
          description="真实基金是 T+1 成交：交易日 15:00 前下单按当日净值，之后顺延至下一交易日。系统每晚 20:30 拉取当日净值并撮合。"
        />
      )}

      <SectionCard title={`全部订单（${orders.length} 笔）`}>
        {orders.length === 0
          ? (
              <EmptyState description="还没有交易记录" />
            )
          : (
              <>
                <OrderTimeline
                  orders={orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
                  // 待确认行内挂撤单/改单（OrderActions 自行判断 pending 才渲染）
                  renderActions={o => <OrderActions order={o} />}
                />
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
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          申购采用真实的
          <Text strong>内扣法</Text>
          ：手续费从申购金额中扣除，
          剩余净额除以确认日净值得到份额。赎回按
          <Text strong>先进先出</Text>
          逐批计费。
        </Paragraph>
      </SectionCard>
    </Space>
  );
}
