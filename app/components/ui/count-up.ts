import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/** easeOutCubic：先快后慢（visual-refresh spec §5） */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * 数字滚动 hook：目标值变化时从上一个值平滑滚到新值。
 * - SSR/hydration 安全：初始 state 就是目标值（首帧渲染终值不闪 0），
 *   首次挂载后在 effect 里从 0 滚上去（支付宝式进场）
 * - prefers-reduced-motion: reduce 时跳过动画直接落值
 */
export function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(value);
  // fromRef 记「上一帧的起点」；isFirstRef 区分首挂（从 0 滚）与更新（从旧值滚）
  const fromRef = useRef(0);
  const isFirstRef = useRef(true);
  const rafRef = useRef(0);

  useEffect(() => {
    // 减弱动态请求：直接落值，不滚
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = isFirstRef.current ? 0 : fromRef.current;
    isFirstRef.current = false;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const current = from + (value - from) * easeOutCubic(t);
      // 每帧写回当前值：若 value 在动画完成前再次变化（effect 重跑），
      // 新动画从「最新显示值」续滚而非从旧起点回跳（CodeRabbit PR #79 修正）
      fromRef.current = current;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return display;
}

/**
 * 滚动数字文本：把 useCountUp 的浮点中间值取整回「分」再交给 format。
 * 取整保证滚动过程中位数不抖（spec 验收 #2 的等宽纪律延伸）。
 */
export function CountUpText({
  value,
  format,
}: {
  /** 目标值（调用方语义单位，通常是「分」） */
  value: number;
  /** 展示格式化（如 v => fmtYuan(Math.round(v))） */
  format: (v: number) => string;
}): ReactNode {
  const v = useCountUp(value);
  // format 产物（string）本身即合法 ReactNode；不包 JSX fragment——
  // 本文件是 .ts 非 .tsx，且直接返回零额外节点、语义与 fragment 完全等价
  return format(v);
}
