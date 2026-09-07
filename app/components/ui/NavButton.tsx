import type { ButtonProps } from "antd";
import { Button } from "antd";
import { useNavigate } from "react-router";

export interface NavButtonProps extends ButtonProps {
  /** 跳转目标路径（可含查询串，如 /me/holdings/000001?tab=trade） */
  to: string;
}

/**
 * SPA 导航按钮：antd Button 的客户端路由包装。
 *
 * 手法：保留 href 原生锚点，只拦截「无修饰键的普通左键」走 navigate()——
 * 中键/⌘/Ctrl+点新开标签、无 JS 时的整页跳转兜底、SEO 全部无损。
 *
 * ⚠️ 目标为 / 与 /master 的链接**不要**用本组件：这两页游客态走边缘缓存
 * （x-fp-cache），整页跳转才能命中；SPA 跳转拉 .data 请求不进缓存、
 * 回源跑 D1 查询反而变慢（spec 决策，详见 .superpowers/specs/
 * 2026-09-07-navigation-spa-refactor-design.md）。
 */
export function NavButton({ to, onClick, ...rest }: NavButtonProps) {
  const navigate = useNavigate();
  return (
    <Button
      {...rest}
      href={to}
      onClick={(e) => {
        onClick?.(e);
        // 修饰键/非左键点击放行浏览器默认行为（新标签打开等）
        if (
          e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey
          || e.altKey || e.button !== 0
        ) {
          return;
        }
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
