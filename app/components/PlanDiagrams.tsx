import type { DiagramLabel } from "~/domain/plan-diagram";
import {
  CENTER_FS,
  CURVE_BASELINE,
  CURVE_DASH,
  CURVE_LABELS,
  CURVE_POINTS,
  CURVE_VIEW,
  LABEL_FS,
  labelLeader,
  PILL_PAD_X,
  pillRect,
  VENN_CENTER,
  VENN_LENS_R,
  VENN_R,
  VENN_RING_R,
  VENN_VERTICES,
  VENN_VIEW,
  vennLabels,
} from "~/domain/plan-diagram";

/**
 * `/plan`（低估指数定投计划）的三张示意图 —— 两张三圈交叉图与一条定投方法曲线。
 *
 * 为什么自己画 SVG 而不是引图表库：这三张都是**装饰性的理念图**（不是数据图），
 * `@ant-design/charts` 那套底层吃 canvas，SSR 会渲染出空内容、hydration 报
 * useContext 为空（见 CLAUDE.md「依赖 canvas/DOM 的库必须懒加载」）。用 SVG 画
 * 则是纯静态标记，SSR 与浏览器两端产出逐字节相同，没有懒加载与占位骨架的麻烦。
 *
 * ══ 画法：光学玻璃（2026-09-23 主人三选一定稿）══
 *
 * 视觉语言是「**玻璃片**」而不是「发光贴纸」，四条：
 *   1. **圈画两遍**：一遍 7px 软辉光、一遍 1.2px 锐棱。看着是「一片有厚度的玻璃」，
 *      而且**交叠处两遍都叠加 → 交集自己就亮了**——venn 的语义（交集）不用算交线
 *      （也算不出：SVG 没有布尔运算），更不用滤镜（宪法 §3 禁）就长出来了
 *   2. **三片各自左上受光**：填充走径向渐变、焦点偏到 (0.3, 0.24)，像同一盏灯照的三片冰
 *   3. **中央棱镜**：冰白光晕 + 实线环 + 虚线刻度环 + 高光脊，全图最亮的一处
 *   4. **曲线是发光丝带**：13px 辉光 + 5px 丝带 + 1.1px 白芯；锚点是**宝石切面**
 *      （菱形 + 内高光），止盈那枚是暖色（pending）
 *
 * ⚠️ 尽可以用 `var(--fp-*)`，**不许写不存在的变量名**（写错的 var() 在 SVG 里会
 * 静默掉成黑色），tests/domain/liquid-glass-guard.test.ts 钉着这条。
 * ⚠️ 也不许用 SVG 滤镜（feGaussianBlur / feDisplacementMap）——宪法 §3 明令禁止，
 * 低端安卓与 workerd SSR 都扛不住；上面那四条就是不用滤镜做出辉光的全部手段。
 *
 * ══ 几何与动效 ══
 *
 * 几何**全在 `app/domain/plan-diagram.ts`**，本文件只管画：坐标、字号、胶囊尺寸、
 * 标签与锚点的对应关系都不在这里手写（在这里再抄一份 = 守卫测试守的是影子副本）。
 * 动效类名（`fp-fig-*`）由 `app/styles/motion.css` 编排、`ui/Reveal.tsx` 触发：
 * 入场只碰 opacity / transform，悬停只碰 stroke-opacity 与内层包裹组的 transform，
 * 两边**不许抢同一个属性**（抢了 CSS 会静默吃掉一个）。所以棱镜套了三层组：
 * 入场(pop) → 悬停缩放(zoom) → 呼吸(float)，各管一个 transform。
 */

/**
 * 一段「玻璃高光弧」：从 205° 扫到 305°（屏幕坐标，y 向下，角度顺时针为正）。
 *
 * 为什么值得单独画：全站的玻璃卡靠 `.fp-glass::before` 的顶边高光脊立住质感，
 * 这几张示意图里没有那道脊就会读成「扁的贴纸」。给每个圆在左上到正上方压一段
 * 冰白弧，圆就从色块变成有厚度的玻璃片——**不用任何滤镜**（宪法 §3 禁）。
 */
function glassArc(cx: number, cy: number, r: number, from = 205, to = 305): string {
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  };
  // 100° 的短弧：large-arc=0、sweep=1（屏幕坐标里顺时针即角度增大的方向）
  return `M ${pt(from)} A ${r} ${r} 0 0 1 ${pt(to)}`;
}

/**
 * 标签胶囊：像贴在玻璃上的**蚀刻牌**——底几乎透明、描边极细。
 *
 * 2026-09-23 从裸文字改成胶囊，一次解决三件事：
 *   1. 裸文字压在圈线/曲线上，读起来像线把字划开了
 *   2. 同排相邻的标签会咬字（左右两枚 venn 标签曾只隔 3px）
 *   3. 与图版的深底同源，标签是「刻上去的」而不是「浮在上面的」
 *
 * `groupClass` 默认 `fp-fig-label`（入场时与标签同批浮起）；「高估」那枚要跟它标注的
 * 虚线一起最后出现，所以传 `fp-fig-late` 换队。
 */
function LabelPill({
  label,
  ink,
  groupClass = "fp-fig-label",
}: {
  label: DiagramLabel;
  /** 文字色；不传则随语气（cool=主色 / warm=暖黄）。venn 那两张传三级文字色——蓝字压在浅色圈面上会打架 */
  ink?: string;
  groupClass?: string;
}) {
  const r = pillRect(label);
  const warm = label.tone === "warm";
  const tone = warm ? "var(--fp-pending)" : "var(--fp-primary)";
  return (
    <g className={groupClass}>
      <rect
        className="fp-fig-pill"
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={r.h / 2}
        fill="var(--fp-bg)"
        fillOpacity="0.45"
        stroke={tone}
        strokeOpacity={warm ? 0.5 : 0.4}
        strokeWidth="1"
      />
      <text
        // anchor=end 时 x 是胶囊右缘，文字得再退一个内边距才落在片上（不减就是贴边）
        x={label.anchor === "middle" ? label.x : label.x - PILL_PAD_X}
        y={label.y + LABEL_FS * 0.34}
        textAnchor={label.anchor === "middle" ? "middle" : "end"}
        fontSize={LABEL_FS}
        letterSpacing="0.1em"
        fill={ink ?? tone}
      >
        {label.text}
      </text>
    </g>
  );
}

/** 三圈交叉图：三个等权圆 + 中心棱镜。两个理念小节共用一套几何，靠 variant 拉开重量 */
export interface TriVennProps {
  /**
   * 渐变 / 极光的 id 前缀。⚠️ **必须与同页其它实例不同**：一页上有两张这种图，
   * SVG 的 id 是文档级的，重名会让第二张图引用到第一张的渐变定义。
   * 刻意不用 useId()（它产出的 `:r1:` 带冒号，塞进 url(#…) 里有兼容风险）
   */
  idPrefix: string;
  /** 三个外圈文案，依次为 上 / 左下 / 右下 */
  labels: readonly [string, string, string];
  /** 中心结论，最多两行 */
  center: readonly string[];
  /** 无障碍描述；纯装饰的话传空串 */
  ariaLabel: string;
  /**
   * 圈的重量。两张图共用一套几何，若画得一模一样就会被读成「同一张图印了两遍」：
   *   - `fill`（定投品种）：实心玻璃片，读「三个品种都在这一片里」
   *   - `line`（基金选择）：片更透、棱更亮，读「三个条件都得满足才进得去」
   * 只调重量，**不动构图**（主人 2026-09-22 定的：三圈底子不动）。
   */
  variant?: "fill" | "line";
}

/** 三片玻璃入场的错峰延迟（ms）：先上、再左下、最后右下，像三片依次落位 */
const SHEET_DELAYS = [0, 140, 230] as const;

export function TriVenn({ idPrefix, labels, center, ariaLabel, variant = "fill" }: TriVennProps) {
  const line = variant === "line";

  return (
    <svg
      viewBox={`0 0 ${VENN_VIEW.w} ${VENN_VIEW.h}`}
      className="mx-auto block w-full"
      style={{ maxWidth: 520 }}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel || undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <defs>
        {/* 圈内径向微光：焦点（fx/fy）刻意偏到圆的左上——三个圈各自「左上打光」，
            叠在一起才像三片被同一盏灯照着的玻璃，而不是一坨均匀的雾 */}
        <radialGradient id={`${idPrefix}-fill`} fx="0.3" fy="0.24" r="0.95">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.26" />
          <stop offset="60%" stopColor="var(--fp-primary)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0.02" />
        </radialGradient>
        {/* 三个圈的「棱」各走一个角度的冰蓝→冰白渐变，叠在一起才不像复制粘贴 */}
        <linearGradient id={`${idPrefix}-edge-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--fp-primary-to)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-edge-b`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--fp-primary-to)" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-edge-c`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--fp-primary-to)" stopOpacity="0.95" />
        </linearGradient>
        {/* 整张图底下的极光：让三片浮在光里而不是压在死底上（比上一版收敛，只有 0.22） */}
        <radialGradient id={`${idPrefix}-aurora`}>
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </radialGradient>
        {/* 中央棱镜的光晕：从冰白（textPrimary）化开到主色——全图最亮的一处。
            透明度是验收稿（demo 的 lensGlow(id, 1.4)）那一档，别按基准值写：
            0.22 是「有光」，0.31 才是「棱镜被点亮」，差这一档中心就哑了 */}
        <radialGradient id={`${idPrefix}-prism`} cx="0.36" cy="0.28" r="0.92">
          <stop offset="0%" stopColor="var(--fp-text-primary)" stopOpacity="0.31" />
          <stop offset="42%" stopColor="var(--fp-primary)" stopOpacity="0.17" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse
        className="fp-fig-aura"
        cx={VENN_CENTER.x}
        cy={VENN_CENTER.y}
        rx="176"
        ry="126"
        fill={`url(#${idPrefix}-aurora)`}
      />

      {/* 三片玻璃：每片 = 渐变填充 + 7px 软辉光 + 1.2px 锐棱 + 左上高光脊。
          辉光与锐棱都按同一半径叠，交叠处两遍都叠加 —— venn 的交集自己就亮了 */}
      {VENN_VERTICES.map((v, i) => (
        <g key={v.g} className="fp-fig-sheet" style={{ animationDelay: `${SHEET_DELAYS[i]}ms` }}>
          <circle cx={v.x} cy={v.y} r={VENN_R} fill={`url(#${idPrefix}-fill)`} fillOpacity={line ? 0.6 : 1} />
          <circle
            className="fp-fig-glow"
            cx={v.x}
            cy={v.y}
            r={VENN_R}
            fill="none"
            stroke="var(--fp-primary)"
            strokeOpacity={line ? 0.10 : 0.16}
            strokeWidth="7"
          />
          <circle
            cx={v.x}
            cy={v.y}
            r={VENN_R}
            fill="none"
            stroke={`url(#${idPrefix}-edge-${v.g})`}
            strokeWidth={line ? 1.5 : 1.2}
          />
          <path
            d={glassArc(v.x, v.y, VENN_R)}
            fill="none"
            stroke="var(--fp-text-primary)"
            strokeOpacity={line ? 0.45 : 0.6}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* 中央棱镜。三层组各管一个 transform，互不抢：
          入场 pop（fp-fig-lens）→ 悬停缩放（fp-fig-lens-zoom）→ 常驻呼吸（animate-float）。
          animate-float 是 uno 的 4s ±6px 关键帧，responsive.css §7 已在
          prefers-reduced-motion 下关掉它 */}
      <g className="fp-fig-lens">
        <g className="fp-fig-lens-zoom">
          <g className="animate-float">
            {/* 光晕铺在环底下，环才压在光上（顺序反了虚线环会被光晕糊掉） */}
            <circle cx={VENN_CENTER.x} cy={VENN_CENTER.y} r={VENN_LENS_R + 22} fill={`url(#${idPrefix}-prism)`} />
            <circle
              cx={VENN_CENTER.x}
              cy={VENN_CENTER.y}
              r={VENN_RING_R}
              fill="none"
              stroke="var(--fp-primary)"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            {/* 虚线刻度环：读起来像镜头的对焦环，与实线环一起把「棱镜」立住 */}
            <circle
              cx={VENN_CENTER.x}
              cy={VENN_CENTER.y}
              r="59"
              fill="none"
              stroke="var(--fp-primary)"
              strokeOpacity="0.22"
              strokeWidth="0.8"
              strokeDasharray="2 6"
            />
            {/* 半径 45 是被最长那行（「投资价值较高」6 字）撑出来的——
                再小文字会顶出圆边，再大就会碰上外圈胶囊（最近的距重心 98，见 domain 常量） */}
            <circle
              cx={VENN_CENTER.x}
              cy={VENN_CENTER.y}
              r={VENN_LENS_R}
              fill="none"
              stroke="var(--fp-primary-to)"
              strokeOpacity="0.9"
              strokeWidth="1.2"
            />
            <path
              d={glassArc(VENN_CENTER.x, VENN_CENTER.y, VENN_LENS_R)}
              fill="none"
              stroke="var(--fp-text-primary)"
              strokeOpacity="0.72"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {center.map((text, i) => (
              <text
                key={text}
                x={VENN_CENTER.x}
                y={center.length > 1 ? 135 + i * 19 : 145}
                textAnchor="middle"
                fontSize={CENTER_FS}
                fontWeight="500"
                fill="var(--fp-text-primary)"
              >
                {text}
              </text>
            ))}
          </g>
        </g>
      </g>

      {vennLabels(labels).map(l => (
        <LabelPill key={l.text} label={l} ink="var(--fp-text-secondary)" />
      ))}
    </svg>
  );
}

/**
 * 定投方法示意图：一条「下跌加码、上涨止盈」的净值曲线。
 *
 * 四个锚点、标签位置、高估虚线的坐标全在 domain 那份数据里（含它们的来历），
 * 这里只负责画：面积 → 发光丝带 → 高估虚线 → 宝石锚点 → 胶囊。
 *
 * 描线入场：三条曲线路径都挂 `data-fp-draw`，长度由 Reveal 组件在客户端量出后
 * 写到 inline style（手算贝塞尔必然与渲染对不上），所以这里的 dasharray 是空的。
 */
export function MethodCurve() {
  const id = "plan-method";
  // 锚点：起点 → 下跌途中 → 谷底 → 与高估线相交处 → 末端
  const [p0, p1, p2, p3, p4] = CURVE_POINTS;
  // 控制点刻意取成「前后相连」的（p3 处 262,120 → 300,70 → 334,34 近似共线），
  // 否则贝塞尔链在 p3 会折出一个肉眼可见的尖角
  const curve
    = `M ${p0.x} ${p0.y}`
      + ` C 74 118 92 126 ${p1.x} ${p1.y}`
      + ` C 134 138 158 141 ${p2.x} ${p2.y}`
      + ` C 226 139 262 120 ${p3.x} ${p3.y}`
      + ` C 334 34 376 18 ${p4.x} ${p4.y}`;
  // 面积填充的基线取 150（正好在谷底 140 之下、标签之上）；右端直接落到画布外
  const area = `${curve} L ${p4.x} ${CURVE_BASELINE} L ${p0.x} ${CURVE_BASELINE} Z`;

  /** 宝石锚点：菱形切面 + 内高光。止盈那枚是暖色（pending），另外三枚是冰色 */
  const gem = (p: { x: number; y: number }, i: number, warm = false) => (
    <g className="fp-fig-gem" style={{ animationDelay: `${1000 + i * 80}ms` }} key={`${p.x}-${p.y}`}>
      {warm ? <circle cx={p.x} cy={p.y} r="20" fill={`url(#${id}-prism)`} /> : null}
      <rect
        x={p.x - (warm ? 5 : 4)}
        y={p.y - (warm ? 5 : 4)}
        width={warm ? 10 : 8}
        height={warm ? 10 : 8}
        transform={`rotate(45 ${p.x} ${p.y})`}
        fill={warm ? "var(--fp-pending)" : "var(--fp-bg)"}
        fillOpacity={warm ? 0.9 : 1}
        stroke={warm ? "var(--fp-text-primary)" : "var(--fp-primary-to)"}
        strokeOpacity={warm ? 0.7 : 0.85}
        strokeWidth={warm ? 0.9 : 1.1}
      />
      {!warm ? <circle cx={p.x} cy={p.y} r="1.6" fill="var(--fp-text-primary)" /> : null}
    </g>
  );

  return (
    <svg
      viewBox={`0 0 ${CURVE_VIEW.w} ${CURVE_VIEW.h}`}
      className="mx-auto block w-full"
      // 660 而不是 700：让它的**渲染后**字号与 venn 咬得齐（差 1.2 倍以内），
      // 同一张卡里两种字号一眼看得出
      style={{ maxWidth: 660 }}
      role="img"
      aria-label="定投方法示意：开始定投后遇下跌坚持买入，在低位多投；估值越过虚线进入高估阶段时，分批止盈"
    >
      <defs>
        {/* 丝带本体：左端压暗、右端提亮，走势「越走越亮」 */}
        <linearGradient id={`${id}-ribbon`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.28" />
          <stop offset="55%" stopColor="var(--fp-primary)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--fp-primary-to)" stopOpacity="0.75" />
        </linearGradient>
        {/* 面积：自下而上淡出，像一条从冰面升起的光 */}
        <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </linearGradient>
        {/* 止盈宝石的光晕 */}
        <radialGradient id={`${id}-prism`}>
          <stop offset="0%" stopColor="var(--fp-pending)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--fp-pending)" stopOpacity="0" />
        </radialGradient>
        {/* 面积的水平淡出。曲线已经画到画布右缘之外，但填充在右缘仍是半不透明的，
            会留下一条竖直硬边（截图走查抓到的）——用一层遮罩把它淡掉。
            用 <mask>（不是滤镜，宪法 §3 只禁滤镜）：默认按亮度取遮罩，
            所以 stopColor 取近白的 textPrimary，别用深色 */}
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-text-primary)" stopOpacity="1" />
          <stop offset="62%" stopColor="var(--fp-text-primary)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--fp-text-primary)" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-fade-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={CURVE_VIEW.w} height={CURVE_VIEW.h}>
          <rect x="0" y="0" width={CURVE_VIEW.w} height={CURVE_VIEW.h} fill={`url(#${id}-fade)`} />
        </mask>
      </defs>

      <path className="fp-fig-area" d={area} fill={`url(#${id}-area)`} mask={`url(#${id}-fade-mask)`} />

      {/* 发光丝带：13px 辉光（不用滤镜冒充的）+ 5px 丝带 + 1.1px 白芯。
          三条都挂 data-fp-draw，入场时被一起「画」出来 */}
      <path data-fp-draw="1" d={curve} fill="none" stroke="var(--fp-primary)" strokeOpacity="0.14" strokeWidth="13" strokeLinecap="round" />
      <path data-fp-draw="1" d={curve} fill="none" stroke={`url(#${id}-ribbon)`} strokeWidth="5" strokeLinecap="round" />
      <path data-fp-draw="1" d={curve} fill="none" stroke="var(--fp-text-primary)" strokeOpacity="0.6" strokeWidth="1.1" strokeLinecap="round" />

      {/* 高估阈值线：暖色（pending）表示「该留意了」，与涨红跌绿都区分得开。
          它连同自己的标签一起最后出现（fp-fig-late），读起来是「线画完了才立阈值」 */}
      <line
        className="fp-fig-late"
        x1={CURVE_DASH.x1}
        y1={CURVE_DASH.y}
        x2={CURVE_DASH.x2}
        y2={CURVE_DASH.y}
        stroke="var(--fp-pending)"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeDasharray="5 6"
      />

      {/* 四个关键点。「下跌坚持」那个点以前漏了，主人点了出来 */}
      {gem(p0, 0)}
      {gem(p1, 1)}
      {gem(p2, 2)}
      {gem(p3, 3, true)}

      {/* 引线：把「分批止盈」那枚胶囊接回它标注的交点。
          它没法与点同 x（上方是陡升的曲线，居中必被穿），只能靠这根线表态 */}
      {CURVE_LABELS.map((l) => {
        const lead = labelLeader(l);
        return lead
          ? (
              <line
                className="fp-fig-late"
                key={`lead-${l.text}`}
                x1={lead.x1}
                y1={lead.y1}
                x2={lead.x2}
                y2={lead.y2}
                stroke="var(--fp-pending)"
                strokeOpacity="0.55"
                strokeWidth="1"
              />
            )
          : null;
      })}
      {CURVE_LABELS.map(l => (
        <LabelPill
          key={l.text}
          label={l}
          // 「高估」标的是那条虚线而不是某个点，跟虚线同批出现
          groupClass={l.text === "高估" ? "fp-fig-late" : "fp-fig-label"}
        />
      ))}
    </svg>
  );
}
