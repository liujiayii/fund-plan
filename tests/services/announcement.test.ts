import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ANNOUNCEMENT_KV_KEY, parseAnnouncement } from "~/domain/announcement";
import {
  invalidateAnnouncementMemo,
  readAnnouncement,
  saveAnnouncement,
} from "~/services/announcement-service";

/**
 * 公告 KV 读写集成测试：真实 workerd + 真实 KV 绑定
 * （vitest.workers.config.ts 的 kvNamespaces: ["KV"]）。
 * admin 权限拦截由 tests/services/guard.test.ts 的 requireAdmin 用例把守，
 * 这里不重复；路由 action 的权限纪律（requireAdmin 在 try 外）靠 code review。
 */
describe("announcement service", () => {
  beforeEach(async () => {
    await env.KV.delete(ANNOUNCEMENT_KV_KEY);
    // 内存缓存是 isolate 级的：用例间清掉，避免前一个用例的值漏到下一个
    invalidateAnnouncementMemo();
  });

  it("从没设置过 → null", async () => {
    await expect(readAnnouncement(env)).resolves.toBeNull();
  });

  it("save → read 往返（含冷却天数）", async () => {
    const saved = await saveAnnouncement(env, {
      enabled: true,
      zh: "流量较大",
      en: "High traffic",
      cooldownDays: 3,
    });
    expect(saved.version).toBeGreaterThan(0);
    expect(saved.zh).toBe("流量较大");
    expect(saved.cooldownDays).toBe(3);
    await expect(readAnnouncement(env)).resolves.toEqual(saved);
  });

  it("保存会失效内存缓存（同 isolate 立刻可见新值）", async () => {
    await saveAnnouncement(env, { enabled: true, zh: "v1", en: "", cooldownDays: 1 });
    await saveAnnouncement(env, { enabled: true, zh: "v2", en: "", cooldownDays: 1 });
    await expect(readAnnouncement(env)).resolves.toMatchObject({ zh: "v2" });
  });

  it("KV 原始值形态能被 parseAnnouncement 解析", async () => {
    await saveAnnouncement(env, { enabled: false, zh: "", en: "", cooldownDays: 0 });
    const raw = await env.KV.get(ANNOUNCEMENT_KV_KEY);
    expect(parseAnnouncement(raw)?.enabled).toBe(false);
  });

  it("校验不过 → 上抛且不写 KV", async () => {
    await expect(
      saveAnnouncement(env, { enabled: true, zh: "   ", en: "", cooldownDays: 1 }),
    ).rejects.toThrow("开启公告时中文内容必填");
    await expect(
      saveAnnouncement(env, { enabled: true, zh: "a", en: "", cooldownDays: 99 }),
    ).rejects.toThrow("冷却天数");
    await expect(readAnnouncement(env)).resolves.toBeNull();
  });

  it("KV 值损坏 → read 静默降级 null，不抛", async () => {
    await env.KV.put(ANNOUNCEMENT_KV_KEY, "{oops");
    invalidateAnnouncementMemo();
    await expect(readAnnouncement(env)).resolves.toBeNull();
  });
});
