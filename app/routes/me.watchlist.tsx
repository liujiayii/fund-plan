import type { Route } from "./+types/me.watchlist";
import type { WatchItem } from "~/services/watchlist-service";
import { Alert, Button, Dropdown, Space, Tooltip, Typography } from "antd";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { useFetcher } from "react-router";
import { BuyDrawer } from "~/components/BuyDrawer";
import { EmptyState } from "~/components/ui/EmptyState";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { account } from "~/db/schema";
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
  // 行内买入抽屉要显示可用现金（本页 requireUser 把关，登录用户必有账户）
  const acc = await db.query.account.findFirst({
    where: eq(account.userId, user.id),
  });
  return { items, cash: acc?.cash ?? 0 };
}

/** 行内买入 / 加自选 / 取消自选 action（详情页的加自选也 post 到这里） */
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
    if (intent === "buy") {
      // 行内买入抽屉提交（buyTarget 那只基金）。金额校验与 funds.$code 的
      // 买入 action 同口径；起购/现金不足等业务错误由 placeBuyOrder 抛出，
      // 走下方 catch 回给抽屉内的错误 Alert 展示
      const amount = String(fd.get("amount") ?? "");
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0)
        return { error: "请输入正确的金额" };
      const { yuanToCents } = await import("~/domain/money");
      const { placeBuyOrder } = await import("~/services/trade");
      await placeBuyOrder(db, env, {
        userId: user.id,
        fundCode,
        amountCents: yuanToCents(amount),
      });
      return { ok: true, message: "下单成功，待 T+1 确认" };
    }
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
  const { items, cash } = loaderData;
  // useFetcher<typeof action>：拿到 action 的返回类型，fetcher.data 才有 ok/error 的窄化
  const fetcher = useFetcher<typeof action>();

  // 行内买入：开合（buyOpen）与买入目标（buyTarget）分两个 state——
  // 关闭动画播放期间 buyTarget 保持不变，抽屉退场时仍有数据可画，
  // 不会闪成空壳；面板输入的重置由 BuyDrawer 的 destroyOnHidden 兜底
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyTarget, setBuyTarget] = useState<WatchItem | null>(null);

  const openBuy = (it: WatchItem) => {
    setBuyTarget(it);
    setBuyOpen(true);
  };

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
                    /* 混合形态：「买入」主色按钮直达行内抽屉（本页最高频、也是唯一的
                       花钱动作，值得全行唯一强调）；「取消自选」收进「···」Dropdown。
                       进基金详情页靠点行首基金名（FundListItem 整块可点），原「查看」
                       按钮由此退役——76px 宽度契约不变（FundListItem ⚠️ 各行 actions
                       宽度一致：主色按钮 40 + Dropdown 28 + gap 8，与旧「查看」同尺寸） */
                    <Space size={8}>
                      <Tooltip
                        title={it.unitNav === null ? "暂无净值，暂时无法下单" : undefined}
                      >
                        {/* span 包一层：disabled 按钮不触发鼠标事件，Tooltip 直接套会失效 */}
                        <span>
                          <Button
                            size="small"
                            type="primary"
                            // 无净值禁用：与基金详情页「没有净值时无法下单」口径一致
                            disabled={it.unitNav === null}
                            onClick={() => openBuy(it)}
                          >
                            买入
                          </Button>
                        </span>
                      </Tooltip>
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

      {/* 行内买入抽屉：提交 post 到本页 action 的 buy 分支，成功 toast + 自动关
          （onSuccess 由 BuyDrawer 接管）；现金余额随 loader revalidate 自动刷新。
          buyTarget 为 null 的兜底值只在抽屉关闭时出现（destroyOnHidden 下无渲染） */}
      <BuyDrawer
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        action="/me/watchlist"
        cashCents={cash}
        fundCode={buyTarget?.fundCode ?? ""}
        fundName={buyTarget?.fundName ?? ""}
        purchaseRate={buyTarget?.purchaseRate ?? 0}
        minPurchaseCents={buyTarget?.minPurchase ?? 0}
        navScaled={buyTarget?.unitNav ?? 0}
        navDate={buyTarget?.navDate ?? null}
      />
    </Space>
  );
}
