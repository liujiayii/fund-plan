import { describe, expect, it } from "vitest";
import {
  CHECKIN_BASE_CENTS,
  CHECKIN_MAX_CENTS,
  INITIAL_CASH_CENTS,
  TRADE_CUTOFF_HOUR,
} from "~/domain/config";

/**
 * 冒烟测试：验证测试框架跑得起来、路径别名 ~/ 解析正常、
 * 领域层常量符合设计文档约定。
 */
describe("脚手架冒烟测试", () => {
  it("测试框架可用", () => {
    expect(1 + 1).toBe(2);
  });

  it("路径别名 ~/ 能解析到 app 目录", () => {
    expect(typeof INITIAL_CASH_CENTS).toBe("number");
  });

  it("初始本金为 10 万元（以分为单位）", () => {
    expect(INITIAL_CASH_CENTS).toBe(10_000_000);
  });

  it("签到基础奖励 100 元、封顶 500 元", () => {
    expect(CHECKIN_BASE_CENTS).toBe(10_000);
    expect(CHECKIN_MAX_CENTS).toBe(50_000);
  });

  it("T+1 切分时点为北京时间 15:00", () => {
    expect(TRADE_CUTOFF_HOUR).toBe(15);
  });
});
