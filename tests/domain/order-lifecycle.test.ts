import type { AmendableOrder } from "~/domain/order-lifecycle";
import { describe, expect, it } from "vitest";
import {

  planAmendBuy,
  planAmendSell,
  planCancel,
} from "~/domain/order-lifecycle";

/**
 * 撤单 / 改单的领域规则。
 *
 * 这层只管「能不能撤/改、改完账怎么变」的纯校验与推导：
 *  - 撤单：只有 pending 可撤；买单要退冻结现金，赎回单不动钱
 *  - 改单（原单直改）：买单改金额按差额多补少退，卖单改份额校验可赎额度
 * D1 的落库与竞态守卫在 service 层（trade.ts）。
 */

/** 造一笔订单的快捷工厂（字段含义见 schema.ts orders 表） */
function order(partial: Partial<AmendableOrder>): AmendableOrder {
  return {
    id: 1,
    userId: 1,
    fundCode: "007751",
    side: "buy",
    status: "pending",
    amount: 100000, // 1000 元
    shares: null,
    ...partial,
  };
}

describe("planCancel 撤单", () => {
  it("撤待确认买单：退款额 = 委托金额", () => {
    expect(planCancel(order({ side: "buy", amount: 97300 }))).toEqual({
      refundCents: 97300,
    });
  });

  it("撤待确认赎回单：不动钱，退款额为 0", () => {
    expect(
      planCancel(order({ side: "sell", amount: null, shares: 5_000_000 })),
    ).toEqual({ refundCents: 0 });
  });

  it("已确认的订单不能撤", () => {
    expect(() => planCancel(order({ status: "confirmed" }))).toThrow(
      "只有待确认的订单才能撤销",
    );
  });

  it("已失败的订单不能撤", () => {
    expect(() => planCancel(order({ status: "failed" }))).toThrow(
      "只有待确认的订单才能撤销",
    );
  });

  it("已撤销的订单不能重复撤", () => {
    expect(() => planCancel(order({ status: "cancelled" }))).toThrow(
      "只有待确认的订单才能撤销",
    );
  });
});

describe("planAmendBuy 改申购金额", () => {
  const ctx = { cashCents: 50000, minPurchaseCents: 1000 };

  it("加仓差额：新金额更大时补扣现金", () => {
    const r = planAmendBuy(order({ amount: 97300 }), 100000, ctx);
    expect(r.deltaCents).toBe(2700);
    expect(r.newCashCents).toBe(47300);
  });

  it("减仓差额：新金额更小时退回现金", () => {
    const r = planAmendBuy(order({ amount: 97300 }), 93600, ctx);
    expect(r.deltaCents).toBe(-3700);
    expect(r.newCashCents).toBe(53700);
  });

  it("加仓差额超过可用现金：拒绝", () => {
    expect(() =>
      planAmendBuy(order({ amount: 97300 }), 200000, ctx),
    ).toThrow("现金不足");
  });

  it("新金额低于起购金额：拒绝", () => {
    expect(() =>
      planAmendBuy(order({ amount: 97300 }), 500, ctx),
    ).toThrow("低于起购金额");
  });

  it("新金额与原单相同：拒绝（改单要有意义）", () => {
    expect(() => planAmendBuy(order({ amount: 97300 }), 97300, ctx)).toThrow(
      "新金额与原单相同",
    );
  });

  it("非正整数金额：拒绝", () => {
    expect(() => planAmendBuy(order({ amount: 97300 }), 0, ctx)).toThrow(
      "申购金额必须为正整数",
    );
    expect(() =>
      planAmendBuy(order({ amount: 97300 }), 100.5, ctx),
    ).toThrow("申购金额必须为正整数");
  });

  it("赎回单不能改金额", () => {
    expect(() =>
      planAmendBuy(order({ side: "sell", amount: null, shares: 1 }), 100000, ctx),
    ).toThrow("只有申购单才能改金额");
  });

  it("非待确认的订单不能改", () => {
    expect(() =>
      planAmendBuy(order({ status: "confirmed" }), 100000, ctx),
    ).toThrow("只有待确认的订单才能修改");
  });
});

describe("planAmendSell 改赎回份额", () => {
  it("新份额在可赎额度内：通过", () => {
    const r = planAmendSell(
      order({ side: "sell", amount: null, shares: 4_000_000 }),
      8_000_000,
      { availableSharesScaled: 10_000_000 },
    );
    expect(r.newSharesScaled).toBe(8_000_000);
  });

  it("可赎额度要按「扣除本单原份额后的其他占用」理解：改单是替换不是追加", () => {
    // 持有 1000 份，本单原委托 400 份，另有其他挂单占 300 份
    // → 可改上限 = 1000 - 300 = 700 份
    expect(() =>
      planAmendSell(
        order({ side: "sell", amount: null, shares: 4_000_000 }),
        7_500_000,
        { availableSharesScaled: 7_000_000 },
      ),
    ).toThrow("份额不足");
  });

  it("非正整数份额：拒绝", () => {
    expect(() =>
      planAmendSell(order({ side: "sell", amount: null, shares: 4_000_000 }), 0, {
        availableSharesScaled: 10_000_000,
      }),
    ).toThrow("赎回份额必须为正整数");
  });

  it("新份额与原单相同：拒绝", () => {
    expect(() =>
      planAmendSell(
        order({ side: "sell", amount: null, shares: 4_000_000 }),
        4_000_000,
        { availableSharesScaled: 10_000_000 },
      ),
    ).toThrow("新份额与原单相同");
  });

  it("申购单不能改份额", () => {
    expect(() =>
      planAmendSell(order({ side: "buy", amount: 1000, shares: null }), 1, {
        availableSharesScaled: 10_000_000,
      }),
    ).toThrow("只有赎回单才能改份额");
  });

  it("非待确认的订单不能改", () => {
    expect(() =>
      planAmendSell(
        order({ side: "sell", amount: null, shares: 4_000_000, status: "confirmed" }),
        5_000_000,
        { availableSharesScaled: 10_000_000 },
      ),
    ).toThrow("只有待确认的订单才能修改");
  });
});
