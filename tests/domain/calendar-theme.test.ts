import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfitCalendar } from "~/components/ProfitCalendar";
import { ThemeProvider } from "~/components/ThemeProvider";
import { calendarCellBackground, FUND_RATE_TIERS, RATE_TIERS } from "~/components/ui/calendar-theme";
import { COLOR, THEME_COLORS } from "~/theme";

/** 解析最终 CSS 的实际色值与权重，验证浏览器真正拿到的热度色。 */
function heatColor(css: string): { color: string; alpha: number } {
  const match = css.match(/^color-mix\(in srgb, (#[0-9a-f]{6}) ([\d.]+)%, transparent\)$/i);
  if (!match) {
    throw new Error(`无法解析热度颜色：${css}`);
  }
  return { color: match[1]!, alpha: Number(match[2]) / 100 };
}

/** 测试真实绘制结果的对比，不复刻颜色函数里的分档或透明度公式。 */
function rgb(hex: string): number[] {
  return [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16));
}

function luminance(channels: number[]): number {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrastOnSurface(foreground: string, translucent: string, surface: string): number {
  const { color, alpha } = heatColor(translucent);
  const base = rgb(surface);
  const blended = rgb(color).map((channel, index) => channel * alpha + base[index]! * (1 - alpha));
  const a = luminance(rgb(foreground));
  const b = luminance(blended);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(Object.entries(THEME_COLORS))("%s 收益日历配色", (_id, colors) => {
  it("涨红跌绿由收益金额决定，收益率只影响深浅", () => {
    const rise = calendarCellBackground(colors, 100, -0.02, RATE_TIERS);
    const fall = calendarCellBackground(colors, -100, 0.02, RATE_TIERS);
    expect(heatColor(rise).color).toBe(colors.up);
    expect(heatColor(fall).color).toBe(colors.down);
    expect(heatColor(rise).alpha).toBe(heatColor(fall).alpha);
  });

  it("零收益保持中性，空分档回退全组合设置", () => {
    const neutral = calendarCellBackground(colors, 0, 0.8, RATE_TIERS);
    expect(heatColor(neutral).color).toBe(colors.neutral);
    expect(neutral).toBe(calendarCellBackground(colors, 0, 0, RATE_TIERS));
    expect(calendarCellBackground(colors, 100, 0.008, [])).toBe(calendarCellBackground(colors, 100, 0.008, RATE_TIERS));
  });

  it.each([{ tiers: RATE_TIERS }, { tiers: FUND_RATE_TIERS }])("每档依然逐级加深，最深格上的小字达到 4.5:1", ({ tiers }) => {
    for (const sign of [1, -1]) {
      const backgrounds = [...tiers].reverse().map(tier => calendarCellBackground(colors, sign * 100, tier.threshold, tiers));
      const alphas = backgrounds.map(background => heatColor(background).alpha);
      for (let index = 1; index < alphas.length; index++) {
        expect(alphas[index]).toBeGreaterThan(alphas[index - 1]!);
      }
      for (const background of backgrounds) {
        // 覆盖页面底与浮面两端，抓住最深红绿底上的小字对比回退。
        for (const surface of [colors.bg, colors.elevated]) {
          expect(contrastOnSurface(colors.textPrimary, background, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("阈值边界仍由传入分档决定", () => {
    const before = calendarCellBackground(colors, 100, 0.003 - 0.000001, RATE_TIERS);
    const boundary = calendarCellBackground(colors, 100, 0.003, RATE_TIERS);
    expect(before).not.toBe(boundary);
    expect(calendarCellBackground(colors, 100, 0.003, FUND_RATE_TIERS)).toBe(before);
  });
});

describe("收益日历首屏主题", () => {
  it.each([
    { cents: 100, token: COLOR.up },
    { cents: -100, token: COLOR.down },
    { cents: 0, token: COLOR.neutral },
  ])("DOM 背景保留 $token，透明度不拼到 var() 后面", ({ cents, token }) => {
    const background = calendarCellBackground(COLOR, cents, 0.03, RATE_TIERS);
    expect(background).toMatch(/^color-mix\(in srgb, var\(--fp-[a-z-]+\) [\d.]+%, transparent\)$/);
    expect(background).toContain(token);
    expect(background).not.toMatch(/var\([^)]+\)[0-9a-f]{2}/i);
  });

  it("SSR 默认 A 快照只输出颜色变量，B 首帧及无 JS 都由 CSS 决定", () => {
    const calendar = createElement(ProfitCalendar, {
      data: [
        { date: "2026-11-02", dayPnlCents: 100, dayPnlRate: 0.03 },
        { date: "2026-11-03", dayPnlCents: -100, dayPnlRate: -0.03 },
        { date: "2026-11-04", dayPnlCents: 0, dayPnlRate: 0 },
      ],
    });
    const html = renderToStaticMarkup(createElement(ThemeProvider, null, calendar));
    const cellStyles = [...html.matchAll(/class="fp-cal-cell"[^>]*style="([^"]+)"/g)].map(match => match[1]!);
    expect(cellStyles.length).toBeGreaterThan(0);
    for (const token of [COLOR.up, COLOR.down, COLOR.neutral]) {
      expect(cellStyles.some(style => style.includes(`background:color-mix(in srgb, ${token} `))).toBe(true);
    }
    expect(html).toContain(`color:${COLOR.textPrimary}`);
    for (const color of [THEME_COLORS.ceramic.up, THEME_COLORS.ceramic.down, THEME_COLORS.ceramic.textPrimary]) {
      expect(html).not.toContain(color);
    }
  });
});
