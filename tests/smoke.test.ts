import { describe, expect, it } from "vitest";
import {
  CHECKIN_BASE_CENTS,
  CHECKIN_MAX_CENTS,
  INITIAL_CASH_CENTS,
  TRADE_CUTOFF_HOUR,
} from "~/domain/config";
import { COLOR, pnlColor, THEME_COLORS } from "~/theme";
import { getAntdTheme } from "~/theme-antd";

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

  it("初始本金为 500 万元（以分为单位）", () => {
    expect(INITIAL_CASH_CENTS).toBe(500_000_000);
  });

  it("签到基础奖励 100 元、封顶 500 元", () => {
    expect(CHECKIN_BASE_CENTS).toBe(10_000);
    expect(CHECKIN_MAX_CENTS).toBe(50_000);
  });

  it("T+1 切分时点为北京时间 15:00", () => {
    expect(TRADE_CUTOFF_HOUR).toBe(15);
  });
});

describe("双主题视觉 token 不变式", () => {
  it("pnlColor 保持国内涨红跌绿三态，DOM 引用可随主题更新", () => {
    expect(pnlColor(1)).toBe(COLOR.up);
    expect(pnlColor(-1)).toBe(COLOR.down);
    expect(pnlColor(0)).toBe(COLOR.neutral);
    expect(COLOR.bg).toBe("var(--fp-bg)");
  });

  describe.each(["ceramic", "graphite"] as const)("%s", (id) => {
    const colors = THEME_COLORS[id];
    const config = getAntdTheme(id);
    const token = config.token!;

    it("操作、涨跌和在途为不同语义", () => {
      expect(new Set([colors.primary, colors.up, colors.down, colors.pending]).size).toBe(4);
    });

    it("antd 的操作色与中性面来自当前 palette，金融色不污染成功/错误", () => {
      expect(token.colorPrimary).toBe(colors.primary);
      expect(token.colorBgContainer).toBe(colors.well);
      expect(token.colorBgElevated).toBe(colors.elevated);
      expect(token.colorBgMask).toBe(colors.mask);
      expect(token.colorSuccess).toBeUndefined();
      expect(token.colorError).toBeUndefined();
    });

    it("主按钮与金银铜奖牌的文字至少满足 4.5:1 对比", () => {
      const luminance = (hex: string) => {
        const channels = [1, 3, 5].map((index) => {
          const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const a = luminance(colors.primary);
      const b = luminance(colors.onPrimary);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
      const medalText = luminance(colors.medalInk);
      for (const background of ["#F5C454", "#C9D6E2", "#CD8A54"]) {
        const medalBg = luminance(background);
        expect((Math.max(medalBg, medalText) + 0.05) / (Math.min(medalBg, medalText) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("卡片底透明交给材料层，背景提供光带与实际粒子色", () => {
      expect(config.components?.Card?.colorBgContainer).toBe("transparent");
      expect(colors.backdropGrid).toBeTruthy();
      expect(colors.backdropGlow).toBeTruthy();
      expect(colors.ribbonStart).toMatch(/^#/);
      expect(colors.ribbonMiddle).toMatch(/^#/);
      expect(colors.ribbonEnd).toMatch(/^#/);
      expect(colors.particleA).toMatch(/^#[\dA-F]{6}$/i);
      expect(colors.particleB).toMatch(/^#[\dA-F]{6}$/i);
      expect(colors.particleC).toMatch(/^#[\dA-F]{6}$/i);
    });
  });
});
