import { useSyncExternalStore } from "react";

/**
 * 是否移动端视口（≤767px）。
 *
 * 为什么要 JS 断点：响应式布局全走 responsive.css（纯 CSS，无 JS 断点设施），
 * 但 BuyDrawer 需要在「桌面右侧抽屉 / 移动端底部弹层」之间选 antd 的
 * placement 属性——这是 JS prop，CSS 管不到，只能补一个最小断点 hook。
 *
 * 实现与 NavChart 的 useIsClient 同思路：useSyncExternalStore 而非
 * 「useEffect 里 setState」——后者会多一次渲染，也会触发 react/set-state-in-effect
 * 告警。getServerSnapshot 返回 false（SSR 一律按桌面渲染），水合首帧同值，
 * 不产生 hydration mismatch；真机上由 matchMedia 的 change 事件驱动更新。
 */

/** 移动端断点（px）。与 responsive.css 的 @media (max-width: 767px) 对齐，改要两处同改 */
const MOBILE_QUERY = "(max-width: 767px)";

/** 订阅断点翻转（只在客户端被调用，SSR 走 getServerSnapshot 不进这里） */
function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    // 布尔快照值天然稳定（Object.is 判等），无需缓存 MediaQueryList 实例
    () => window.matchMedia(MOBILE_QUERY).matches,
    // SSR / 水合首帧按桌面；抽屉只在用户点击后才打开，届时早已有真实值
    () => false,
  );
}
