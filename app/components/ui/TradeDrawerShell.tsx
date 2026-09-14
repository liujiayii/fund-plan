import type { ReactNode } from "react";
import { CloseOutlined } from "@ant-design/icons";
import { Drawer } from "antd";
import { useIsMobile } from "~/hooks/useIsMobile";

export interface TradeDrawerShellProps {
  /** 开合受控：true 展开 */
  open: boolean;
  /** 请求关闭（点遮罩 / ESC / 头部关闭钮 / 提交成功后自动调） */
  onClose: () => void;
  /** 动作标签（pill 文案）：买入 / 卖出 / 定投 */
  actionLabel: string;
  /** pill 色调：primary=紫（买/定投），danger=红（卖出/赎回，同确认按钮语义） */
  tone: "primary" | "danger";
  /** 基金名（头部主标题） */
  fundName: string;
  /** 基金代码（头部副标题，等宽字体） */
  fundCode: string;
  /** 抽屉层级。默认 1000；内部还要弹 Modal 的（定投）压到 900 */
  zIndex?: number;
  /** 面板内容（BuyPanel / SellPanel / DcaFundPanel） */
  children: ReactNode;
}

/**
 * 交易抽屉共享壳（2026-09-14）：买入 / 卖出 / 定投三个抽屉的统一外观。
 *
 * 杀掉的是 antd 默认 header 的「后台管理系统脸」（粗标题 + × + 1px 灰
 * 分割线），换成 App 式自绘头部——动作 pill + 基金名大字 + 代码小字 +
 * 圆形关闭钮，与 MobileNavDrawer 同款范式（closable=false + body padding 0
 * 接管排版）。移动端底部弹层顶部加把手条（App 底弹层的通用语言）。
 *
 * 几何沿用旧三个抽屉的约定：桌面右侧 400px / 移动端底部 88%（面板整高
 * 约 600px，留出顶部透气，超高内容在内容区自滚动——头部钉住不跟滚）。
 * 宽高不传 props（antd v6 已弃用 width/height，size 又只有固定档位），
 * 交给 responsive.css §4.7 的 .fp-trade-drawer——同 .fp-nav-drawer 手法。
 * 材料不用自己挂：liquid-glass.css §5 已给所有 .ant-drawer-section 铺玻璃。
 * destroyOnHidden 统一收在本壳：关掉即卸载 DOM，重开是全新面板
 * （三个交易面板的输入/fetcher 状态全靠它重置，无一例外）。
 */
export function TradeDrawerShell({
  open,
  onClose,
  actionLabel,
  tone,
  fundName,
  fundCode,
  zIndex,
  children,
}: TradeDrawerShellProps) {
  const isMobile = useIsMobile();

  // 卖出的 danger 红是动作语义（同确认按钮 type="primary" danger），
  // 与涨跌红不同源；淡底 + 实色字，避免大色块喊得太响
  const pillCls = tone === "danger"
    ? "bg-[rgba(255,77,79,0.12)] text-[#ff4d4f]"
    : "bg-primary-bg text-primary";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      placement={isMobile ? "bottom" : "right"}
      zIndex={zIndex}
      rootClassName="fp-trade-drawer"
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
      // 无障碍名称：壳自绘头部（closable=false 干掉了 antd 的 title 轴），
      // 读屏软件需要 aria-label 才能把弹层念成「买入 华田XX」而不是无名
      // 对话框（CodeRabbit PR #93 指正）
      aria-label={`${actionLabel} ${fundName}`}
    >
      <div className="flex h-full flex-col">
        {/* 头部：把手（仅窄屏底弹层）+ 动作 pill / 基金名 / 关闭钮 */}
        <div className="px-5 pt-3 pb-1">
          {/* 底弹层把手：36×4 圆条，App 通用语言；fp-mobile 在 768+ 隐藏 */}
          <div className="fp-mobile mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" />
          <div className="flex items-center justify-between gap-3">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pillCls}`}>
              {actionLabel}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label="关闭"
            >
              <CloseOutlined className="text-lg leading-none" />
            </button>
          </div>
          {/* 基金名 + 代码：名为主标题（truncate 防长名撑爆），代码等宽小字 */}
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="truncate text-lg font-bold text-ink">{fundName}</span>
            <span className="shrink-0 text-xs text-muted font-num">{fundCode}</span>
          </div>
        </div>

        {/* 面板内容区：超高时这里自滚动（overflow-y-auto），头部钉住不跟滚 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {children}
        </div>
      </div>
    </Drawer>
  );
}
