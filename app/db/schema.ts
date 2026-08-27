import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * D1（SQLite）表定义。精度铁律（详见设计文档第 4 节）：
 *   金额 → 整数「分」（×100）
 *   份额 → 整数（×10000，保留 4 位小数余量）
 *   净值 → 整数（×10000，真实净值即 4 位小数）
 *   费率 → 整数「万分之」（×10000，如 1.5% 存 150）
 * 所有中间运算用 decimal.js，最后四舍五入回整数入库，杜绝浮点误差。
 *
 * 命名说明：spec 中的 order / transaction 是 SQLite 保留字，
 * 物理表名改用 orders / transactions，语义不变。
 */

// ==================== 全局共享表（不属于任何用户，全站复用一份）====================

/** 基金档案 */
export const fund = sqliteTable("fund", {
  /** 基金代码，如 000001 */
  code: text("code").primaryKey(),
  /** 基金名称 */
  name: text("name").notNull(),
  /** 类型：混合型 / 指数型 / 债券型… */
  type: text("type").notNull().default(""),
  /** 申购费率（万分之，优惠后），如 0.15% 存 15 */
  purchaseRate: integer("purchase_rate").notNull().default(0),
  /** 赎回费率阶梯 JSON：[{minDays,maxDays,rate}]，rate 为万分之 */
  redeemTiers: text("redeem_tiers", { mode: "json" })
    .notNull()
    .$type<{ minDays: number; maxDays: number | null; rate: number }[]>(),
  /** 起购金额（分） */
  minPurchase: integer("min_purchase").notNull().default(1000),
  /** 风险等级 1-5 */
  riskLevel: integer("risk_level").notNull().default(3),
  /** 申赎开放状态，如「开放申购」 */
  status: text("status").notNull().default("开放申购"),
  /** 档案元数据更新时间戳（毫秒） */
  updatedAt: integer("updated_at").notNull(),
});

/** 历史净值（撮合与画图的数据底座；所有用户共用一份） */
export const fundNav = sqliteTable(
  "fund_nav",
  {
    fundCode: text("fund_code").notNull(),
    /** 净值日期 YYYY-MM-DD */
    navDate: text("nav_date").notNull(),
    /** 单位净值 ×10000 */
    unitNav: integer("unit_nav").notNull(),
    /** 累计净值 ×10000 */
    accNav: integer("acc_nav").notNull().default(0),
    /** 日涨跌率 ×10000（万分之） */
    growthRate: integer("growth_rate").notNull().default(0),
  },
  t => [
    primaryKey({ columns: [t.fundCode, t.navDate] }),
    // 按基金查最近净值序列是最热的查询，单独建索引
    index("idx_fund_nav_code_date").on(t.fundCode, t.navDate),
  ],
);

// ==================== 用户维度表（每人一套）====================

/** 用户 */
export const user = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  /** PBKDF2 派生出的哈希（hex） */
  passwordHash: text("password_hash").notNull(),
  /** 随机盐（hex） */
  salt: text("salt").notNull(),
  /** 角色：admin（主人，组合公开）| user */
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  createdAt: integer("created_at").notNull(),
});

/** 会话（token 存 httpOnly cookie） */
export const session = sqliteTable(
  "session",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 过期时间戳（毫秒） */
    expiresAt: integer("expires_at").notNull(),
  },
  t => [index("idx_session_user").on(t.userId)],
);

/** 账户（每用户单例） */
export const account = sqliteTable("account", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** 现金余额（分） */
  cash: integer("cash").notNull(),
  /** 初始本金（分），重置模拟盘时恢复到此值 */
  initialCash: integer("initial_cash").notNull(),
  /** 累计签到入金（分） */
  totalCheckin: integer("total_checkin").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/**
 * 份额批次 ⭐ 真实 T+1 阶梯赎回费的关键。
 * 每笔确认的申购生成一个批次；赎回时按 confirmDate 升序 FIFO 逐批消耗，
 * 按各批持有天数查对应阶梯费率。
 */
export const shareLot = sqliteTable(
  "share_lot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    /** 该批剩余份额 ×10000 */
    shares: integer("shares").notNull(),
    /** 该批剩余成本（分，含申购费） */
    cost: integer("cost").notNull(),
    /** 确认日 YYYY-MM-DD，用于算持有天数 */
    confirmDate: text("confirm_date").notNull(),
    /** 来源订单 */
    orderId: integer("order_id"),
  },
  t => [
    // FIFO 消耗时按 (用户, 基金, 确认日) 升序扫描
    index("idx_share_lot_fifo").on(t.userId, t.fundCode, t.confirmDate),
  ],
);

/** 持仓汇总（share_lot 的物化汇总，读得快；与 share_lot 在同一 batch 内同步维护） */
export const holding = sqliteTable(
  "holding",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    /** 总份额 ×10000 */
    totalShares: integer("total_shares").notNull().default(0),
    /** 总成本（分） */
    totalCost: integer("total_cost").notNull().default(0),
  },
  t => [primaryKey({ columns: [t.userId, t.fundCode] })],
);

/** 订单（T+1 状态机） */
export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    /** buy=申购 | sell=赎回 */
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    /** pending → confirmed | failed */
    status: text("status", { enum: ["pending", "confirmed", "failed"] })
      .notNull()
      .default("pending"),
    /** manual=手动 | dca=定投触发 */
    source: text("source", { enum: ["manual", "dca"] }).notNull().default("manual"),
    /** 申购金额（分）；赎回单为 null */
    amount: integer("amount"),
    /** 赎回份额 ×10000；申购单为 null */
    shares: integer("shares"),
    /** 下单日 YYYY-MM-DD */
    placeDate: text("place_date").notNull(),
    /** 确认日（T+1 目标交易日）YYYY-MM-DD */
    confirmDate: text("confirm_date").notNull(),
    /** 成交净值 ×10000（确认后回填） */
    dealNav: integer("deal_nav"),
    /** 成交份额 ×10000（确认后回填） */
    dealShares: integer("deal_shares"),
    /** 成交金额（分，确认后回填） */
    dealAmount: integer("deal_amount"),
    /** 手续费（分，确认后回填） */
    fee: integer("fee"),
    /** 失败原因 */
    failReason: text("fail_reason"),
    createdAt: integer("created_at").notNull(),
  },
  t => [
    // 撮合任务扫描 pending 单；用户列表按用户倒序翻页
    index("idx_orders_status_confirm").on(t.status, t.confirmDate),
    index("idx_orders_user_created").on(t.userId, t.createdAt),
  ],
);

/** 定投计划 */
export const dcaPlan = sqliteTable(
  "dca_plan",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    /** 每期金额（分） */
    amount: integer("amount").notNull(),
    frequency: text("frequency", { enum: ["daily", "weekly", "monthly"] }).notNull(),
    /** 周几（weekly 用，1-7 对应周一到周日） */
    dayOfWeek: integer("day_of_week"),
    /** 每月几号（monthly 用，限 1-28 规避 2 月问题） */
    dayOfMonth: integer("day_of_month"),
    status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
    /** 下次执行日 YYYY-MM-DD */
    nextRun: text("next_run").notNull(),
    /** 已投期数 */
    runCount: integer("run_count").notNull().default(0),
    /** 累计投入（分） */
    totalInvested: integer("total_invested").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  t => [
    // 定投扫描按 (状态, 下次执行日) 找到期计划
    index("idx_dca_status_next").on(t.status, t.nextRun),
    index("idx_dca_user").on(t.userId),
  ],
);

/** 资金账本（只增不改，可对账） */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** checkin=签到入金 | buy=申购出金 | sell=赎回入金 | fee=手续费 | init=初始本金 */
    type: text("type", {
      enum: ["checkin", "buy", "sell", "fee", "init"],
    }).notNull(),
    /** 金额（分，正=入账，负=出账） */
    amount: integer("amount").notNull(),
    /** 变动后余额（分，快照便于对账） */
    balance: integer("balance").notNull(),
    /** 关联订单（可空） */
    orderId: integer("order_id"),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  t => [index("idx_tx_user_created").on(t.userId, t.createdAt)],
);

/** 签到记录 */
export const checkin = sqliteTable(
  "checkin",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 签到日 YYYY-MM-DD */
    checkinDate: text("checkin_date").notNull(),
    /** 奖励金额（分） */
    reward: integer("reward").notNull(),
    /** 连续签到天数 */
    streak: integer("streak").notNull(),
  },
  t => [
    // 唯一约束：同一用户同一天只能签一次（防重复签到的最后防线）
    unique("uq_checkin_user_date").on(t.userId, t.checkinDate),
  ],
);

/**
 * 自选基金（用户收藏的基金，与持仓无关）。
 *
 * 复合主键 (userId, fundCode) 天然防重复关注，不需要额外唯一约束——
 * 重复 INSERT 用 onConflictDoNothing 吞掉即可。
 * userId 级联删除：用户没了自选也跟着没。
 */
export const watchlist = sqliteTable(
  "watchlist",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fundCode: text("fund_code").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.fundCode] })],
);

/** 供 drizzle 关系查询与类型推断使用的聚合导出 */
export const schema = {
  fund,
  fundNav,
  user,
  session,
  account,
  shareLot,
  holding,
  orders,
  dcaPlan,
  transactions,
  checkin,
  watchlist,
};

// 便捷类型：插入/查询行类型
export type FundRow = typeof fund.$inferSelect;
export type FundNavRow = typeof fundNav.$inferSelect;
export type UserRow = typeof user.$inferSelect;
export type AccountRow = typeof account.$inferSelect;
export type ShareLotRow = typeof shareLot.$inferSelect;
export type HoldingRow = typeof holding.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type DcaPlanRow = typeof dcaPlan.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type CheckinRow = typeof checkin.$inferSelect;
export type WatchlistRow = typeof watchlist.$inferSelect;
