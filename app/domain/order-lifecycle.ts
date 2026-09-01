/**
 * 撤单 / 改单的领域规则（纯函数，不碰 D1）。
 *
 * 只回答两件事：
 *  1. 这笔单**能不能**撤/改（状态机与额度校验）
 *  2. 改完**账怎么变**（买单按差额多补少退现金）
 *
 * 落库的原子性与「和撮合 cron 抢订单」的竞态守卫在 service 层
 * （trade.ts 的 cancelOrder / amendOrder），这层不做 IO。
 */
import { centsToYuan, sharesToDisplay } from "~/domain/money";

/** 撤改单视角下的订单（字段含义见 schema.ts orders 表） */
export interface AmendableOrder {
  id: number;
  userId: number;
  fundCode: string;
  side: "buy" | "sell";
  /** pending | confirmed | failed | cancelled */
  status: "pending" | "confirmed" | "failed" | "cancelled";
  /** 申购金额（分）；赎回单为 null */
  amount: number | null;
  /** 赎回份额 ×10000；申购单为 null */
  shares: number | null;
}

/** 断言订单处于可撤/可改的 pending 态，否则抛错 */
function assertPending(order: AmendableOrder, verb: string): void {
  if (order.status !== "pending") {
    throw new Error(`只有待确认的订单才能${verb}`);
  }
}

/**
 * 撤单计划。
 * 买单退回冻结的委托金额；赎回单不动钱（份额占用随状态变化自动释放）。
 */
export function planCancel(order: AmendableOrder): { refundCents: number } {
  assertPending(order, "撤销");
  return { refundCents: order.side === "buy" ? (order.amount ?? 0) : 0 };
}

/**
 * 改申购金额（原单直改）。
 * 按差额调整现金：新金额更大补扣（须够现金），更小则退回差额。
 * 新金额同样要过起购额校验——改单不豁免下单规则。
 */
export function planAmendBuy(
  order: AmendableOrder,
  newAmountCents: number,
  ctx: { cashCents: number; minPurchaseCents: number },
): { deltaCents: number; newCashCents: number } {
  assertPending(order, "修改");
  if (order.side !== "buy") {
    throw new Error("只有申购单才能改金额");
  }
  if (!Number.isInteger(newAmountCents) || newAmountCents <= 0) {
    throw new Error("申购金额必须为正整数（分）");
  }
  if (newAmountCents < ctx.minPurchaseCents) {
    throw new Error(`低于起购金额：该基金 ${centsToYuan(ctx.minPurchaseCents)} 元起购`);
  }
  const oldAmount = order.amount ?? 0;
  if (newAmountCents === oldAmount) {
    throw new Error("新金额与原单相同，无需修改");
  }
  const deltaCents = newAmountCents - oldAmount;
  const newCashCents = ctx.cashCents - deltaCents;
  if (newCashCents < 0) {
    throw new Error(
      `现金不足：可用 ${centsToYuan(ctx.cashCents)} 元，还需补扣 ${centsToYuan(deltaCents)} 元`,
    );
  }
  return { deltaCents, newCashCents };
}

/**
 * 改赎回份额（原单直改）。不动钱——到账金额在撮合时才算得出。
 * 可赎额度由调用方算好传入：持有份额 − 其他挂单占用（不含本单原份额，
 * 因为改单是**替换**本单委托而非追加）。
 */
export function planAmendSell(
  order: AmendableOrder,
  newSharesScaled: number,
  ctx: { availableSharesScaled: number },
): { newSharesScaled: number } {
  assertPending(order, "修改");
  if (order.side !== "sell") {
    throw new Error("只有赎回单才能改份额");
  }
  if (!Number.isInteger(newSharesScaled) || newSharesScaled <= 0) {
    throw new Error("赎回份额必须为正整数");
  }
  if (newSharesScaled === order.shares) {
    throw new Error("新份额与原单相同，无需修改");
  }
  if (newSharesScaled > ctx.availableSharesScaled) {
    throw new Error(
      `份额不足：可改上限 ${sharesToDisplay(ctx.availableSharesScaled)} 份`,
    );
  }
  return { newSharesScaled };
}
