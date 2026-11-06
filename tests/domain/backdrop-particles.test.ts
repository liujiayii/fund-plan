import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createParticleController, particleOptions } from "../../app/components/backdrop-particles";
import { BackdropStage } from "../../app/components/BackdropStage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 8; i++)
    await Promise.resolve();
}

describe("背景粒子配置", () => {
  it.each([
    { theme: "ceramic" as const, colors: ["#305BDC", "#5796B8", "#7EA7D6"] },
    { theme: "graphite" as const, colors: ["#D3BD93", "#A5CDE8", "#729DBC"] },
  ])("$theme 把实际三色交给 canvas，连线与悬停抓线使用同一主色", ({ theme, colors }) => {
    const options = particleOptions(theme, 1280);
    expect(options.particles?.color).toEqual({ value: colors });
    expect(options.particles?.links).toMatchObject({ enable: true, color: colors[0] });
    expect(options.interactivity?.modes?.grab).toMatchObject({ links: { color: colors[0] } });
  });

  it("窄屏减少粒子，低速漂移保留抓线/点击补粒子且切后台暂停", () => {
    const desktop = particleOptions("ceramic", 1280);
    const mobile = particleOptions("ceramic", 390);
    expect(mobile.particles?.number).toMatchObject({ value: 30 });
    expect(desktop.particles?.number).toMatchObject({ value: 60 });
    expect(desktop.pauseOnBlur).toBe(true);
    expect(desktop.autoPlay).toBe(false);
    expect(desktop.fullScreen).toEqual({ enable: false });
    expect(desktop.particles?.move).toMatchObject({ enable: true, speed: 0.7 });
    expect(desktop.interactivity).toMatchObject({
      detectsOn: "window",
      events: { onHover: { enable: true, mode: "grab" }, onClick: { enable: true, mode: "push" } },
      modes: { push: { quantity: 3 } },
    });
  });

  it("SSR 保留光带与空粒子容器，不创建 canvas 或读取浏览器环境", () => {
    const html = renderToStaticMarkup(createElement(BackdropStage));
    expect(html).toContain("fp-backdrop-ribbon");
    expect(html).toContain("class=\"fp-backdrop-particles\"");
    expect(html).toContain("aria-hidden=\"true\"");
    expect(html).not.toContain("<canvas");
  });
});

describe("背景粒子异步生命周期", () => {
  // 延迟的外部引擎只模拟创建边界；控制器、取消信号与资源所有权使用真实代码。
  function fixture() {
    const requests: { theme: string; signal: AbortSignal; task: ReturnType<typeof deferred<ReturnType<typeof layer>>> }[] = [];
    const visible = new Set<string>();
    const destroyed = new Set<string>();
    function layer(id: string) {
      return {
        play: () => { visible.add(id); },
        destroy: () => {
          visible.delete(id);
          destroyed.add(id);
        },
      };
    }
    const controller = createParticleController((theme, signal) => {
      const task = deferred<ReturnType<typeof layer>>();
      requests.push({ theme, signal, task });
      return task.promise;
    });
    return { requests, visible, destroyed, layer, controller };
  }

  it("加载中连续切 A/B 只串行创建最新主题，旧容器从不开始播放", async () => {
    const f = fixture();
    f.controller.setTheme("ceramic");
    f.controller.setTheme("graphite");
    f.controller.setTheme("ceramic");
    f.controller.setTheme("graphite");
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].signal.aborted).toBe(true);
    f.requests[0].task.resolve(f.layer("old"));
    await flush();
    expect(f.destroyed).toContain("old");
    expect(f.visible.size).toBe(0);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].theme).toBe("graphite");
    f.requests[1].task.resolve(f.layer("current"));
    await flush();
    expect([...f.visible]).toEqual(["current"]);
    f.controller.dispose();
    expect(f.visible.size).toBe(0);
  });

  it("减少动态立即撤掉已播放容器，恢复后可重新创建", async () => {
    const f = fixture();
    f.controller.setTheme("ceramic");
    f.requests[0].task.resolve(f.layer("first"));
    await flush();
    f.controller.setTheme(null);
    expect(f.visible.size).toBe(0);
    expect(f.destroyed).toContain("first");
    f.controller.setTheme("ceramic");
    f.requests[1].task.resolve(f.layer("resumed"));
    await flush();
    expect([...f.visible]).toEqual(["resumed"]);
    f.controller.dispose();
  });

  it("加载中减少动态，即使旧异步任务返回也不出现粒子", async () => {
    const f = fixture();
    f.controller.setTheme("graphite");
    f.controller.setTheme(null);
    expect(f.requests[0].signal.aborted).toBe(true);
    f.requests[0].task.resolve(f.layer("cancelled"));
    await flush();
    expect(f.visible.size).toBe(0);
    expect(f.destroyed).toContain("cancelled");
    expect(f.requests).toHaveLength(1);
    f.controller.dispose();
  });

  it("卸载取消未完成加载；旧实例返回时不销毁后来实例的容器", async () => {
    const old = fixture();
    old.controller.setTheme("ceramic");
    old.controller.dispose();
    const current = fixture();
    current.controller.setTheme("graphite");
    current.requests[0].task.resolve(current.layer("new"));
    await flush();
    old.requests[0].task.resolve(old.layer("old"));
    await flush();
    expect(old.requests[0].signal.aborted).toBe(true);
    expect(old.visible.size).toBe(0);
    expect([...current.visible]).toEqual(["new"]);
    current.controller.dispose();
  });

  it("上一主题加载失败后仍处理等待中的新主题，故障不成为未处理 rejection", async () => {
    const f = fixture();
    f.controller.setTheme("ceramic");
    f.controller.setTheme("graphite");
    f.requests[0].task.reject(new Error("engine load failed"));
    await flush();
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].theme).toBe("graphite");
    f.requests[1].task.resolve(f.layer("recovered"));
    await flush();
    expect([...f.visible]).toEqual(["recovered"]);
    f.controller.dispose();
  });
});
