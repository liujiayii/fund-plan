import type { Container, Engine } from "tsparticles-engine";
/**
 * 背景舞台（docs/liquid-glass.md §2.1，2026-10-22 修订）：全站唯一的固定衬底层，
 * 挂根布局 body 首位，壳层 .fp-shell（z-1）自然压在上面。
 *
 * 三件套（样式在 styles/backdrop.css）：网格 / 呼吸光晕 / 粒子画布。
 * 替代退役的漂移色雾（FogStage），接管「玻璃底下必须有东西可透」的衬底职责；
 * 三件套抄自 fund.tvmaze.cn 的背景层，转正时色值已 token 化（theme.ts 的
 * COLOR.backdropGrid / backdropGlow / particleA-C），浓度按本站底色调过一档。
 *
 * 实现要点（沿用源站 particles.js 验证过的纪律）：
 * - 库走 npm 包 tsparticles@2.12.0，package.json 用 -E **精确锁版本**：源站实测
 *   v3 会「canvas 存在但一个粒子都不画」（控制台零报错、极难排查），换版本前
 *   必须先做像素级验证；加载/渲染失败静默放弃，页面功能不受影响。
 * - 用 dynamic import（不进 SSR bundle、自动 code-split 成独立 chunk，
 *   首帧后按需加载）——等价于源站的 vendor script 注入，但版本进 lockfile、
 *   类型自带、少一段手写注入逻辑。注意 npm 包与 vendor bundle 初始化不同：
 *   bundle 把插件预先灌好挂在 window.tsParticles；npm 包是 engine 单例
 *   （tsparticles-engine）+ 主包 loadFull() 灌插件，两者产物等价。
 * - 粒子容器 pointer-events:none，hover 抓线 / 点击补粒子靠 detectsOn:'window'。
 * - prefers-reduced-motion 动态监听（matchMedia change）：开着页面中途切到
 *   「减少动态」也会把已创建的粒子撤下，切回来重画；URL 带 ?noparticles=1
 *   同样不上粒子。网格、光晕照渲染，各自的降级在 backdrop.css。
 * - SSR 直出空 div，水合零分歧；粒子全部在 useEffect 里挂，卸载时销毁。
 */
import { useEffect } from "react";
import { COLOR } from "~/theme";

const CONTAINER_ID = "fpBackdropParticles";

// 引擎单例只灌一次插件（loadFull ≈ vendor bundle 预执行的初始化）；
// 失败置回 null 允许下次重进页面重试
let enginePromise: Promise<Engine> | null = null;

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
    catch (err) {
      enginePromise = null;
      throw err;
    }
  })();
  return enginePromise;
}

/** 粒子配置：暗色板（站点 color-scheme 固定 dark）。三色出处 theme.ts 的 COLOR */
function particleOptions(): Record<string, unknown> {
  const small = window.innerWidth < 768; // 手机上少放点，省电
  return {
    fullScreen: { enable: false },
    background: { color: "transparent" },
    fpsLimit: 60,
    pauseOnBlur: true, // 切走标签页自动暂停
    detectRetina: true,
    particles: {
      number: { value: small ? 30 : 60, density: { enable: true, area: 900 } },
      color: { value: [COLOR.particleA, COLOR.particleB, COLOR.particleC] },
      shape: { type: "circle" },
      opacity: {
        value: { min: 0.18, max: 0.55 },
        animation: { enable: true, speed: 0.5, minimumValue: 0.12, sync: false },
      },
      size: { value: { min: 1, max: 3 } },
      links: { enable: true, distance: 150, color: COLOR.particleA, opacity: 0.18, width: 1 },
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
      detectsOn: "window", // 容器不接事件，交互挂 window 才生效
      events: {
        onHover: { enable: true, mode: "grab" },
        onClick: { enable: true, mode: "push" },
        resize: true,
      },
      modes: {
        grab: { distance: 170, links: { opacity: 0.35 } },
        push: { quantity: 3 },
      },
    },
  };
}

/** 清掉页面上所有已挂载的粒子容器（先清场再画，热更新/重复挂载不叠 canvas） */
function destroyAll(engine: Engine) {
  try {
    engine.dom().forEach(container => container.destroy());
  }
  catch {
    // 已销毁的容器再 destroy 会抛，忽略
  }
}

export function BackdropStage() {
  useEffect(() => {
    // 调试开关：不上粒子，网格与光晕照渲染（CSS 侧各自降级）
    if (new URLSearchParams(window.location.search).has("noparticles")) {
      return;
    }

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;
    let loaded: Container | undefined;

    // 上场/下场由「减动效偏好」动态决定：不只挂载时查一次——用户开着页面
    // 中途切到「减少动态」时，已创建的粒子也要撤下（WebKit 建议实践，
    // CodeRabbit PR #112 指正）；切回来再重画
    async function sync() {
      if (cancelled) {
        return;
      }
      if (motionQuery.matches) {
        loaded?.destroy();
        loaded = undefined;
        return;
      }
      try {
        const engine = await loadEngine();
        if (cancelled) {
          return;
        }
        destroyAll(engine);
        const container = await engine.load({ id: CONTAINER_ID, options: particleOptions() });
        // load 飞着的时候偏好切走或组件先卸了：拿到的容器直接销毁
        if (cancelled) {
          container?.destroy();
          return;
        }
        loaded = container;
      }
      catch {
        // 渲染失败不影响页面，背景少一层粒子而已
      }
    }

    sync();
    motionQuery.addEventListener("change", sync);
    return () => {
      cancelled = true;
      motionQuery.removeEventListener("change", sync);
      loaded?.destroy();
    };
  }, []);

  return (
    <div className="fp-backdrop" aria-hidden="true">
      <div className="fp-backdrop-grid" />
      <div className="fp-backdrop-glow" />
      <div id={CONTAINER_ID} className="fp-backdrop-particles" />
    </div>
  );
}
