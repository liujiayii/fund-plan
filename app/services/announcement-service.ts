import type { Announcement, AnnouncementInput } from "~/domain/announcement";
import {
  ANNOUNCEMENT_KV_KEY,
  parseAnnouncement,
  validateAnnouncementInput,
} from "~/domain/announcement";

/**
 * 公告的 KV 读写。
 *
 * 读路径有 30s isolate 内存缓存：root loader 每个请求都读公告，流量激增时
 * 这就是每 PV 一次 KV 读——内存缓存把同 isolate 的重复请求挡掉。
 * 读失败（KV 抖动/值损坏）静默降级为 null（无横幅），与 fund-data 的
 * safeGet 容错哲学一致；写失败则必须上抛——保存是主操作，不是旁路缓存。
 */

const MEMO_TTL_MS = 30_000;

let memo: { data: Announcement | null; at: number } | null = null;

/** 读当前公告；KV 不可用或值不合法时返回 null（无横幅） */
export async function readAnnouncement(env: Env): Promise<Announcement | null> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS)
    return memo.data;

  let data: Announcement | null = null;
  try {
    data = parseAnnouncement(await env.KV.get(ANNOUNCEMENT_KV_KEY));
  }
  catch {
    data = null;
  }

  memo = { data, at: Date.now() };
  return data;
}

/**
 * 保存公告（编辑页 action 专用）。version 取保存时刻，客户端「已关闭」的记忆
 * 随之失效——改了内容就该让用户重新看到。校验不过或写失败原样上抛。
 */
export async function saveAnnouncement(
  env: Env,
  input: AnnouncementInput,
): Promise<Announcement> {
  const invalid = validateAnnouncementInput(input);
  if (invalid)
    throw new Error(invalid);

  const now = Date.now();
  const notice: Announcement = {
    enabled: input.enabled,
    zh: input.zh.trim(),
    en: input.en.trim(),
    cooldownDays: input.cooldownDays,
    version: now,
    updatedAt: now,
  };
  await env.KV.put(ANNOUNCEMENT_KV_KEY, JSON.stringify(notice));

  // 同 isolate 内立刻可见：admin 保存后刷新页面不该看到 30s 前的旧缓存
  invalidateAnnouncementMemo();
  return notice;
}

/** 清掉本 isolate 的公告内存缓存（保存后调用；测试隔离也用它） */
export function invalidateAnnouncementMemo(): void {
  memo = null;
}
