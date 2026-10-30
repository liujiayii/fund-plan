/**
 * 全站公告 —— 类型、校验、KV 值解析与显隐脚本的纯函数。
 *
 * 为什么放 domain：校验/解析规则被 service（KV 读写）、组件（显隐脚本）
 * 和测试三方共用，抽成纯函数才能 node 单测，也符合「先 domain 后接线」的分层纪律。
 *
 * 存储形态：KV 单 key JSON（ANNOUNCEMENT_KV_KEY）；version 是保存时的毫秒时间戳，客户端拿它记忆「关过没」，
 * admin 每次保存版本必变，冷却中的用户会立刻重新看到新公告。
 */

/** 公告中/英文各自的最大字符数（横幅不是文章，超长拒绝保存） */
export const ANNOUNCEMENT_MAX_CHARS = 500;

/** 公告 KV key（service 层读写都用它） */
export const ANNOUNCEMENT_KV_KEY = "site:announcement";

/** 浏览器端记忆「已关闭」的 localStorage key */
export const DISMISS_STORAGE_KEY = "fp:notice:dismissed";

/** 关闭后挂在 <html> 上的类；app/styles/announcement.css 据此整条隐藏横幅 */
export const NOTICE_OFF_CLASS = "fp-notice-off";

/** 横幅元素 id（内联脚本与组件靠它对上） */
export const ANNOUNCEMENT_ELEMENT_ID = "fp-announcement";

/** 关闭冷却默认天数（2026-10-30 定：默认 1 天，admin 可改 0~30） */
export const ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS = 1;

/** 冷却天数上限（横幅是常驻提示不是一次性弹窗，太久等于永久关闭） */
export const ANNOUNCEMENT_MAX_COOLDOWN_DAYS = 30;

const DAY_MS = 86_400_000;

/** 编辑页提交的原始输入（zh/en 未 trim，cooldownDays 来自表单） */
export interface AnnouncementInput {
  enabled: boolean;
  zh: string;
  en: string;
  /** 关闭后多少天内不再显示；0 = 只对当前页面生效 */
  cooldownDays: number;
}

/** KV 里实际存的公告（zh/en 已 trim） */
export interface Announcement {
  enabled: boolean;
  zh: string;
  en: string;
  cooldownDays: number;
  /** 保存时的毫秒时间戳；每次保存必变 */
  version: number;
  updatedAt: number;
}

/**
 * 校验编辑输入。返回错误文案；null = 合法。
 * 规则：开着的时候中文必填（没有正文的开关没有意义）；关着时允许全空（草稿）。
 */
export function validateAnnouncementInput(input: AnnouncementInput): string | null {
  const zh = input.zh.trim();
  const en = input.en.trim();
  if (input.enabled && zh.length === 0)
    return "开启公告时中文内容必填";
  if (zh.length > ANNOUNCEMENT_MAX_CHARS)
    return `中文内容不能超过 ${ANNOUNCEMENT_MAX_CHARS} 字`;
  if (en.length > ANNOUNCEMENT_MAX_CHARS)
    return `英文内容不能超过 ${ANNOUNCEMENT_MAX_CHARS} 字`;
  if (
    !Number.isInteger(input.cooldownDays)
    || input.cooldownDays < 0
    || input.cooldownDays > ANNOUNCEMENT_MAX_COOLDOWN_DAYS
  ) {
    return `冷却天数需为 0~${ANNOUNCEMENT_MAX_COOLDOWN_DAYS} 的整数`;
  }
  return null;
}

/**
 * 解析 KV 原始值。任何不合法形态（null / 坏 JSON / 字段错型）一律返回 null，
 * 让上层静默降级成「无横幅」——公告是增强，绝不能因为数据坏而砸页面。
 * cooldownDays 缺失或越界时回退默认值（旧数据兼容）。
 */
export function parseAnnouncement(raw: string | null): Announcement | null {
  if (!raw)
    return null;

  let v: unknown;
  try {
    v = JSON.parse(raw);
  }
  catch {
    return null;
  }
  if (typeof v !== "object" || v === null)
    return null;

  const o = v as Record<string, unknown>;
  if (typeof o.enabled !== "boolean")
    return null;
  if (typeof o.zh !== "string")
    return null;
  if (typeof o.en !== "string")
    return null;
  if (typeof o.version !== "number" || !Number.isFinite(o.version))
    return null;

  return {
    enabled: o.enabled,
    zh: o.zh,
    en: o.en,
    cooldownDays:
      typeof o.cooldownDays === "number"
      && Number.isInteger(o.cooldownDays)
      && o.cooldownDays >= 0
      && o.cooldownDays <= ANNOUNCEMENT_MAX_COOLDOWN_DAYS
        ? o.cooldownDays
        : ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS,
    version: o.version,
    // updatedAt 缺失时回退 version——两者本就同时写，这只是容错
    updatedAt:
      typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
        ? o.updatedAt
        : o.version,
  };
}

/**
 * 关闭记录：`版本|关闭时刻`。管道分隔而不是 JSON——内联脚本里 split 一次就够，
 * 不用 JSON.parse；旧格式（纯版本号数字串）split 后第二段是 undefined，
 * Number(undefined)=NaN，冷却比较恒 false，自动回到「可见」，无需迁移。
 */
export function buildDismissRecord(version: number, now = Date.now()): string {
  return `${version}|${now}`;
}

/**
 * 给定关闭记录与横幅参数，判定该浏览器此刻是否应隐藏横幅。
 * 内联脚本（首帧前）与组件的 SPA 版本变化重估（CodeRabbit PR #114 指正：
 * 关闭类挂在 <html> 上整个文档生命周期有效，root loader 重校验拿到新版
 * 公告时必须按同一套规则重新判定，否则新版横幅要整页刷新才见天日）
 * 共用这一份判定，防止两处漂移。
 */
export function shouldHideForVersion(
  record: string | null,
  version: number,
  cooldownDays: number,
  now = Date.now(),
): boolean {
  const [v, t] = (record ?? "").split("|");
  return v === String(version) && now - Number(t) < cooldownDays * DAY_MS;
}

/**
 * 首帧前隐藏脚本：HTML 解析到横幅后立即执行——localStorage 记着当前版本的
 * 关闭动作、且距关闭时刻未过冷却期，就把 <html> 挂上关闭类，横幅在首帧渲染前
 * 被 CSS 藏掉（无闪烁、无 CLS）。冷却天数从横幅的 data-cooldown 属性读，
 * 脚本全文是静态串（key/id/类名/毫秒数从常量插值），不含任何用户输入。
 */
export function buildNoticeDismissScript(): string {
  const key = JSON.stringify(DISMISS_STORAGE_KEY);
  const id = JSON.stringify(ANNOUNCEMENT_ELEMENT_ID);
  const cls = JSON.stringify(NOTICE_OFF_CLASS);
  return `try{var el=document.getElementById(${id});if(el){var p=(localStorage.getItem(${key})||"").split("|");var c=Number(el.getAttribute("data-cooldown"));if(p[0]===el.getAttribute("data-version")&&Date.now()-Number(p[1])<c*${DAY_MS}){document.documentElement.classList.add(${cls})}}}catch(e){}`;
}
