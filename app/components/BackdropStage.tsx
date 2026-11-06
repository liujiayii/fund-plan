/**
 * 全站唯一背景舞台：SSR 直接输出静态光带，主题变化只换 CSS 变量。
 * 没有浏览器分支、画布或指针监听，减少动态偏好下也保持相同的静态衬底。
 */
export function BackdropStage() {
  return (
    <div className="fp-backdrop" aria-hidden="true">
      <div className="fp-backdrop-glow" />
      <div className="fp-backdrop-grid" />
      <svg
        className="fp-backdrop-ribbon"
        viewBox="0 0 1600 1100"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <linearGradient id="fp-backdrop-stream" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--fp-ribbon-end)" />
            <stop offset="0.43" stopColor="var(--fp-ribbon-start)" />
            <stop offset="0.72" stopColor="var(--fp-ribbon-middle)" />
            <stop offset="1" stopColor="var(--fp-ribbon-end)" />
          </linearGradient>
        </defs>
        {/* 背面、带面、细边分层，不引入 SVG 滤镜。 */}
        <g fill="none">
          <path
            d="M-260 335 C210 18 295 740 757 474 S1190 115 1780 528"
            stroke="var(--fp-ribbon-shadow)"
            strokeWidth="110"
          />
          <path
            d="M-260 326 C210 9 295 731 757 465 S1190 106 1780 519"
            stroke="url(#fp-backdrop-stream)"
            strokeWidth="106"
          />
          <path
            d="M-260 274 C210 -43 295 679 757 413 S1190 54 1780 467"
            stroke="var(--fp-ribbon-edge)"
            strokeWidth="1"
          />
          <path
            d="M-190 902 C365 1004 532 737 1078 873 S1474 1087 1770 863"
            stroke="url(#fp-backdrop-stream)"
            strokeWidth="49"
            opacity="0.32"
          />
          <path
            d="M-190 878 C365 980 532 713 1078 849 S1474 1063 1770 839"
            stroke="var(--fp-ribbon-edge)"
            strokeWidth="1"
            opacity="0.45"
          />
        </g>
      </svg>
    </div>
  );
}
