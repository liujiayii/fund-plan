-- ============================================================================
-- 注册赠送本金 10 万 → 500 万：存量用户补差 + 主理人账户补到 1000 万（2026-09-19）
--
-- 背景：app/domain/config.ts 的 INITIAL_CASH_CENTS 已提到 500 万，但代码常量只
-- 影响新注册用户。存量账户不动，就会是「老用户 10 万、新用户 500 万」，而排行榜
-- 收益率的分母正是累计入金 —— 老用户直接吃亏，所以必须补上。
--
-- 为什么不新增一条「补发」流水：
--   /me 的逐笔流水不该出现补发记录，用户看到的就是「开局本金 500 万」。但口径
--   不能因此分裂 —— 全站「累计入金」有两条独立实现，必须处处相等：
--     account.initial_cash + account.total_checkin
--     === 流水里 init / checkin 的聚合（总览卡累计收益率的分母）
--     === 排行榜收益率的分母
--   所以这里不插新行，而是把 init 流水提额到 500 万，并把该用户所有流水的余额
--   快照整体上移同一个差额：余额链「本行余额 = 上一行余额 + 本行金额」依旧连续
--   （重置功能会清空流水只留一条 init，故每个用户的 init 行唯一）。
--   交叉不变量断言见 tests/services/leaderboard.test.ts。
--
-- 差额一律按**账户当前的 initial_cash 现算**（500000000 - initial_cash），不写死
--   490 万：流水余额快照与 account.cash 用同一个差额，两边必然一致；即便存在非
--   标准初始本金（历史手工放款等）也不会把余额链与现金改歪。
--
-- 幂等：所有语句都以 account.initial_cash 的当前值筛选目标（尚未补足才动手），
--       重复执行不会二次补发。
-- ============================================================================

-- 1) 存量用户统一补到 500 万 --------------------------------------------------
-- ⚠️ 顺序有讲究：三组语句都靠「account 里还是旧值」来筛选目标，所以流水先改，
--    account 最后改（account.initial_cash 一旦被改写，差额就取不到了）。
UPDATE `transactions`
SET
  `amount` = 500000000,
  `balance` = `balance` + (
    SELECT 500000000 - `a`.`initial_cash`
    FROM `account` `a`
    WHERE `a`.`user_id` = `transactions`.`user_id`
  )
WHERE
  `type` = 'init'
  AND `user_id` IN (SELECT `user_id` FROM `account` WHERE `initial_cash` < 500000000);

UPDATE `transactions`
SET `balance` = `balance` + (
  SELECT 500000000 - `a`.`initial_cash`
  FROM `account` `a`
  WHERE `a`.`user_id` = `transactions`.`user_id`
)
WHERE
  `type` <> 'init'
  AND `user_id` IN (SELECT `user_id` FROM `account` WHERE `initial_cash` < 500000000);

UPDATE `account`
SET
  `cash` = `cash` + (500000000 - `initial_cash`),
  `initial_cash` = 500000000
WHERE `initial_cash` < 500000000;

-- 2) 主理人账户再补 500 万（合计 1000 万） ------------------------------------
-- 用户名硬编码自 wrangler.jsonc 的 vars.ADMIN_USERNAME：迁移 SQL 读不到环境变量，
-- 日后改管理员用户名时这里要一并同步。账号不存在则三条语句自然空跑。
-- 命中条件用 initial_cash < 1000000000：上一组语句已把主理人补到 500 万，所以
-- 这里必然命中；重复执行时它已是 10 亿，自然跳过（幂等）。
UPDATE `transactions`
SET
  `amount` = 1000000000,
  `balance` = `balance` + (
    SELECT 1000000000 - `a`.`initial_cash`
    FROM `account` `a`
    WHERE `a`.`user_id` = `transactions`.`user_id`
  )
WHERE
  `type` = 'init'
  AND `user_id` IN (
    SELECT `a`.`user_id`
    FROM `account` `a`
    JOIN `user` `u` ON `u`.`id` = `a`.`user_id`
    WHERE `u`.`username` = 'liujiayii' AND `a`.`initial_cash` < 1000000000
  );

UPDATE `transactions`
SET `balance` = `balance` + (
  SELECT 1000000000 - `a`.`initial_cash`
  FROM `account` `a`
  WHERE `a`.`user_id` = `transactions`.`user_id`
)
WHERE
  `type` <> 'init'
  AND `user_id` IN (
    SELECT `a`.`user_id`
    FROM `account` `a`
    JOIN `user` `u` ON `u`.`id` = `a`.`user_id`
    WHERE `u`.`username` = 'liujiayii' AND `a`.`initial_cash` < 1000000000
  );

UPDATE `account`
SET
  `cash` = `cash` + (1000000000 - `initial_cash`),
  `initial_cash` = 1000000000
WHERE
  `user_id` IN (SELECT `id` FROM `user` WHERE `username` = 'liujiayii')
  AND `initial_cash` < 1000000000;
