import type { ReactNode } from "react";
import { COLOR, NUM_FONT } from "~/theme";

export interface DataRowProps {
  label: ReactNode;
  value: ReactNode;
  /** 列表最后一行传 true，不画分割线 */
  last?: boolean;
  /**
   * 数值用等宽字体渲染。金额/净值/份额/费率一律传 true ——
   * 比例字体下 "1" 比 "8" 窄，一列堆叠的数字会纵向对不齐，
   * 这正是 NUM_FONT 存在的理由。
   */
  mono?: boolean;
}

/**
 * 左标签右值的一行。取代 antd 的 Descriptions ——
 * Descriptions 的 bordered 模式在窄屏会把 label 与 value 挤成两行、
 * 且列宽不可控，信息密度反而更低。
 *
 * 一个 `<dl>` 里只有一对 `dt`/`dd`（即单项定义列表）在语义上是合法的。
 * 更「正确」的做法是让调用方的容器当 `<dl>`、每行只出 `dt`+`dd`，
 * 但那要逐个改调用方的容器，且本组件会退化成不能独立使用的片段，收益不抵复杂度。
 */
export function DataRow({ label, value, last, mono }: DataRowProps) {
  return (
    // ⚠️ 用 dl/dt/dd 而非 div/span/span：被取代的 `Descriptions bordered`
    // 渲染的是真 <table> + <th>，屏幕阅读器靠它把 label 与 value 配对。
    // 换成无语义的 div+span 会丢掉这层关联。
    // dl 的默认 margin 必须清掉，否则每行之间会多出浏览器默认间距。
    //
    // ⚠️ 但别记成「可访问性已彻底解决」：给列表元素改 display（这里是 flex）
    // 属于已知会在某些 Safari + VoiceOver 组合下丢掉列表语义的那类改动。
    // dt/dd 的配对关系仍严格优于 div+span，所以不回退；只是别过度声明。
    <dl
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        margin: 0,
        padding: "10px 0",
        borderBottom: last ? undefined : `1px solid ${COLOR.border}`,
      }}
    >
      <dt style={{ fontSize: 13, color: COLOR.textSecondary, whiteSpace: "nowrap" }}>
        {label}
      </dt>
      <dd
        style={{
          // dd 的浏览器默认 margin-inline-start 是 40px，会白占 40px 横向空间
          // （space-between 下值仍贴右，但长标签 + 长数值的窄行会更早被挤换行）
          margin: 0,
          fontSize: 14,
          color: COLOR.textPrimary,
          textAlign: "right",
          fontFamily: mono ? NUM_FONT : undefined,
        }}
      >
        {value}
      </dd>
    </dl>
  );
}
