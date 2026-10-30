import { describe, expect, it } from "vitest";
import {
  beijingDayStartMs,
  DAILY_SUBMIT_LIMIT,
  FEEDBACK_STATUS_LABELS,
  feedbackStatusTone,
  isSubmitBlocked,
  statusFilterFromParam,
  validateFeedbackInput,
} from "~/domain/feedback";

/**
 * 需求领域纯函数：输入校验、限频判断、北京时间自然日、状态标签。
 * 全部 node 环境毫秒级，不碰 DB。
 */
describe("validateFeedbackInput", () => {
  it("标题 + 详情齐全时通过（返回 null）", () => {
    expect(validateFeedbackInput("希望支持定投暂停", "出差三个月想暂停")).toBeNull();
  });

  it("详情可空", () => {
    expect(validateFeedbackInput("只要标题", "")).toBeNull();
    expect(validateFeedbackInput("  只要标题  ", "   ")).toBeNull();
  });

  it("标题空白被拒", () => {
    expect(validateFeedbackInput("   ", "")).not.toBeNull();
  });

  it("标题恰好 50 字通过、51 字被拒", () => {
    const ok = "一".repeat(50);
    const bad = "一".repeat(51);
    expect(validateFeedbackInput(ok, "")).toBeNull();
    expect(validateFeedbackInput(bad, "")).toContain("50");
  });

  it("详情恰好 500 字通过、501 字被拒", () => {
    const ok = "一".repeat(500);
    const bad = "一".repeat(501);
    expect(validateFeedbackInput("标题", ok)).toBeNull();
    expect(validateFeedbackInput("标题", bad)).toContain("500");
  });
});

describe("isSubmitBlocked", () => {
  it("0/2 条不拦，达到 3 条拦", () => {
    expect(isSubmitBlocked(0)).toBe(false);
    expect(isSubmitBlocked(DAILY_SUBMIT_LIMIT - 1)).toBe(false);
    expect(isSubmitBlocked(DAILY_SUBMIT_LIMIT)).toBe(true);
    expect(isSubmitBlocked(99)).toBe(true);
  });
});

describe("beijingDayStartMs", () => {
  it("北京 2026-10-29 16:30（UTC 08:30）落在当天 0 点（UTC 28 日 16:00）", () => {
    const now = Date.UTC(2026, 9, 29, 8, 30, 0);
    expect(beijingDayStartMs(now)).toBe(Date.UTC(2026, 9, 28, 16, 0, 0));
  });

  it("北京 10-30 00:30（UTC 29 日 16:30）已属新的一天", () => {
    const now = Date.UTC(2026, 9, 29, 16, 30, 0);
    expect(beijingDayStartMs(now)).toBe(Date.UTC(2026, 9, 29, 16, 0, 0));
  });

  it("北京 10-30 00:00 整点即新一天起点", () => {
    const now = Date.UTC(2026, 9, 29, 16, 0, 0);
    expect(beijingDayStartMs(now)).toBe(now);
  });
});

describe("状态标签与徽章色调", () => {
  it("四态中文标签齐全", () => {
    expect(FEEDBACK_STATUS_LABELS.pending).toBe("待评估");
    expect(FEEDBACK_STATUS_LABELS.planned).toBe("已排期");
    expect(FEEDBACK_STATUS_LABELS.done).toBe("已完成");
    expect(FEEDBACK_STATUS_LABELS.rejected).toBe("不做");
  });

  it("待评估/已排期用 pending 色，已完成中性，不做用 danger", () => {
    expect(feedbackStatusTone("pending")).toBe("pending");
    expect(feedbackStatusTone("planned")).toBe("pending");
    expect(feedbackStatusTone("done")).toBe("default");
    expect(feedbackStatusTone("rejected")).toBe("danger");
  });
});

describe("statusFilterFromParam", () => {
  it("null/undefined/空串 → 全部", () => {
    expect(statusFilterFromParam(null)).toBe("all");
    expect(statusFilterFromParam(undefined)).toBe("all");
    expect(statusFilterFromParam("")).toBe("all");
  });

  it("合法枚举原样返回", () => {
    expect(statusFilterFromParam("pending")).toBe("pending");
    expect(statusFilterFromParam("rejected")).toBe("rejected");
  });

  it("非法值兜底为全部（不抛错）", () => {
    expect(statusFilterFromParam("bogus")).toBe("all");
    expect(statusFilterFromParam("PENDING")).toBe("all");
  });
});
