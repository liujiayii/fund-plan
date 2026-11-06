/**
 * 沿用既有三折净值曲线，改用 currentColor 跟随主题。
 * 内联图形不依赖浏览器系统明暗，手动切换 A/B 时也会同步，不产生图片闪烁。
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="block shrink-0 text-primary" aria-hidden="true">
      <path d="M6.5 22.5 L12.6 15.4 L17.3 19 L25.5 9.5 L25.5 25.5 L6.5 25.5 Z" fill="currentColor" fillOpacity="0.14" />
      <path d="M6.5 22.5 L12.6 15.4 L17.3 19 L25.5 9.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25.5" cy="9.5" r="2.6" fill="currentColor" />
    </svg>
  );
}
