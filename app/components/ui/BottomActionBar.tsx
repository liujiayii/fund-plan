import type { ReactNode } from "react";
import { COLOR } from "~/theme";

export interface BottomActionBarProps {
  /** 操作按钮组。按钮本体与禁用逻辑由调用方组装（卖出/买入/定投…各页语义不同） */
  actions: ReactNode;
  /** 说明小字（费用口径提示等），单行溢出省略 */
  note?: ReactNode;
}

/**
 * 页底固定操作条。桌面上与 GitHub pr 页的 bottom bar 同款：全宽白底 + 顶边框，
 * 内容层与 fp-content 同宽对齐；移动端叠在 fp-tabbar 上方（不盖底部导航）。
 *
 * 结构 = 文档流占位 + fixed 条：
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
      {/* 文档流占位：min-height 64 = 按钮 large 40 + 上下 padding 12×2。
          note 单行省略，条高可控，占位高度恒成立 */}
      <div style={{ height: 64 }} aria-hidden />
      <div
        className="fp-bottom-bar"
        style={{ background: COLOR.card, borderTop: `1px solid ${COLOR.border}` }}
      >
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "12px 24px" }}>
          {note !== undefined && (
            <div
              style={{
                fontSize: 12,
                color: COLOR.textSecondary,
                marginBottom: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {note}
            </div>
          )}
          {actions}
        </div>
      </div>
    </>
  );
}
