import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Dropdown } from "antd";
import { useAppTheme } from "~/components/ThemeProvider";
import { parseThemePreference, THEME_LABELS } from "~/theme";

/** 侧栏与手机顶部共用图标入口，完整主题名称只在提示和选择菜单里展示。 */
export function ThemeToggle() {
  const { preference, theme, setPreference } = useAppTheme();
  const Icon = theme === "graphite" ? MoonOutlined : SunOutlined;
  const label = `切换主题，当前${THEME_LABELS[preference]}`;
  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        selectable: true,
        selectedKeys: [preference],
        onClick: ({ key }) => setPreference(parseThemePreference(key)),
        items: [
          { key: "ceramic", icon: <SunOutlined />, label: THEME_LABELS.ceramic },
          { key: "graphite", icon: <MoonOutlined />, label: THEME_LABELS.graphite },
        ],
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        title={label}
        className="fp-theme-toggle flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted outline-none transition-colors hover:bg-well hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon className="text-base" aria-hidden />
      </button>
    </Dropdown>
  );
}
