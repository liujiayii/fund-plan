import { LogoutOutlined, SettingOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Space } from "antd";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { NavButton } from "~/components/ui/NavButton";

export interface UserMenuProps {
  /** 根 loader 的当前用户；游客 null */
  user: { username: string; role: string } | null;
  /**
   * 紧凑形态（移动端品牌胶囊右侧）：只出头像，不出用户名。
   * 桌面侧栏底部用完整形态：头像 + 用户名 + 身份后缀
   */
  compact?: boolean;
}

/**
 * 登录态区域：已登录显示头像（+ 用户名）Dropdown（设置 / 登出），
 * 游客显示登录 / 注册按钮。
 *
 * 从 root.tsx 顶栏抽出来的原因：液态玻璃壳里它要出现在两处
 * （桌面侧栏底 / 移动端品牌胶囊右侧），逐字复制会两份漂移。
 * 登出仍走 form post /logout（服务端清 session + 重定向的标准链路），
 * 隐藏表单由本组件自带，宿主不用再管。
 */
export function UserMenu({ user, compact }: UserMenuProps) {
  const navigate = useNavigate();
  const logoutFormRef = useRef<HTMLFormElement>(null);

  if (!user) {
    return (
      <Space size={8}>
        <NavButton size="small" to="/login">登录</NavButton>
        <NavButton size="small" type="primary" to="/register">注册</NavButton>
      </Space>
    );
  }

  // 用户名首字作头像文字（中文取第一字，英文取首字母大写）：DB 未存头像 URL
  const avatarText = /^[A-Z]/i.test(user.username)
    ? user.username[0].toUpperCase()
    : user.username[0];

  return (
    <>
      <Dropdown
        placement={compact ? "bottomRight" : "topLeft"}
        menu={{
          items: [
            {
              key: "settings",
              icon: <SettingOutlined />,
              label: "设置",
              // 设置页全站唯一入口，SPA 跳转
              onClick: () => navigate("/me/settings"),
            },
            {
              key: "logout",
              icon: <LogoutOutlined />,
              label: "登出",
              onClick: () => logoutFormRef.current?.requestSubmit(),
            },
          ],
        }}
      >
        {/* 触发区：min-w-0 让长用户名在侧栏里能省略而不撑宽轨；
            手写 button 没有默认焦点环可依赖，focus-visible 环自己给（宪法 §2.4） */}
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-full border-0 bg-transparent p-1 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label="用户菜单"
        >
          <Avatar size={28} className="shrink-0 bg-primary">{avatarText}</Avatar>
          {!compact && (
            <span className="fp-sidebar-label min-w-0 truncate text-sm" title={user.username}>
              {user.username}
              {user.role === "admin" ? "（主理人）" : ""}
            </span>
          )}
        </button>
      </Dropdown>
      {/* 登出表单：视觉隐藏，仅供菜单项触发 submit */}
      <form ref={logoutFormRef} method="post" action="/logout" className="hidden" />
    </>
  );
}
