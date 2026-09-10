/**
 * 色雾舞台（docs/liquid-glass.md §2.1）：三团紫 / 粉 / 青的漂移色雾，
 * 全站同一份，挂在根布局 <body> 首位。
 *
 * 纯 CSS 动画（liquid-glass.css §1），无 JS 测量、无状态——SSR 直出
 * 三个空 span，水合零分歧；reduced-motion 下也渲染三团，只是不跑
 * （宪法：删了雾玻璃就没衬底，会变成一块脏灰塑料）。
 *
 * aria-hidden：纯装饰，屏幕阅读器不该读到三个空元素。
 */
export function FogStage() {
  return (
    <div className="fp-fog" aria-hidden="true">
      <span className="fp-fog-a" />
      <span className="fp-fog-b" />
      <span className="fp-fog-c" />
    </div>
  );
}
