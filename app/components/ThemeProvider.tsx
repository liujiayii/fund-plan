import type { ReactNode } from "react";
import type { ThemeColors, ThemeId, ThemePreference } from "~/theme";
import { createContext, use, useEffect, useMemo, useSyncExternalStore } from "react";
import { parseThemePreference, resolveTheme, THEME_COLORS, THEME_STORAGE_KEY } from "~/theme";

const CHANGE_EVENT = "fp-theme-change";
// 存储不可用时仍允许本标签页切换；服务端从不修改此变量。
let memoryPreference: ThemePreference | undefined;

function systemIsDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  catch {
    return false;
  }
}

function readPreference(): ThemePreference {
  if (memoryPreference !== undefined)
    return memoryPreference;
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  }
  catch {
    return "system";
  }
}

function getSnapshot(): string {
  const preference = readPreference();
  return `${preference}:${resolveTheme(preference, systemIsDark())}`;
}

// 水合首轮与服务端一致；首屏颜色由 head 脚本和 CSS 变量先行决定。
function getServerSnapshot(): string {
  return "system:ceramic";
}

function applyTheme(preference: ThemePreference, theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  const meta = document.querySelector<HTMLMetaElement>("meta[name=\"theme-color\"]");
  if (meta)
    meta.content = THEME_COLORS[theme].bg;
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY)
      return;
    memoryPreference = undefined;
    callback();
  };
  media.addEventListener("change", callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function setPreference(value: ThemePreference) {
  const preference = parseThemePreference(value);
  memoryPreference = preference;
  try {
    if (preference === "system")
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }
  catch { /* 隐私模式拒绝持久化时，本标签页的选择仍然有效。 */ }
  applyTheme(preference, resolveTheme(preference, systemIsDark()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

interface AppThemeValue {
  theme: ThemeId;
  preference: ThemePreference;
  colors: ThemeColors;
  setPreference: (preference: ThemePreference) => void;
}

const AppThemeContext = createContext<AppThemeValue>({
  theme: "ceramic",
  preference: "system",
  colors: THEME_COLORS.ceramic,
  setPreference: () => {},
});

/** 切换只更新上下文与变量，不换子树 key，保留输入、弹窗和路由状态。 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const value = useMemo<AppThemeValue>(() => {
    const [saved, active] = snapshot.split(":");
    const preference = parseThemePreference(saved);
    const theme: ThemeId = active === "graphite" ? "graphite" : "ceramic";
    return { preference, theme, colors: THEME_COLORS[theme], setPreference };
  }, [snapshot]);
  useEffect(() => {
    // 水合第一轮仍是服务端快照；读取当下偏好，不能覆盖 head 已经选好的深色。
    const preference = readPreference();
    applyTheme(preference, resolveTheme(preference, systemIsDark()));
  }, [value.preference, value.theme]);
  return <AppThemeContext value={value}>{children}</AppThemeContext>;
}

export function useAppTheme(): AppThemeValue {
  return use(AppThemeContext);
}
