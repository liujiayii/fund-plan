import type { ReactNode } from "react";
import { BAR_SHADOW, COLOR } from "~/theme";

export interface BottomActionBarProps {
  /** 操作按钮组。按钮本体与禁用逻辑由调用方组装（卖出/买入/定投…各页语义不同） */
  actions: ReactNode;
  /** 说明小字（费用口径提示等），左侧信息位；超两行截断 */
  note?: ReactNode;
}

/**
 * 页底固定操作条（2026-09-09 美化版）。桌面上与 GitHub 合并请求页的 bottom bar
 * 同款：全宽贴底 + 朝上阴影抬升；移动端叠在 fp-tabbar 上方（不盖底部导航）。
 *
 * 布局 = 左右双列：note 占左侧信息位（flex:1 + 两行截断），按钮组固定右侧。
 * 无 note 时按钮仍靠右（空占位撑着）。条高因此恒定 72px（16×2 padding +
 * large 按钮 40），不再随 note 有无跳变——旧版 note 叠在按钮上方，条高
 * 64→85 来回跳、note 文案悬空没有对齐轴，是这次美化的主因。
 *
 * 结构 = 文档流占位 + 固定条：
 * 占位块撑出与条等高的空间，调用方页面无需手补 padding；
 * 移动端 tabbar 的让位由 fp-content 既有底 padding（56px+safe-area）负责。
 *
 * 定位属性（left/right/bottom/z-index）全部交给 responsive.css 的
 * .fp-bottom-bar（桌面 bottom:0，窄屏 bottom 偏移 tabbar 高度）——
 * inline style 斗不过类选择器，干脆不写，与 fp-tabbar 同手法。
 */
export function BottomActionBar({ actions, note }: BottomActionBarProps) {
  return (
    <>
      {/* 文档流占位：height 72 = padding 16×2 + 按钮 large 40（条高恒定，
          responsive.css 的 .fp-footer-bar-clear 让位 88px 依然罩得住） */}
      <div style={{ height: 72 }} aria-hidden />
      <div
        className="fp-bottom-bar"
        style={{
          background: COLOR.card,
          // 抬升感走朝上阴影（token 唯一出处 theme.ts），生硬的顶边框退役
          boxShadow: BAR_SHADOW,
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          {/* 左侧信息位：note 两行截断——窄屏下长文案把条撑高的老问题就此封顶 */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: COLOR.textSecondary,
              lineHeight: 1.6,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {note}
          </div>
          {/* 右侧按钮组：不收缩，note 再长也不挤压操作 */}
          <div style={{ flexShrink: 0 }}>{actions}</div>
        </div>
      </div>
    </>
  );
}
