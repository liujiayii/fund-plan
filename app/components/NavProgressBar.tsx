import { useEffect, useRef } from "react";
import { useNavigation } from "react-router";
import { COLOR } from "~/theme";
import "../styles/nav-progress.css";

/**
 * 全局导航进度条（NProgress 风格的零依赖自绘，2026-09-09 二代）。
 *
 * 背景：大陆访问 Cloudflare 链路慢（实测 TTFB 中位 1.7~2.9s，见
 * docs/china-access.md），SPA 导航期间旧页面毫无反馈，用户会以为没点上
 * 而反复点击。
 *
 * 一代（不确定型往返动画）的主人反馈四连：出现太慢、来回跑显得假、
 * 等待时无时间感、结束突兀。二代全部对症：
 *  - **起跳 50ms**（原 150ms）：更快给出反馈；50ms 内就完成的快导航
 *    条从未出现过，零闪烁
 *  - **渐进推进**：从 8% 起步，每 220ms 向 90% 收敛逼近（步长递减）——
 *    等待越久走得越慢、永不冲满，「还在加载但快好了」的体感比来回跑诚实
 *  - **结束冲顶**：loader 完成时冲到 100% 再淡出，最后无过渡归零，
 *    一次导航一个完整的起承转合
 *
 * 实现注记：进度全部走 ref 直接写 DOM（transform/opacity/transition），
 * 不走 React state——每帧 setState 会反过来拖慢正在加载的导航本身。
 * SSR 首帧与 CSS 初值一致（scaleX(0) + opacity:0），无 hydration 分歧。
 * 只覆盖 SPA 导航——表单提交（useFetcher）已各自有按钮 loading，互不重复；
 * 游客整页跳转（/ 与 /master 的原生 <a>）由浏览器标签页自带 spinner 反馈。
 */
export function NavProgressBar() {
  const navigation = useNavigation();
  const active = navigation.state !== "idle";

  const barRef = useRef<HTMLDivElement>(null);
  // 小型状态机全走 ref（理由见组件头注释）
  const progressRef = useRef(0); // 当前进度 0~1
  const shownRef = useRef(false); // 本次导航是否已显示过（决定结束时要不要冲顶收尾）
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]); // 本组件排的所有定时器（推进 tick 链 + 收尾）

  // 卸载兜底：掐掉余留定时器（定时器里写的已是分离 DOM，无害，纯粹求干净）
  useEffect(() => () => {
    for (const t of timersRef.current) clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = barRef.current;
    if (!el)
      return undefined;

    /** 掐掉所有余留定时器：effect cleanup 用；也防快速连续导航时上一轮收尾打扰新一轮 */
    const clearTimers = () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    };
    /** 排一个定时器并登记——保证任何路径排的定时器都能被 clearTimers 掐掉 */
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      timersRef.current.push(t);
    };

    if (active) {
      later(() => {
        shownRef.current = true;
        // 干净起跳：快速连续导航时上一轮可能正冲顶/淡出到一半，
        // 先无过渡归零再进场，不倒放、不从满格倒着走
        el.style.transition = "none";
        el.style.transform = "scaleX(0)";
        void el.offsetWidth; // 强制 reflow：让「归零」先生效，再恢复过渡
        el.style.transition = "";

        progressRef.current = 0.08;
        el.style.opacity = "1";
        el.style.transform = `scaleX(${progressRef.current})`;

        // 渐进推进：步长随接近 90% 收敛（(0.9 - p) * 0.12），
        // 永不冲满——loader 真正完成前不撒谎
        const tick = () => {
          progressRef.current += (0.9 - progressRef.current) * 0.12;
          el.style.transform = `scaleX(${progressRef.current})`;
          later(tick, 220);
        };
        later(tick, 220);
      }, 50);
      return clearTimers;
    }

    // idle：本次导航显示过条 → 冲顶 + 淡出 + 无过渡归零，给一个完整收尾；
    // 没显示过（快导航 <50ms）什么都不做，零闪烁
    if (shownRef.current) {
      shownRef.current = false;
      el.style.transform = "scaleX(1)";
      later(() => {
        el.style.opacity = "0";
      }, 180);
      later(() => {
        // 淡出完成后无过渡归零，下一轮导航从干净状态起跳
        el.style.transition = "none";
        el.style.transform = "scaleX(0)";
        progressRef.current = 0;
        void el.offsetWidth;
        el.style.transition = "";
      }, 500);
    }
    return clearTimers;
  }, [active]);

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      className="fp-nav-progress"
      // 色值唯一出处是 theme.ts；transform/opacity/transition 全由 effect 驱动
      style={{ backgroundColor: COLOR.primary }}
    />
  );
}
