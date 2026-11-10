import type { ReactNode } from "react";
import type { ThemeColors, ThemeId, ThemePreference } from "~/theme";
import { createContext, use, useEffect, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_THEME, parseThemePreference, THEME_COLORS, THEME_STORAGE_KEY } from "~/theme";

const CHANGE_EVENT = "fp-theme-change";
// 存储不可用时仍允许本标签页切换；服务端从不修改此变量。
let memoryPreference: ThemePreference | undefined;

function readPreference(): ThemePreference {
  if (memoryPreference !== undefined)
    return memoryPreference;
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  }
  catch {
    return DEFAULT_THEME;
  }
}

// 水合首轮与服务端一致；首屏颜色由 head 脚本和 CSS 变量先行决定。
function getServerSnapshot(): ThemePreference {
  return DEFAULT_THEME;
}

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = theme;
  const meta = document.querySelector<HTMLMetaElement>("meta[name=\"theme-color\"]");
  if (meta)
    meta.content = THEME_COLORS[theme].bg;
}

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY)
      return;
    memoryPreference = undefined;
    callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function setPreference(value: ThemePreference) {
  const preference = parseThemePreference(value);
  memoryPreference = preference;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }
  catch { /* 隐私模式拒绝持久化时，本标签页的选择仍然有效。 */ }
  applyTheme(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

interface AppThemeValue {
  theme: ThemeId;
  preference: ThemePreference;
  colors: ThemeColors;
  setPreference: (preference: ThemePreference) => void;
}

const AppThemeContext = createContext<AppThemeValue>({
  theme: DEFAULT_THEME,
  preference: DEFAULT_THEME,
  colors: THEME_COLORS[DEFAULT_THEME],
  setPreference: () => {},
});

/** 切换只更新上下文与变量，不换子树 key，保留输入、弹窗和路由状态。 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, readPreference, getServerSnapshot);
  const value = useMemo<AppThemeValue>(() => ({
    preference,
    theme: preference,
    colors: THEME_COLORS[preference],
    setPreference,
  }), [preference]);
  useEffect(() => {
    // 首轮水合使用默认深色快照；重读偏好，避免覆盖 head 已恢复的手动浅色。
    applyTheme(readPreference());
  }, [preference]);
  return <AppThemeContext value={value}>{children}</AppThemeContext>;
}

export function useAppTheme(): AppThemeValue {
  return use(AppThemeContext);
}
