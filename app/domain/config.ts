/**
 * 全局配置常量集中地。数值调整只改这里，避免散落各处。
 * 精度约定见 .superpowers/specs 设计文档第 4 节「精度铁律」。
 */

/**
 * 初始本金：500 万元，以「分」为单位存储。
 *
 * ⚠️ 调整此值时必须一并处理两处，否则新旧用户会站在不同的起跑线上：
 *  1. 首页 / 注册页 / 登录页的「注册送 N 万」文案（硬编码的中文量级）；
 *  2. 存量用户的补差迁移（代码常量只影响新注册用户）。
 */
export const INITIAL_CASH_CENTS = 500_000_000;

/** 签到奖励（分） */
export const CHECKIN_BASE_CENTS = 10_000; // 基础 100 元/天
export const CHECKIN_STEP_CENTS = 5_000; // 每多连签一天 +50 元
export const CHECKIN_MAX_CENTS = 50_000; // 封顶 500 元/天

/** T+1 交易日切分：北京时间 15:00 前算当日、之后顺延 */
export const TRADE_CUTOFF_HOUR = 15;
