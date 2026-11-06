import type { ThemeColors } from "~/theme";

/** 单档配置：|收益率| ≥ threshold 时选中该档，alpha 为原始 hex8 透明度。 */
export interface RateTier {
  threshold: number;
  alpha: string;
}

/** 全组合波动被多只基金摊薄，因此使用较紧的热度阈值。 */
export const RATE_TIERS: readonly RateTier[] = [
  { threshold: 0.015, alpha: "B3" },
  { threshold: 0.008, alpha: "80" },
  { threshold: 0.003, alpha: "4D" },
  { threshold: 0, alpha: "28" },
];

/** 单基金的单日波动较大，阈值放宽；收益计算仍由领域层负责。 */
export const FUND_RATE_TIERS: readonly RateTier[] = [
  { threshold: 0.03, alpha: "B3" },
  { threshold: 0.015, alpha: "80" },
  { threshold: 0.008, alpha: "4D" },
  { threshold: 0, alpha: "28" },
];

/**
 * 只决定格子颜色，不参与金额、收益率或日期计算。
 * color-mix 同时支持实际色板和 CSS 变量，DOM 首屏无需等待 React 解析主题。
 * 四档透明度等比例降到约 9% / 18% / 30% / 42%，保留热度层级，
 * 让浅色深字和深色浅字在最深红绿底上都达到 4.5:1 的小字对比。
 */
export function calendarCellBackground(
  colors: ThemeColors,
  pnlCents: number,
  pnlRate: number,
  tiers: readonly RateTier[],
): string {
  let base = colors.neutral;
  let alpha = 0x1A;
  if (pnlCents !== 0) {
    // 空数组仍回退全组合分档，避免读取 tiers[-1] 产生无效透明度。
    const available = tiers.length > 0 ? tiers : RATE_TIERS;
    const tier = available.find(item => Math.abs(pnlRate) >= item.threshold) ?? available[available.length - 1]!;
    alpha = Math.round(Number.parseInt(tier.alpha, 16) * 0.6);
    base = pnlCents > 0 ? colors.up : colors.down;
  }

  // 用同一混色表达式测试真实色板与渲染 CSS 变量，不给 var(...) 拼 hex8 后缀。
  const percentage = Number((alpha / 255 * 100).toFixed(2));
  return `color-mix(in srgb, ${base} ${percentage}%, transparent)`;
}
