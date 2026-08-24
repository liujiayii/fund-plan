/**
 * 全局配置常量集中地。数值调整只改这里，避免散落各处。
 * 精度约定见 docs/superpowers/specs 设计文档第 4 节「精度铁律」。
 */

/** 初始本金：10 万元，以「分」为单位存储 */
export const INITIAL_CASH_CENTS = 10_000_000;

/** 签到奖励（分） */
export const CHECKIN_BASE_CENTS = 10_000; // 基础 100 元/天
export const CHECKIN_STEP_CENTS = 5_000; // 每多连签一天 +50 元
export const CHECKIN_MAX_CENTS = 50_000; // 封顶 500 元/天

/** T+1 交易日切分：北京时间 15:00 前算当日、之后顺延 */
export const TRADE_CUTOFF_HOUR = 15;
