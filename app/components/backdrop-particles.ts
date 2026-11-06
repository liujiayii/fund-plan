import type { Container, Engine, ISourceOptions } from "tsparticles-engine";
import type { ThemeId } from "~/theme";
import { THEME_COLORS } from "~/theme";

// 精确锁定 2.12.0：旧站实测 v3 会创建空画布；插件只初始化一次，失败允许重试。
let enginePromise: Promise<Engine> | null = null;
let mountId = 0;

function loadEngine(): Promise<Engine> {
  enginePromise ??= (async () => {
    try {
      const [{ tsParticles }, { loadFull }] = await Promise.all([
        import("tsparticles-engine"),
        import("tsparticles"),
      ]);
      await loadFull(tsParticles);
      return tsParticles;
    }
    catch (error) {
      enginePromise = null;
      throw error;
    }
  })();
  return enginePromise;
}

/** canvas 不解析 CSS 变量，必须传入当前主题的实际十六进制色值。 */
export function particleOptions(theme: ThemeId, width: number): ISourceOptions {
  const colors = THEME_COLORS[theme];
  return {
    fullScreen: { enable: false },
    background: { color: "transparent" },
    // 创建阶段不播放，控制器确认主题与减动效偏好仍有效后才启动。
    autoPlay: false,
    fpsLimit: 60,
    pauseOnBlur: true,
    detectRetina: true,
    particles: {
      number: { value: width < 768 ? 30 : 60, density: { enable: true, area: 900 } },
      color: { value: [colors.particleA, colors.particleB, colors.particleC] },
      shape: { type: "circle" },
      opacity: {
        value: { min: 0.18, max: 0.55 },
        animation: { enable: true, speed: 0.5, minimumValue: 0.12, sync: false },
      },
      size: { value: { min: 1, max: 3 } },
      links: { enable: true, distance: 150, color: colors.particleA, opacity: 0.18, width: 1 },
      move: {
        enable: true,
        speed: 0.7,
        direction: "none",
        random: true,
        straight: false,
        outModes: { default: "out" },
      },
    },
    interactivity: {
      // 背景不接指针，窗口级监听保留悬停抓线与点击补粒子。
      detectsOn: "window",
      events: {
        onHover: { enable: true, mode: "grab" },
        onClick: { enable: true, mode: "push" },
        resize: true,
      },
      modes: {
        grab: { distance: 170, links: { opacity: 0.35, color: colors.particleA } },
        push: { quantity: 3 },
      },
    },
  };
}

interface ParticleLayer {
  play: () => void;
  destroy: () => void;
}

/**
 * 每次加载使用独立宿主与 id，取消时立即移除自己的 DOM。
 * 引擎加载无法中断，因此旧任务返回后只清理自己的容器，绝不全局清场。
 */
export async function mountParticleLayer(root: HTMLDivElement, theme: ThemeId, signal: AbortSignal): Promise<ParticleLayer | undefined> {
  const engine = await loadEngine();
  if (signal.aborted)
    return;

  const host = document.createElement("div");
  const id = `fpBackdropParticles-${++mountId}`;
  host.id = id;
  // visibility 保留尺寸；display:none 会让引擎把画布初始化成 0×0。
  host.className = "absolute inset-0 invisible";
  root.appendChild(host);
  const detach = () => host.remove();
  signal.addEventListener("abort", detach, { once: true });
  let container: Container | undefined;
  const destroy = () => {
    signal.removeEventListener("abort", detach);
    try {
      // load 抛错时容器可能已注册，按自己的 id 清理这个半成品。
      (container ?? engine.dom().find(item => item.id === id))?.destroy();
    }
    catch { /* 装饰层清理失败也不能打断页面功能。 */ }
    finally {
      host.remove();
    }
  };
  try {
    container = await engine.load({ id, element: host, options: particleOptions(theme, window.innerWidth) });
    if (!container) {
      destroy();
      return;
    }
    return {
      play: () => {
        host.classList.remove("invisible");
        container?.play();
      },
      destroy,
    };
  }
  catch (error) {
    destroy();
    throw error;
  }
}

/** 串行消费最新主题；切换/减动效/卸载均取消旧请求，过期结果永不播放。 */
export function createParticleController(mount: (theme: ThemeId, signal: AbortSignal) => Promise<ParticleLayer | undefined>) {
  let desired: ThemeId | null = null;
  let disposed = false;
  let running = false;
  let active: ParticleLayer | undefined;
  let request: AbortController | undefined;

  async function sync() {
    if (running)
      return;
    running = true;
    try {
      for (;;) {
        // 条件会在 await 期间由外部切换；每轮重新读取最新状态。
        if (disposed || desired === null)
          return;
        const pending = new AbortController();
        request = pending;
        let layer: ParticleLayer | undefined;
        try {
          layer = await mount(desired, pending.signal);
          if (disposed || pending.signal.aborted) {
            layer?.destroy();
            continue;
          }
          active = layer;
          active?.play();
          return;
        }
        catch {
          layer?.destroy();
          active = undefined;
          // 当前加载失败时静默降级；若已经切主题，继续处理最新请求。
          if (!pending.signal.aborted)
            return;
        }
      }
    }
    finally {
      running = false;
    }
  }

  return {
    setTheme(theme: ThemeId | null) {
      if (disposed || desired === theme)
        return;
      desired = theme;
      request?.abort();
      active?.destroy();
      active = undefined;
      void sync();
    },
    dispose() {
      disposed = true;
      desired = null;
      request?.abort();
      active?.destroy();
      active = undefined;
    },
  };
}
