import { describe, expect, it } from "vitest";
import {
  CHECKIN_BASE_CENTS,
  CHECKIN_MAX_CENTS,
  INITIAL_CASH_CENTS,
  TRADE_CUTOFF_HOUR,
} from "~/domain/config";
import { ANTD_TOKEN, COLOR, pnlColor } from "~/theme";

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

describe("视觉 token 不变式", () => {
  it("主色不能与涨色相同（否则按钮和「涨」撞色，是重构前最大的视觉问题）", () => {
    expect(COLOR.primary).not.toBe(COLOR.up);
  });

  it("涨色与跌色必须不同", () => {
    expect(COLOR.up).not.toBe(COLOR.down);
  });

  it("pnlColor 三态：正涨、负跌、零中性", () => {
    expect(pnlColor(1)).toBe(COLOR.up);
    expect(pnlColor(-1)).toBe(COLOR.down);
    expect(pnlColor(0)).toBe(COLOR.neutral);
  });

  it("antd 语义色未被涨跌色覆盖（否则错误提示会变绿、成功提示会变红）", () => {
    const token = ANTD_TOKEN.token as Record<string, unknown>;
    expect(token.colorSuccess).toBeUndefined();
    expect(token.colorError).toBeUndefined();
  });

  it("antd 的主色必须就是 COLOR.primary（两处分叉会让按钮与强调色不是一个蓝）", () => {
    const token = ANTD_TOKEN.token as Record<string, unknown>;
    expect(token.colorPrimary).toBe(COLOR.primary);
  });

  it("暗底夜盘：页面底是近黑紫，主文字是近白（liquid-glass 宪法 §2.1/§2.4）", () => {
    expect(COLOR.bg).toBe("#100E1C");
    expect(COLOR.textPrimary).toBe("#F7F4FF");
  });

  it("色雾只有三团（宪法 §2.1：别再加第四团）", () => {
    const fogKeys = Object.keys(COLOR).filter(k => k.startsWith("fog"));
    expect(fogKeys.sort()).toEqual(["fogA", "fogB", "fogC"]);
  });

  it("待办第三语义不与涨跌、主色撞色", () => {
    expect(COLOR.pending).not.toBe(COLOR.up);
    expect(COLOR.pending).not.toBe(COLOR.down);
    expect(COLOR.pending).not.toBe(COLOR.primary);
  });

  it("antd Card 底透明——玻璃渐变要透出来（宪法 §7）", () => {
    const card = (ANTD_TOKEN.components as Record<string, Record<string, unknown>>).Card;
    expect(card.colorBgContainer).toBe("transparent");
  });

  it("antd 中性面吃材料 token：容器 = well、浮面 = elevated、遮罩 = mask", () => {
    const token = ANTD_TOKEN.token as Record<string, unknown>;
    expect(token.colorBgContainer).toBe(COLOR.well);
    expect(token.colorBgElevated).toBe(COLOR.elevated);
    expect(token.colorBgMask).toBe(COLOR.mask);
  });
});
