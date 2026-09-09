import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Calculates a cubic ease-out interpolation that starts quickly and slows toward completion.
 *
 * @param t - Linear progress from 0 to 1
 * @returns Eased progress from 0 to 1
 */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a displayed value toward the target value.
 *
 * The initial rendered value matches the target for SSR and hydration safety. After
 * mounting, the value animates from zero; subsequent target changes continue from
 * the current displayed value. Reduced-motion preferences apply the target
 * immediately.
 *
 * @param value - The target numeric value
 * @param durationMs - The animation duration in milliseconds
 * @returns The current animated value
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
 * Formats an animated numeric value for display.
 *
 * @param value - The target numeric value.
 * @param format - Converts the animated value into display text.
 * @returns The formatted display text.
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
