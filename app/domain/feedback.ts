/**
 * 需求墙领域纯函数：输入校验、限频判断、北京时间自然日、状态元数据。
 * 不依赖 D1/网络，node 单测直跑（spec：`.superpowers/specs/2026-10-29-feedback-wall-design.md`）。
 */

/** 状态机四态；与 schema.ts feedback.status 的 enum 字面量保持一致 */
export const FEEDBACK_STATUSES = [
  "pending",
  "planned",
  "done",
  "rejected",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** 列表筛选：四态之一或「全部」 */
export type StatusFilter = FeedbackStatus | "all";

/** 状态中文标签（卡片徽章与筛选 tab 共用，别在组件里各写一份） */
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: "待评估",
  planned: "已排期",
  done: "已完成",
  rejected: "不做",
};

/**
 * 徽章色调映射（复用 ui/StatusBadge 的三档）：
 * 待评估/已排期是「还没落地」→ pending 色；已完成中性；不做 → danger。
 */
export function feedbackStatusTone(
  status: FeedbackStatus,
): "pending" | "danger" | "default" {
  if (status === "rejected")
    return "danger";
  if (status === "done")
    return "default";
  return "pending";
}

/** 每用户每日提交上限（防刷，spec 定为 3 条） */
export const DAILY_SUBMIT_LIMIT = 3;

/** 标题/详情字数上限（服务端校验，前端 maxlength 只是人机体验） */
export const FEEDBACK_TITLE_MAX = 50;
export const FEEDBACK_DETAIL_MAX = 500;

/**
 * 北京时间自然日 0 点的毫秒数。限频按「北京时间当日」计数，
 * 与每日签到口径一致——纯 UTC 日界会在北京时间早上 8 点才翻篇。
 */
export function beijingDayStartMs(now: number): number {
  const dayMs = 86_400_000;
  const cnOffset = 8 * 3_600_000;
  return Math.floor((now + cnOffset) / dayMs) * dayMs - cnOffset;
}

/** 当日已提交 count 条时是否拦下新提交 */
export function isSubmitBlocked(countToday: number): boolean {
  return countToday >= DAILY_SUBMIT_LIMIT;
}

/**
 * 提交入参校验：通过返回 null，否则返回可直接展示的人话文案。
 * 标题先去首尾空白再验——调用方可能忘了 trim，这里兜底（空白标题=没写标题）；
 * 详情按原样校验长度（纯空白详情等价于没写，合法）。
 */
export function validateFeedbackInput(
  title: string,
  detail: string,
): string | null {
  const t = title.trim();
  if (t.length === 0)
    return "标题不能为空";
  if (t.length > FEEDBACK_TITLE_MAX)
    return `标题需在 ${FEEDBACK_TITLE_MAX} 字以内`;
  if (detail.length > FEEDBACK_DETAIL_MAX)
    return `详情需在 ${FEEDBACK_DETAIL_MAX} 字以内`;
  return null;
}

/** URL ?status= 参数安全解析：非法/缺失一律「全部」，不抛错 */
export function statusFilterFromParam(
  param: string | null | undefined,
): StatusFilter {
  if (param && (FEEDBACK_STATUSES as readonly string[]).includes(param))
    return param as StatusFilter;
  return "all";
}
