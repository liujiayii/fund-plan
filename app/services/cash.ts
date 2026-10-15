import type { Db } from "~/db/client";
import { sql } from "drizzle-orm";
import { account } from "~/db/schema";

/**
 * 现金账本原子调整原语。
 *
 * ## 为什么存在（2026-10-14 定投重复派发事故 + PR #110 评审修正）
 *
 * 事故：所有现金写点都是「findFirst 读 cash → JS 里加减 → 无条件写回绝对值」
 * 的跨 await 读-改-写。CF cron 的 at-least-once 重复派发让两个定投扫描相隔
 * 5 秒重叠执行，两笔并发扣款各自基于同一份过期余额计算，后提交者把前者的
 * 扣减整体覆盖——account.cash 与流水链合计永久偏差 2 万元。
 *
 * 第一版修复用「相对量 UPDATE 判赢 + 流水随后插入」两步，被 CodeRabbit
 * 评审指正两个残余问题：
 * 1. **交错失真**：两步之间可以插进别的现金更新，流水 id 序与现金更新序
 *    脱节，重放前向填充会把旧余额当最新现金（链尾 ≠ 真值）；
 * 2. **冲正破账**：改单竞态冲正只插冲正流水、不插原始差额流水，
 *    Σ流水与 cash 净变化不等，对账恒等式被破坏。
 *
 * ## 最终形态：一个 D1 batch（= 一个事务，不可交错）
 *
 *   UPDATE account SET cash = cash + Δ WHERE <守卫>;
 *   INSERT INTO transactions (...) SELECT ..., (SELECT cash ...), ...
 *     WHERE (SELECT changes()) = 1;
 *
 * - 相对量更新在单条语句内完成读改写，SQLite 单写者下无丢失更新窗口；
 * - `changes()` 把「守卫是否命中」传给同事务的下一条语句：守卫 0 行时
 *   流水绝不写入（batch 内的 INSERT 无法用 drizzle 条件化，这是走原生
 *   batch 的唯一理由）；
 * - 流水 balance 用同事务子查询读「本批 UPDATE 写后的真值」，永不脱节。
 *
 * ## 消费纪律
 *
 * **任何碰 account.cash 的新代码必须走 commitCashMove**（与流水同批的
 * 混合写入如卖单确认/签到，用 drizzle batch + `cashDelta`/`cashNow` 组合，
 * 同样满足单事务原子）。禁止再写「读 cash → 算 → 写回绝对值」。
 *
 * 残余风险（有意接受）：判赢成功后、调用方后续动作（如翻转订单）之前的
 * 崩溃窗口，方向是平台不亏；对账恒等式
 * `account.cash === Σ transactions.amount` 有测试与运维 SQL 把守
 * （tests/services/cash-race.test.ts 与 docs/development.md）。
 */

/** 现金相对量片段：正数入账、负数出账，用于 drizzle 批内 `.set({ cash: ... })` */
export function cashDelta(deltaCents: number) {
  return sql`cash + ${deltaCents}`;
}

/**
 * 同事务内的当前现金余额（子查询），用于 drizzle 批内流水 balance 快照。
 * 在 db.batch 里必须排在现金 UPDATE 之后，读到的是本批写完的真值；
 * offsetCents 用于「中间态快照」（如卖单确认的「总额到账、费用未扣」行）。
 */
export function cashNow(userId: number, offsetCents = 0) {
  const sub = sql`(SELECT ${account.cash} FROM ${account} WHERE ${account.userId} = ${userId})`;
  return offsetCents === 0 ? sub : sql`${sub} + ${offsetCents}`;
}

/**
 * 取 drizzle 实例背后的 D1Database。原生 batch（changes() 条件语句）必须
 * 用它；drizzle 0.45 把 client 存在 db.session.client（.d.ts 未声明，
 * 运行时存在），版本已锁在 package.json，升级 drizzle 时这里要复查。
 */
function getD1(db: Db): D1Database {
  const client = (db as unknown as { session?: { client?: D1Database } }).session?.client;
  if (!client) {
    throw new Error("无法从 drizzle 实例取到底层 D1Database（drizzle 内部结构变化？）");
  }
  return client;
}

/** 原子现金动作携带的流水内容（amount 恒等于 deltaCents） */
export interface CashMoveTx {
  type: "buy" | "sell" | "fee" | "cancel" | "amend" | "checkin" | "init";
  /** 流水金额（分）：正=入账，负=出账，恒等于 deltaCents */
  amount: number;
  orderId?: number | null;
  note: string;
  createdAt: number;
}

export interface CashMoveOptions {
  /** 出账防透支守卫：要求 cash + delta >= minBalance（出账传 0） */
  minBalance?: number;
  /** 退款守卫：必须存在该订单的冻结流水（type='buy' 且 amount<0） */
  requireFreezeFor?: number;
  /** 订单守卫：必须存在该订单且仍为 pending；带 amount 时追加金额乐观锁 */
  requirePendingOrder?: { orderId: number; amount?: number };
}

/**
 * 原子现金动作：守卫相对量更新 + 条件流水，一个 D1 batch（单事务）提交。
 *
 * @returns ok=false 表示守卫未命中（现金不足 / 冻结缺失 / 订单已翻转），
 *          分文未动、流水未写；调用方按业务语义处理（删孤儿订单 / 报错等）
 */
export async function commitCashMove(
  db: Db,
  userId: number,
  deltaCents: number,
  opts: CashMoveOptions,
  tx: CashMoveTx,
): Promise<{ ok: boolean }> {
  const d1 = getD1(db);

  // 守卫拼接：全部走参数绑定，cond 顺序与 updParams 严格对应
  const conds: string[] = ["user_id = ?"];
  const updParams: (number | null)[] = [deltaCents, userId];
  if (opts.minBalance !== undefined) {
    conds.push("cash + ? >= ?");
    updParams.push(deltaCents, opts.minBalance);
  }
  if (opts.requireFreezeFor !== undefined) {
    conds.push("EXISTS (SELECT 1 FROM transactions WHERE order_id = ? AND type = 'buy' AND amount < 0)");
    updParams.push(opts.requireFreezeFor);
  }
  if (opts.requirePendingOrder) {
    const { orderId, amount } = opts.requirePendingOrder;
    conds.push(
      amount !== undefined
        ? "EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending' AND amount = ?)"
        : "EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')",
    );
    updParams.push(orderId);
    if (amount !== undefined)
      updParams.push(amount);
  }

  const updateStmt = d1
    .prepare(`UPDATE account SET cash = cash + ? WHERE ${conds.join(" AND ")}`)
    // updParams[0] 就是 SET 子句的 delta，别再重复绑一次
    .bind(...updParams);

  // changes() 读的是同事务上一条语句（守卫 UPDATE）的影响行数：
  // 1 = 守卫命中，流水落库且 balance 为写后真值；0 = 分文不动、流水不写。
  // 注意占位符全部用顺序 ?（miniflare 的本地 D1 shim 对 batch 中的 ?N
  // 编号参数支持不全，实测报 Wrong number of parameter bindings）
  const insertStmt = d1
    .prepare(
      `INSERT INTO transactions (user_id, type, amount, balance, order_id, note, created_at)
       SELECT ?, ?, ?, (SELECT cash FROM account WHERE user_id = ?), ?, ?, ?
       WHERE (SELECT changes()) = 1`,
    )
    .bind(userId, tx.type, tx.amount, userId, tx.orderId ?? null, tx.note, tx.createdAt);

  console.log("[probe] updSql =", `UPDATE account SET cash = cash + ? WHERE ${conds.join(" AND ")}`);
  const results = await d1.batch([updateStmt, insertStmt]);
  const meta = (results[0] as { meta?: { changes?: number } }).meta;
  return { ok: meta?.changes === 1 };
}
