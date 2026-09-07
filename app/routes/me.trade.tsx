import type { Route } from "./+types/me.trade";
import { yuanToCents } from "~/domain/money";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { placeBuyOrder } from "~/services/trade";

/**
 * 交易资源路由（action-only，无页面组件）：全站买入的统一入口。
 *
 * 此前买入 action 在三个页面各一份（funds.$code / me.watchlist /
 * me.holdings.$code），逻辑逐字重复，只差 fundCode 来源与成功文案——
 * 收敛到这里后，调用方只需 POST { intent: "buy", fundCode, amount }
 * （BuyPanel 自带这两个隐藏域，action prop 指过来即可）。
 * 卖出/定投是持仓详情页专属语义，暂不归拢（见 spec）。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  // 未登录抛 302 → /login?redirectTo=...（与原 watchlist 行内买入行为一致）
  const user = await requireUser(request, db);
  const fd = await request.formData();

  const intent = String(fd.get("intent") ?? "");
  const fundCode = String(fd.get("fundCode") ?? "").trim();

  try {
    // intent 先行校验：给未来 sell 等交易类型留扩展位
    if (intent !== "buy")
      return { error: "未知操作" };

    // 6 位数字基金代码校验，不通过直接回错误（走业务返回路径，不抛异常）
    if (!/^\d{6}$/.test(fundCode))
      return { error: "请输入 6 位基金代码" };

    const amount = String(fd.get("amount") ?? "");
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0)
      return { error: "请输入正确的金额" };

    await placeBuyOrder(db, env, {
      userId: user.id,
      fundCode,
      amountCents: yuanToCents(amount),
    });
    return { ok: true, message: "下单成功，待 T+1 确认" };
  }
  catch (err) {
    // 起购/现金不足等业务错误由 placeBuyOrder 抛出，原样回给面板展示
    return { error: err instanceof Error ? err.message : "下单失败" };
  }
}
