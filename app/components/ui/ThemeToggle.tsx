import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Dropdown } from "antd";
import { useAppTheme } from "~/components/ThemeProvider";
import { parseThemePreference, THEME_LABELS } from "~/theme";

/** 游客与已登录用户共用的外观入口；紧凑形态用于手机顶栏。 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, theme, setPreference } = useAppTheme();
  const Icon = preference === "system" ? DesktopOutlined : theme === "graphite" ? MoonOutlined : SunOutlined;
  return (
    <Dropdown
      trigger={["click"]}
      placement={compact ? "bottomRight" : "topLeft"}
      menu={{
        selectable: true,
        selectedKeys: [preference],
        onClick: ({ key }) => setPreference(parseThemePreference(key)),
        items: [
          { key: "system", icon: <DesktopOutlined />, label: THEME_LABELS.system },
          { key: "ceramic", icon: <SunOutlined />, label: THEME_LABELS.ceramic },
          { key: "graphite", icon: <MoonOutlined />, label: THEME_LABELS.graphite },
        ],
      }}
    >
      <button
        type="button"
        aria-label={`切换主题，当前${THEME_LABELS[preference]}`}
        className={`fp-theme-toggle flex cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-transparent text-muted outline-none hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${compact ? "h-9 w-9 shrink-0" : "min-h-9 w-full px-2 py-1.5"}`}
      >
        <Icon className="text-base" />
        {!compact && (
          <span className="fp-sidebar-label text-xs">
            外观 ·
            {THEME_LABELS[preference]}
          </span>
        )}
      </button>
    </Dropdown>
  );
}
