import type { ReactNode } from "react";
import { COLOR } from "~/theme";

export interface BottomActionBarProps {
  /** 操作按钮组。按钮本体与禁用逻辑由调用方组装（卖出/买入/定投…各页语义不同） */
  actions: ReactNode;
  /** 说明小字（费用口径提示等），左侧信息位；超两行截断 */
  note?: ReactNode;
}

/**
 * 页底固定操作条（2026-09-09 美化版；2026-09-10 改吃液态玻璃）。桌面是
 * 悬浮玻璃卡（左右留缝与内容列对齐、四角 22），窄屏是底弹层同款形态
 * （全宽贴底 + 顶角 22）——2026-09-14 三改定稿：999 大圆角胶囊被主人
 * 验收枪毙（太臃肿），22 顶角与 .ant-drawer-bottom 同一语言，柔而不圆。
 * 材料是 .fp-glass（宪法层级 3 的铬，不加 specular——操作条不是门面）。
 *
 * 布局 = 左右双列：note 占左侧信息位（flex:1 + 两行截断），按钮组固定右侧。
 * 无 note 时按钮仍靠右（空占位撑着）。条高因此恒定 72px（16×2 padding +
 * large 按钮 40），不再随 note 有无跳变——旧版 note 叠在按钮上方，条高
 * 64→85 来回跳、note 文案悬空没有对齐轴，是当年美化的主因。
 * （窄屏例外：条内改纵向排——note 不截断全展示在上（主人 2026-09-14
 * 验收拍板，别再改成省略）、按钮组撑满在下，条高随 note 行数浮动
 * 64（无 note）~130（3 行），几何全在 responsive.css 窄屏块。）
 *
 * 结构 = 纯固定条（无文档流占位，主人 2026-09-09 拍板撤掉占位块）：
 * 页面内容自然流到条底下，底部的遮挡让位由 responsive.css 的
 * .fp-footer-bar-clear（Footer margin-bottom）负责；移动端让位由 fp-content
 * 既有底 padding 负责（任务页由 .fp-has-bottom-bar 追加让位）。
 *
 * 定位属性（left/right/bottom/z-index/圆角）全部交给 responsive.css 的
 * .fp-bottom-bar——inline style 斗不过类选择器，干脆不写，与 fp-tabbar
 * 同手法。内层容器挂 fp-bottom-bar-inner / note 挂 fp-bottom-bar-note /
 * actions 挂 fp-bottom-bar-actions：窄屏纵向化的形态覆盖全靠这三个钩子。
 */
export function BottomActionBar({ actions, note }: BottomActionBarProps) {
  return (
    <div
      // 层级 3 的铬（宪法 §3）：玻璃、不加 specular。定位属性交给 responsive.css
      // 的 .fp-bottom-bar；桌面圆角 0（贴边全宽）、窄屏胶囊也由 CSS 管
      className="fp-bottom-bar fp-glass"
    >
      <div
        className="fp-bottom-bar-inner"
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
          className="fp-bottom-bar-note"
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
        {/* 右侧按钮组：桌面不收缩（note 再长也不挤压操作）；窄屏撑满胶囊 */}
        <div className="fp-bottom-bar-actions" style={{ flexShrink: 0 }}>{actions}</div>
      </div>
    </div>
  );
}
