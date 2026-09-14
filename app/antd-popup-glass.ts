import type { ConfigProviderProps } from "antd";

/**
 * 弹层玻璃的 semantic 配置（2026-09-14 主人拍板弃 CSS 类名通道后定稿）。
 *
 * 为什么要独立文件：root.tsx 的 ConfigProvider 与 DOM 守卫测试
 * （tests/domain/popup-glass-dom.test.ts）共用这一份真相——配置改了
 * 测试自动跟着跑，永不漂移。
 *
 * 历史教训：v5→v6 antd 内部面板节点两次改名（drawer content→section、
 * modal content 节点取消），钉旧类名的 CSS 规则静默失效、弹层裸奔，
 * Modal 裸奔了整个 v6 早期才被主人验收抓出。semantic classNames 是
 * 官方 API——antd 亲手把类挂到面板节点，类名叫什么它说了算。
 *
 * - Modal：container = 面板节点；圆角 22（弹窗档，宪法 §2.2 角色表）
 * - Drawer：section = 面板节点（v6 叫法）；圆角按 placement 在
 *   liquid-glass.css §5 分叉（bottom 顶角 22 / right 贴边不圆）
 * - Select：popup.root = 下拉浮层；圆角 12（下拉档）
 * - Dropdown 无 popup 级 semantic（只有 root/item），仍走 CSS 类名，
 *   是 liquid-glass.css §5 的独苗
 */
export const POPUP_GLASS = {
  modal: { classNames: { container: "fp-glass" }, styles: { container: { borderRadius: 22 } } },
  drawer: { classNames: { section: "fp-glass" } },
  select: { classNames: { popup: { root: "fp-glass" } }, styles: { popup: { root: { borderRadius: 12 } } } },
} satisfies Partial<ConfigProviderProps>;
