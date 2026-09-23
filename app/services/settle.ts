import type { Db } from "~/db/client";
import type { OrderRow } from "~/db/schema";
import type { RedeemTier } from "~/domain/redeem";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { runBatch } from "~/db/client";
import {
  account,
  fund,
  fundNav,
  holding,

  orders,
  shareLot,
  transactions,
} from "~/db/schema";
import { calcPurchase } from "~/domain/purchase";
import { calcRedeem, DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { toBeijing } from "~/domain/trading-calendar";
import { fetchNavHistory, NAV_FETCH_TIMEOUT_BACKGROUND_MS } from "./fund-data";

/**
 * 撮合引擎：净值同步 + T+1 确认。
 *
 * ## 两段式原子仲裁（the two-phase arbiter）
 *
 * 单笔订单的确认不是一个大 `db.batch()`，而是两段：
 *
 * 1. **第一段·原子裁判**：带守卫的 `UPDATE orders ... WHERE status='pending'
 *    AND amount/shares=读到时的旧值` + `.returning()`。守卫同时防三类竞争——
 *    撤单（status 已翻 cancelled）、改单（amount/shares 已变）、并发撮合
 *    （status 已翻 confirmed）。读到 0 行说明有人抢先，本次整体让路，
 *    分文不动；订单保持 pending，下一轮 cron 按最新值重试。
 * 2. **第二段·资金与份额写入**：赢得裁判后才在 `db.batch()` 里写
 *    share_lot / holding / account / transactions。
 *
 * ## 已知且有意接受的崩溃窗口
 *
 * 第一段翻转成功与第二段 batch 落库之间若 Worker 崩溃，会留下
 * 「已 confirmed 但没记份额」或「已 cancelled 但没退款」的中间态。
 * 这是有意的方向性取舍：宁可用户受损（可人工补录退款），绝不让系统
 * 双花（多记份额 / 重复退款）。两个方向都只损坏单边账，可修复。
 *
 * ## 铁律
 *
 * - 幂等：Cron 会重试，同一订单撮合两次就是重复成交——守卫翻转天然挡住。
 * - 拉不到净值时订单**保持 pending 顺延**，绝不判失败；网络抖动不该让
 *   用户的单子凭空消失。
 */

export interface SettleResult {
  /** 成功确认的订单数 */
  confirmed: number;
  /** 因缺净值而顺延的订单数 */
  skipped: number;
  /** 因业务原因失败的订单数 */
  failed: number;
}

/**
 * 一轮净值同步的总预算。
 *
 * cron 的墙钟硬顶是 **15 分钟**（官方 limits），同一次 invocation 里还要跑
 * 撮合与清理会话。超预算就收手，剩余基金留给 21:30 那轮幂等重跑——
 * 宁可让几只基金顺延，也别让整次 invocation 被砍、连撮合都跑不成。
 */
export const NAV_SYNC_BUDGET_MS = 8 * 60 * 1000;

/** syncNav 的结果：synced 是行数，funds/attempted/empty 是基金数（供判定「整轮是否全灭」） */
export interface SyncNavResult {
  /** 实际写入的净值行数 */
  synced: number;
  /** 本轮清单里的基金数 */
  funds: number;
  /** 真正尝试过（进入循环）的基金数；超预算提前收手时 < funds */
  attempted: number;
  /** 尝试过的基金里，一条净值都没拉到的只数 */
  empty: number;
}

/**
 * 同步基金净值到 fund_nav 表。
 * @param db Drizzle 实例
 * @param env Worker 环境（取 KV 与网络）
 * @param fundCodes 指定基金；不传则同步所有「有持仓或有待确认订单」的基金
 * @param budgetMs 总时间预算，超出即收手（测试可注入 0 来验证短路）
 */
export async function syncNav(
  db: Db,
  env: Env,
  fundCodes?: string[],
  budgetMs = NAV_SYNC_BUDGET_MS,
): Promise<SyncNavResult> {
  let codes = fundCodes;

  if (!codes) {
    // 只同步真正用得上的基金，省接口调用与 D1 写次数
    const fromOrders = await db
      .selectDistinct({ code: orders.fundCode })
      .from(orders)
      .where(eq(orders.status, "pending"));
    const fromHoldings = await db
      .selectDistinct({ code: holding.fundCode })
      .from(holding);
    codes = [
      ...new Set([
        ...fromOrders.map(r => r.code),
        ...fromHoldings.map(r => r.code),
      ]),
    ];
  }

  let synced = 0;
  let empty = 0;
  let attempted = 0;
  const startedAt = Date.now();
  for (const code of codes) {
    // 超预算就收手：剩余基金留给 21:30 那轮幂等重跑，别把 15 分钟墙钟耗光
    // （用 >= 而非 >：预算给 0 时也要立刻收手，便于测试与「禁用同步」的语义）
    if (Date.now() - startedAt >= budgetMs) {
      console.warn(
        `[settle] 净值同步超出 ${Math.round(budgetMs / 1000)}s 预算，本轮中止（剩余基金留给下一次触发）`,
      );
      break;
    }
    attempted++;
    // 用「没人等」档的超时：跨境 lsjz 单页实测 7~8s，正贴着默认的 8s 线，
    // 一页被掐断就是今晚订单整晚顺延。cron 没有用户在等，给足余量
    const rows = await fetchNavHistory(env, code, 30, NAV_FETCH_TIMEOUT_BACKGROUND_MS);
    if (rows.length === 0) {
      empty++;
      console.warn(`[settle] 基金 ${code} 净值拉取为空，跳过`);
      continue;
    }
    // 逐条 upsert：已存在的日期覆盖，避免重复主键报错
    for (const r of rows) {
      await db
        .insert(fundNav)
        .values({
          fundCode: code,
          navDate: r.navDate,
          unitNav: r.unitNav,
          accNav: r.accNav,
          growthRate: r.growthRate,
        })
        .onConflictDoUpdate({
          target: [fundNav.fundCode, fundNav.navDate],
          set: {
            unitNav: r.unitNav,
            accNav: r.accNav,
            growthRate: r.growthRate,
          },
        });
    }
    synced += rows.length;
  }

  // 整轮全灭：订单会整体顺延到次日，而 per-fund 的 warn 埋在细节里看不出后果。
  // 这是**钱路**上的失败（撮合靠它拿当日净值），必须给一条 error 级的汇总信号
  // （2026-09-23 补；跨境链路不稳时真有这种夜晚）。
  // 口径是「尝试过的全拉空」，且带上代码——别把「我们库里代码不对」误诊成
  // 「东财挂了」，也别对原因下断言。
  if (attempted > 0 && empty === attempted) {
    console.error(
      `[settle] 本轮尝试的 ${attempted} 只基金净值全部拉空——今晚订单会全部顺延（基金：${codes.slice(0, attempted).join("、")}）`,
    );
  }

  return { synced, funds: codes.length, attempted, empty };
}

/**
 * 撮合所有到期的待确认订单。
 *
 * @param db Drizzle 实例
 * @param _env Worker 环境（当前未用到，保留以便后续扩展）
 * @param now 当前时刻（测试可注入）
 */
export async function settlePendingOrders(
  db: Db,
  _env: Env,
  now: Date = new Date(),
): Promise<SettleResult> {
  const today = toBeijing(now).format("YYYY-MM-DD");

  // 只捞确认日已到、且仍处于 pending 的订单——这是幂等的关键
  const pending = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, "pending"), lte(orders.confirmDate, today)))
    .orderBy(asc(orders.confirmDate), asc(orders.id));

  const result: SettleResult = { confirmed: 0, skipped: 0, failed: 0 };

  for (const order of pending) {
    try {
      // 取确认日净值；没有就顺延（不改状态）
      const nav = await db.query.fundNav.findFirst({
        where: and(
          eq(fundNav.fundCode, order.fundCode),
          eq(fundNav.navDate, order.confirmDate),
        ),
      });
      if (!nav) {
        result.skipped++;
        continue;
      }

      if (order.side === "buy") {
        const won = await settleBuyOrder(db, order, nav.unitNav, now);
        if (!won) {
          // 撮合读到 pending 之后订单被撤单/改动抢先翻转——跳过，不当成交
          result.skipped++;
          continue;
        }
      }
      else {
        const won = await settleSellOrder(db, order, nav.unitNav, now);
        if (!won) {
          result.skipped++;
          continue;
        }
      }
      result.confirmed++;
    }
    catch (err) {
      console.error(`[settle] 订单 ${order.id} 撮合失败：`, err);
      // 业务性失败：标记 failed 并退还冻结的现金（买单）
      const flipped = await failOrder(
        db,
        order,
        err instanceof Error ? err.message : "撮合失败",
        now,
      );
      if (flipped) {
        result.failed++;
      }
      else {
        // 失败处置让路 = 状态已被抢先翻转。若翻转来自本函数先前的
        // 「确认成功但第二段写份额失败」，订单此刻是 confirmed 却没有
        // share_lot/holding——cron 只捞 pending，不会再自愈，
        // 必须留可检索的结构化日志供对账补录（settle.ts 头注释的已知窗口）
        result.skipped++;
        console.error(
          `[settle] 订单 ${order.id} 失败处置让路（状态已被抢先翻转）。`
          + `若该单此前已确认且份额未落库，需人工补录：`
          + `SELECT * FROM orders WHERE id = ${order.id} AND status = 'confirmed'`
          + ` AND id NOT IN (SELECT order_id FROM share_lot);`,
        );
      }
    }
  }

  return result;
}

/**
 * 确认买单：算份额、建批次、累加持仓。
 * 两段式：先带守卫翻转 confirmed（原子裁判，撤单/改单/并发撮合
 * 抢不过这道 UPDATE），赢了才写批次与持仓——否则可能出现
 * 「已撤单还记份额 + 用户还拿到退款」的双花，或「已改单还按旧金额
 * 成交」凭空创造的份额。
 * @returns false = 订单已被撤单/改单抢先，本次不成交
 * @internal
 */
export async function settleBuyOrder(
  db: Db,
  order: OrderRow,
  navScaled: number,
  now: Date,
): Promise<boolean> {
  if (order.amount === null) {
    throw new Error("买单缺少申购金额");
  }

  const f = await db.query.fund.findFirst({
    where: eq(fund.code, order.fundCode),
  });
  const purchaseRate = f?.purchaseRate ?? 0;

  const calc = calcPurchase({
    amountCents: order.amount,
    navScaled,
    purchaseRate,
  });

  // 该批次成本 = 全部申购金额（含手续费）——这才是用户真金白银的投入
  const lotCost = order.amount;

  // 第一段：原子裁判——只有仍 pending 且金额未变（防撤单/改单/并发撮合）
  // 才能确认并回填成交信息。改单保持 pending 但改 amount，仅查 status
  // 挡不住——必须带金额乐观锁，否则会用过期快照按旧金额成交
  const flipped = await db
    .update(orders)
    .set({
      status: "confirmed",
      dealNav: navScaled,
      dealShares: calc.sharesScaled,
      dealAmount: calc.netAmountCents,
      fee: calc.feeCents,
    })
    .where(
      and(
        eq(orders.id, order.id),
        eq(orders.status, "pending"),
        eq(orders.amount, order.amount),
      ),
    )
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    // 被撤单/改单抢先：整体让路，订单保持 pending，下一轮 cron 按新值撮合
    return false;
  }

  const existing = await db.query.holding.findFirst({
    where: and(
      eq(holding.userId, order.userId),
      eq(holding.fundCode, order.fundCode),
    ),
  });

  // 第二段：批次与持仓（赢得裁判后写入）
  const writes = [
    // 1. 新增份额批次（FIFO 赎回的依据）
    db.insert(shareLot).values({
      userId: order.userId,
      fundCode: order.fundCode,
      shares: calc.sharesScaled,
      cost: lotCost,
      confirmDate: order.confirmDate,
      orderId: order.id,
    }),
    // 2. 维护持仓汇总
    existing
      ? db
          .update(holding)
          .set({
            totalShares: existing.totalShares + calc.sharesScaled,
            totalCost: existing.totalCost + lotCost,
          })
          .where(
            and(
              eq(holding.userId, order.userId),
              eq(holding.fundCode, order.fundCode),
            ),
          )
      : db.insert(holding).values({
          userId: order.userId,
          fundCode: order.fundCode,
          totalShares: calc.sharesScaled,
          totalCost: lotCost,
        }),
  ];

  await runBatch(db, writes);
  void now;
  return true;
}

/**
 * 确认卖单：FIFO 消耗批次、扣费、现金入账。两段式同 settleBuyOrder（见其注释）
 * @internal
 */
export async function settleSellOrder(
  db: Db,
  order: OrderRow,
  navScaled: number,
  now: Date,
): Promise<boolean> {
  if (order.shares === null) {
    throw new Error("卖单缺少赎回份额");
  }

  const f = await db.query.fund.findFirst({
    where: eq(fund.code, order.fundCode),
  });
  const tiers: RedeemTier[]
    = (f?.redeemTiers as RedeemTier[] | undefined) ?? DEFAULT_REDEEM_TIERS;

  // 取该基金的全部批次，按 FIFO 顺序
  const lots = await db
    .select()
    .from(shareLot)
    .where(
      and(
        eq(shareLot.userId, order.userId),
        eq(shareLot.fundCode, order.fundCode),
      ),
    )
    .orderBy(asc(shareLot.confirmDate), asc(shareLot.id));

  const calc = calcRedeem({
    lots: lots.map(l => ({
      id: l.id,
      sharesScaled: l.shares,
      costCents: l.cost,
      confirmDate: l.confirmDate,
    })),
    redeemSharesScaled: order.shares,
    navScaled,
    confirmDate: order.confirmDate,
    tiers,
  });

  const acc = await db.query.account.findFirst({
    where: eq(account.userId, order.userId),
  });
  if (!acc)
    throw new Error("账户不存在");

  const newCash = acc.cash + calc.totalNetCents;
  // 卖出总额（分）= 到账净额 + 赎回费。账本按「总额入账 → 扣费」两笔记，
  // 而不是「净额入账 → 再记一笔负的费用」——后者会让「Σ流水金额」比真实
  // 余额变化多减一次手续费，且两行余额同值，读起来像「扣了钱但余额没变」
  // （TxList 逐行渲染余额，用户看得见）。见下方 sell / fee 两行的注释
  const grossCents = calc.totalNetCents + calc.totalFeeCents;
  const cashAfterGross = acc.cash + grossCents;

  const h = await db.query.holding.findFirst({
    where: and(
      eq(holding.userId, order.userId),
      eq(holding.fundCode, order.fundCode),
    ),
  });
  if (!h)
    throw new Error("持仓不存在");

  // 计算每个批次消耗后的剩余；耗尽的批次删除
  const exhaustedIds: number[] = [];
  const updates: unknown[] = [];
  for (const lr of calc.lotResults) {
    const lot = lots.find(l => l.id === lr.lotId)!;
    const remainShares = lot.shares - lr.consumedSharesScaled;
    const remainCost = lot.cost - lr.costCents;
    if (remainShares <= 0) {
      exhaustedIds.push(lot.id);
    }
    else {
      updates.push(
        db
          .update(shareLot)
          .set({ shares: remainShares, cost: remainCost })
          .where(eq(shareLot.id, lot.id)),
      );
    }
  }

  const ts = now.getTime();

  // 第一段：原子裁判——只有仍 pending 且份额未变（防撤单/改单/并发撮合）
  // 才能确认。改单保持 pending 但改 shares，仅查 status 挡不住——必须带
  // 份额乐观锁，否则会按旧份额消耗批次、减持仓，账目就此错乱
  const flipped = await db
    .update(orders)
    .set({
      status: "confirmed",
      dealNav: navScaled,
      dealShares: order.shares,
      dealAmount: calc.totalNetCents,
      fee: calc.totalFeeCents,
    })
    .where(
      and(
        eq(orders.id, order.id),
        eq(orders.status, "pending"),
        eq(orders.shares, order.shares),
      ),
    )
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    // 被撤单/改单抢先：整体让路，订单保持 pending，下一轮 cron 按新值撮合
    return false;
  }

  const writes: unknown[] = [
    // 1. 批次增减
    ...updates,
    // 3. 持仓递减
    db
      .update(holding)
      .set({
        totalShares: h.totalShares - order.shares,
        totalCost: h.totalCost - calc.totalCostCents,
      })
      .where(
        and(
          eq(holding.userId, order.userId),
          eq(holding.fundCode, order.fundCode),
        ),
      ),
    // 4. 现金入账
    db.update(account).set({ cash: newCash }).where(eq(account.userId, order.userId)),
    // 5. 到账流水。记**卖出总额**（净额 + 费），余额是总额入账后的中间态；
    //    紧接着的第 6 条 fee 流水再把它扣到 newCash。两行相加 = 余额变化，
    //    余额列严格单调递减，逐行读「这笔之后我还剩多少」不会自相矛盾
    db.insert(transactions).values({
      userId: order.userId,
      type: "sell",
      amount: grossCents,
      balance: cashAfterGross,
      orderId: order.id,
      note: `赎回 ${f?.name ?? order.fundCode} 到账`,
      createdAt: ts,
    }),
  ];

  // 6. 手续费单独记一条，便于统计总成本。balance 记**扣费后**的最终余额
  //    （= 上面 sell 行的余额 − 本行费用的绝对值）
  if (calc.totalFeeCents > 0) {
    writes.push(
      db.insert(transactions).values({
        userId: order.userId,
        type: "fee",
        amount: -calc.totalFeeCents,
        balance: newCash,
        orderId: order.id,
        note: `赎回手续费`,
        createdAt: ts,
      }),
    );
  }

  if (exhaustedIds.length > 0) {
    writes.push(db.delete(shareLot).where(inArray(shareLot.id, exhaustedIds)));
  }

  await runBatch(db, writes);
  return true;
}

/**
 * 标记订单失败。买单需退还此前冻结的现金，
 * 否则用户的钱会凭空消失。
 * 带_pending + amount/shares 守卫：订单已被撤单/撮合/改单抢先处理时
 * 整体跳过，不重复退钱。尤其要防改单：改单已按差额调整过现金
 * （改小便已退差额），若这里再按旧 amount 全额退款就是双重退款。
 * @returns 是否赢得失败处置（false = 状态被抢先，调用方需另行告警）
 * @internal
 */
export async function failOrder(
  db: Db,
  order: OrderRow,
  reason: string,
  now: Date,
): Promise<boolean> {
  // 第一段：原子裁判——只有仍 pending 且金额/份额未变才能置 failed。
  // 注意 order.amount 对卖单是 null，而 SQL 的 = null 永远不成立，
  // 所以买单才追加金额守卫；drizzle 的 and() 会忽略 undefined
  const amountGuard
    = order.side === "buy" && order.amount !== null
      ? eq(orders.amount, order.amount)
      : undefined;
  const flipped = await db
    .update(orders)
    .set({ status: "failed", failReason: reason })
    .where(
      and(eq(orders.id, order.id), eq(orders.status, "pending"), amountGuard),
    )
    .returning({ id: orders.id });
  if (flipped.length === 0) {
    return false; // 已被撤单/撮合/改单抢先，不属于本次失败处置
  }

  if (order.side === "buy" && order.amount !== null) {
    const acc = await db.query.account.findFirst({
      where: eq(account.userId, order.userId),
    });
    if (acc) {
      const refunded = acc.cash + order.amount;
      await runBatch(db, [
        db
          .update(account)
          .set({ cash: refunded })
          .where(eq(account.userId, order.userId)),
        db.insert(transactions).values({
          userId: order.userId,
          type: "buy",
          amount: order.amount, // 退款为正
          balance: refunded,
          orderId: order.id,
          note: `申购失败退款：${reason}`,
          createdAt: now.getTime(),
        }),
      ]);
    }
  }

  return true;
}
