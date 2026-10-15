import { sql } from "drizzle-orm";
import { account, transactions } from "~/db/schema";

/**
 * 现金账本原子调整的 SQL 原语。
 *
 * ## 为什么存在（2026-10-14 定投重复派发事故）
 *
 * 此前所有现金写点都是「findFirst 读 cash → JS 里加减 → 无条件写回绝对值」。
 * 这是一次跨 await 的读-改-写：CF cron 的 at-least-once 重复派发让两个定投
 * 扫描相隔 5 秒重叠执行，两笔并发扣款各自基于同一份过期余额计算，后提交者
 * 把前者的扣减整体覆盖——account.cash 与流水链合计永久偏差 2 万元，当日收益
 * 凭空多出 2.2 万（含重放侧按 createdAt 取值的偏移）。事故复盘与数据修复
 * 见 docs/development.md「现金账并发丢失更新」。
 *
 * ## 两条铁律
 *
 * 1. **现金只做相对量更新**：`SET cash = cash + Δ`。读改写在单条语句内完成，
 *    SQLite 单写者事务下不存在丢失更新窗口；不透支由 WHERE 守卫
 *    （`cash >= Δ出账` 或 EXISTS 子查询）在语句内原子保证。
 * 2. **流水余额快照不预计算**：用同事务子查询 `(SELECT cash FROM account
 *    WHERE user_id = ?)` 取值——batch 内语句顺序执行，后一条读到前一条
 *    UPDATE 之后的真值，与真实余额永不脱节。
 *
 * ## 消费模式（全项目现金写点必须二选一）
 *
 * - **需要失败信号**（买单冻结、改单补差额）：单独执行 UPDATE（相对量 +
 *   WHERE 守卫 + `.returning()` 判赢）。0 行 = 守卫未过、分文未动，调用方
 *   自行处理；流水随后用 returning 返回的瞬时余额插入。
 * - **必达的资金变动**（翻转裁判已赢的退款/到账，或纯入账）：UPDATE 与
 *   流水同 batch，UPDATE 在前、INSERT 在后，balance 用 cashNow 取事务内真值。
 *
 * 残余风险（有意接受）：「update 判赢」与「流水 insert」拆成两步的写点，
 * 两步之间 Worker 崩溃会留下「现金动了、流水没记」的毫秒级窗口。方向是
 * 平台不亏（钱少记在账上），全局对账 `Σ transactions.amount === account.cash`
 * 可发现（tests/services/cash-race.test.ts 与运维 SQL 见 development.md）。
 */

/** 现金相对量片段：正数入账、负数出账，直接用于 `.set({ cash: ... })` */
export function cashDelta(deltaCents: number) {
  return sql`cash + ${deltaCents}`;
}

/**
 * 同事务内的当前现金余额（子查询），用于流水 balance 快照。
 * 在 db.batch 里必须排在现金 UPDATE 之后，读到的是本批写完的真值；
 * offsetCents 用于「中间态快照」（如卖单确认的「总额到账、费用未扣」行）。
 */
export function cashNow(userId: number, offsetCents = 0) {
  const sub = sql`(SELECT ${account.cash} FROM ${account} WHERE ${account.userId} = ${userId})`;
  return offsetCents === 0 ? sub : sql`${sub} + ${offsetCents}`;
}

/**
 * 「存在冻结流水」守卫片段：退款/撤销动作的资金前提。
 * 买单冻结流水 = type='buy' 且金额为负的那条（failOrder 退款为正，不冲突）。
 */
export function hasBuyFreezeSql(orderId: number) {
  return sql`EXISTS (SELECT 1 FROM ${transactions} WHERE ${transactions.orderId} = ${orderId} AND ${transactions.type} = 'buy' AND ${transactions.amount} < 0)`;
}
