import { useEffect, useRef } from "react";
import { createParticleController, mountParticleLayer } from "~/components/backdrop-particles";
import { useAppTheme } from "~/components/ThemeProvider";

/**
 * 全站唯一背景舞台：SSR 输出静态光带与空粒子容器，客户端按需懒加载粒子。
 * 主题变化只替换粒子实例与 CSS 变量，不重挂页面；减动效动态撤下画布。
 */
export function BackdropStage() {
  const { theme } = useAppTheme();
  const particleRootRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReturnType<typeof createParticleController> | null>(null);
  const activeThemeRef = useRef(theme);
  const motionRef = useRef<MediaQueryList | null>(null);

  useEffect(() => {
    // 调试只关闭粒子，网格/柔光/光带始终保留；SSR 从不读取 window。
    if (new URLSearchParams(window.location.search).get("noparticles") === "1")
      return;
    const root = particleRootRef.current;
    if (!root)
      return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lifecycle = createParticleController((nextTheme, signal) => mountParticleLayer(root, nextTheme, signal));
    controllerRef.current = lifecycle;
    motionRef.current = query;
    const sync = () => lifecycle.setTheme(query.matches ? null : activeThemeRef.current);
    sync();
    query.addEventListener("change", sync);
    return () => {
      query.removeEventListener("change", sync);
      lifecycle.dispose();
      controllerRef.current = null;
      motionRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeThemeRef.current = theme;
    controllerRef.current?.setTheme(motionRef.current?.matches ? null : theme);
  }, [theme]);

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
      <div ref={particleRootRef} className="fp-backdrop-particles" />
    </div>
  );
}
