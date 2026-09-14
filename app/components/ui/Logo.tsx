/**
 * 品牌视觉锤：上扬三折净值曲线。图形唯一出处收敛到 public/logo.svg
 * （2026-09-14 拍板改外链引用）：favicon.ico / favicon.svg / 页内 Logo
 * 三处吃同一份资产，不再维护内联副本，也不会再撞「gradient stop 里的
 * var() 按 :root 注入时机静默不画」的 Chrome 坑。
 * 代价：不吃 theme.ts token 与页面 CSS，换主题要改资产文件本身。
 * display:block：img 默认 inline，底边会留一条 line-height 空隙。
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="block"
    />
  );
}
