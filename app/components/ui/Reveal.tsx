import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * 图版入场编排的闸门（宪法 §5「图版入场编排」的唯一实现，2026-09-23 建）。
 *
 * 干三件事，按顺序：
 *   1. **客户端武装**：挂 `fp-reveal`（motion.css 里「未播状态」那组 opacity: 0 的开关），
 *      并给 `[data-fp-draw]` 的路径量出长度、把线藏起来
 *   2. **进视口播一次**：IntersectionObserver 命中就挂 `is-play` 并**解除观察**（一次性）
 *   3. **减弱动态时一步都不做**：内容直出，也没有 observer
 *
 * ⚠️ 为什么必须「服务端出终态」：SSR 的 HTML 里**没有** `fp-reveal` / `is-play`，
 * 爬虫与无 JS 用户读到的就是画好的图。这一页的 SEO 是刻意做到首屏 HTML 里的，
 * 若把「未播状态」写进 SSR，爬虫看到的就是三张空图。范式与 `ui/count-up.ts` 同源：
 * **服务端出终值、客户端才播**。
 *
 * ⚠️ 用 useLayoutEffect（不是 useEffect）：武装必须发生在**首次绘制之前**。
 * useEffect 会在浏览器画完一帧之后才跑，那半帧里用户先看到画好的图、随后它才
 * 「消失再重播」——一次刺眼的闪烁。SSR 没有 layout 阶段会告警，故用同构常量兜住。
 * 已在视口里的元素（比如用户直接刷到这一屏）连 observer 都不等，当场播，
 * 免得先空一帧。全程**不碰 React state**：这里动的是 class 与内联样式，
 * 用 state 触发重渲染会踩 `react/set-state-in-effect` 那条告警。
 */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface RevealProps {
  children: ReactNode;
  className?: string;
}

/** 进视口的判定阈值：元素露出四分之一就算「到场」 */
const VISIBLE_THRESHOLD = 0.25;

export function Reveal({ children, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el)
      return;
    // 减弱动态：连类都不挂。这条路径同时也是「无 JS」与「爬虫」的路径
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;

    // 描线：长度交给浏览器量（手算贝塞尔必然与渲染对不上）。
    // +1 收浮点尾差——差不到一分，路径末端就会留一像素的缺口
    el.querySelectorAll<SVGPathElement>("[data-fp-draw]").forEach((path) => {
      const len = path.getTotalLength() + 1;
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
    });

    // 武装：从这一刻起图停在「未播」态（opacity: 0 / 线是空的）
    el.classList.add("fp-reveal");

    const rect = el.getBoundingClientRect();
    const alreadyHere = rect.top < window.innerHeight && rect.bottom > 0;
    if (alreadyHere) {
      el.classList.add("is-play");
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting)
          continue;
        el.classList.add("is-play");
        observer.unobserve(el); // 一次性：播完就不再回来（宪法 §5 第 1 条）
      }
    }, { threshold: VISIBLE_THRESHOLD });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={className}>{children}</div>;
}
