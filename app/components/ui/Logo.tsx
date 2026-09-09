/**
 * 品牌视觉锤：圆角渐变方块 + 白色上扬净值曲线（visual-refresh spec §6.1）。
 * 颜色吃 --fp-primary / --fp-primary-to CSS 变量——token 单一出处不破。
 * gradient id 固定字符串：同参数渐变重复定义无害，不必 useId。
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fp-logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--fp-primary)" />
          <stop offset="1" stopColor="var(--fp-primary-to)" />
        </linearGradient>
      </defs>
      {/* 渐变圆角方块：app icon 语言，9/32 圆角比例与卡片 16px 同档 */}
      <rect width="32" height="32" rx="9" fill="url(#fp-logo-grad)" />
      {/* 白色净值曲线：两段折线上扬，末端圆点收「最新一笔」 */}
      <path
        d="M8 21.5 L13 15.5 L17.5 19 L24 10.5"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="10.5" r="2" fill="#fff" />
    </svg>
  );
}
