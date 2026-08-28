import type { Route } from "./+types/me.watchlist";
import { Alert, Button, Dropdown, Space, Typography } from "antd";
import { useFetcher } from "react-router";
import { EmptyState } from "~/components/ui/EmptyState";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { navToDisplay } from "~/domain/money";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { listWatch } from "~/services/watchlist-service";
import { COLOR } from "~/theme";

const { Title } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的自选 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const items = await listWatch(db, user.id);
  return { items };
}

/** 加自选/取消自选 action（详情页的加自选也 post 到这里） */
export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const fundCode = String(fd.get("fundCode") ?? "").trim();

  // 6 位数字基金代码校验，不通过直接回错误（不抛异常，走业务返回路径）
  if (!/^\d{6}$/.test(fundCode))
    return { error: "请输入 6 位基金代码" };

  try {
    if (intent === "add") {
      // 动态 import：loader 只需 listWatch，action 这里才用到 addWatch/removeWatch，
      // 按需加载保持路由模块轻量
      await (await import("~/services/watchlist-service")).addWatch(db, env, user.id, fundCode);
      return { ok: true, message: "已加入自选" };
    }
    if (intent === "remove") {
      await (await import("~/services/watchlist-service")).removeWatch(db, user.id, fundCode);
      return { ok: true, message: "已取消自选" };
    }
    return { error: "未知操作" };
  }
  catch (err) {
    // addWatch 在基金不存在时会抛「没找到基金 xxx」，这里原样回给前端展示
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

export default function MeWatchlist({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  // useFetcher<typeof action>：拿到 action 的返回类型，fetcher.data 才有 ok/error 的窄化
  const fetcher = useFetcher<typeof action>();

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        我的自选
      </Title>

      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} closable />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} closable />
      )}

      {items.length === 0
        ? (
            <EmptyState description="还没有自选基金">
              <Button type="primary" href="/funds">
                去发现页挑一只
              </Button>
            </EmptyState>
          )
        : (
            <div>
              {items.map((it, i) => (
                <FundListItem
                  key={it.fundCode}
                  fundCode={it.fundCode}
                  fundName={it.fundName}
                  fundType={it.fundType || undefined}
                  last={i === items.length - 1}
                  note={it.navDate ? `净值 ${navToDisplay(it.unitNav ?? 0)}（${it.navDate}）` : "暂无净值"}
                  primary={(
                    <span style={{ color: COLOR.textPrimary }}>
                      {it.unitNav !== null ? navToDisplay(it.unitNav) : "—"}
                    </span>
                  )}
                  secondary={<PnlText rate={it.growthRate / 10000} size={12} />}
                  actions={(
                    /* 混合形态（Task 10）：「查看」保链接语义留在行内（高频操作，
                       href 直达基金详情）；「取消自选」收进「···」Dropdown——
                       原两按钮约 112px，375px 下挤兑左侧名称列，收进后 actions
                       区约 76px（链接按钮 40 + Dropdown 28 + gap 8）放得下。
                       ⚠️ 各行 actions 宽度一致（FundListItem 契约）：
                       本列表所有行渲染同一结构，天然满足 */
                    <Space size={8}>
                      <Button size="small" href={`/funds/${it.fundCode}`}>
                        查看
                      </Button>
                      <Dropdown
                        menu={{
                          items: [
                            { key: "remove", label: "取消自选", danger: true },
                          ],
                          onClick: ({ key }) => {
                            if (key === "remove") {
                              fetcher.submit(
                                { intent: "remove", fundCode: it.fundCode },
                                { method: "post" },
                              );
                            }
                          },
                        }}
                      >
                        <Button size="small">···</Button>
                      </Dropdown>
                    </Space>
                  )}
                />
              ))}
            </div>
          )}
    </Space>
  );
}
