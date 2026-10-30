import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS,
  ANNOUNCEMENT_MAX_CHARS,
  buildDismissRecord,
  buildNoticeDismissScript,
  parseAnnouncement,
  shouldHideForVersion,
  validateAnnouncementInput,
} from "~/domain/announcement";

describe("validateAnnouncementInput", () => {
  it("开启时中文必填", () => {
    expect(
      validateAnnouncementInput({ enabled: true, zh: "  ", en: "", cooldownDays: 1 }),
    ).toBe("开启公告时中文内容必填");
  });

  it("关闭时允许全空（草稿）", () => {
    expect(
      validateAnnouncementInput({ enabled: false, zh: "", en: "", cooldownDays: 1 }),
    ).toBeNull();
  });

  it("正常内容合法", () => {
    expect(
      validateAnnouncementInput({
        enabled: true,
        zh: "流量较大",
        en: "High traffic",
        cooldownDays: 1,
      }),
    ).toBeNull();
  });

  it("中英文各自限长", () => {
    const long = "x".repeat(ANNOUNCEMENT_MAX_CHARS + 1);
    expect(
      validateAnnouncementInput({ enabled: true, zh: long, en: "", cooldownDays: 1 }),
    ).toContain("中文");
    expect(
      validateAnnouncementInput({ enabled: true, zh: "ok", en: long, cooldownDays: 1 }),
    ).toContain("英文");
  });

  it("冷却天数必须是 0~30 的整数", () => {
    expect(
      validateAnnouncementInput({ enabled: true, zh: "a", en: "", cooldownDays: 0 }),
    ).toBeNull();
    expect(
      validateAnnouncementInput({ enabled: true, zh: "a", en: "", cooldownDays: 31 }),
    ).toContain("冷却天数");
    expect(
      validateAnnouncementInput({ enabled: true, zh: "a", en: "", cooldownDays: -1 }),
    ).toContain("冷却天数");
    expect(
      validateAnnouncementInput({ enabled: true, zh: "a", en: "", cooldownDays: 1.5 }),
    ).toContain("冷却天数");
    expect(
      validateAnnouncementInput({
        enabled: true,
        zh: "a",
        en: "",
        cooldownDays: Number.NaN,
      }),
    ).toContain("冷却天数");
  });
});

describe("parseAnnouncement", () => {
  const good = {
    enabled: true,
    zh: "公告",
    en: "Notice",
    cooldownDays: 3,
    version: 1730270000000,
    updatedAt: 1730270000000,
  };

  it("null / 空串 → null", () => {
    expect(parseAnnouncement(null)).toBeNull();
    expect(parseAnnouncement("")).toBeNull();
  });

  it("坏 JSON → null（静默降级，不抛）", () => {
    expect(parseAnnouncement("{oops")).toBeNull();
  });

  it("合法 JSON 原样解析", () => {
    expect(parseAnnouncement(JSON.stringify(good))).toEqual(good);
  });

  it("字段错型 → null", () => {
    expect(parseAnnouncement(JSON.stringify({ ...good, enabled: "yes" }))).toBeNull();
    expect(parseAnnouncement(JSON.stringify({ ...good, zh: 1 }))).toBeNull();
    expect(parseAnnouncement(JSON.stringify({ ...good, version: "1" }))).toBeNull();
  });

  it("cooldownDays 缺失或越界 → 回退默认值（旧数据兼容）", () => {
    const { cooldownDays: _drop, ...rest } = good;
    expect(parseAnnouncement(JSON.stringify(rest))?.cooldownDays).toBe(
      ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS,
    );
    expect(parseAnnouncement(JSON.stringify({ ...good, cooldownDays: 99 }))?.cooldownDays).toBe(
      ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS,
    );
  });

  it("updatedAt 缺失回退 version", () => {
    const { updatedAt: _drop, ...rest } = good;
    expect(parseAnnouncement(JSON.stringify(rest))?.updatedAt).toBe(good.version);
  });
});

describe("buildDismissRecord", () => {
  it("格式为 `版本|时刻`，供内联脚本 split 解析", () => {
    expect(buildDismissRecord(1730270000000, 1730270060000)).toBe("1730270000000|1730270060000");
  });
});

describe("shouldHideForVersion", () => {
  const version = 1730270000000;
  const now = 1730270000000 + 3600_000;

  it("同版本且冷却期内 → true", () => {
    const record = buildDismissRecord(version, 1730270000000);
    expect(shouldHideForVersion(record, version, 1, now)).toBe(true);
  });

  it("版本不同 → false（admin 改内容立刻重现）", () => {
    const record = buildDismissRecord(version, 1730270000000);
    expect(shouldHideForVersion(record, version + 1, 1, now)).toBe(false);
  });

  it("冷却已过 → false", () => {
    const record = buildDismissRecord(version, 1730270000000);
    expect(shouldHideForVersion(record, version, 1, 1730270000000 + 2 * 86_400_000)).toBe(false);
  });

  it("旧格式（纯版本号，无时刻段）→ false（自动兼容回可见）", () => {
    expect(shouldHideForVersion(String(version), version, 1, now)).toBe(false);
  });

  it("无记录 / null → false", () => {
    expect(shouldHideForVersion(null, version, 1, now)).toBe(false);
    expect(shouldHideForVersion("", version, 1, now)).toBe(false);
  });
});

describe("buildNoticeDismissScript", () => {
  it("静态脚本：含 storage key、元素 id、关闭类、版本与冷却属性，且 try 包裹", () => {
    const s = buildNoticeDismissScript();
    expect(s).toContain("\"fp:notice:dismissed\"");
    expect(s).toContain("\"fp-announcement\"");
    expect(s).toContain("\"fp-notice-off\"");
    expect(s).toContain("data-version");
    expect(s).toContain("data-cooldown");
    expect(s).toContain("86400000");
    expect(s.startsWith("try{")).toBe(true);
  });
});
