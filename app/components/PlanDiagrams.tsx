import type { DiagramLabel } from "~/domain/plan-diagram";
import {
  CURVE_BASELINE,
  CURVE_DASH,
  CURVE_GUIDES,
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
 * 视觉语言（2026-09-22 第四次迭代），四层叠出来：
 *   1. **极光**：整张图底下一团径向光晕（primary 0.30 → 0），先给画面垫上光
 *   2. **光带**：曲线下方压一条 11px 宽的半透明同形描边，冒充辉光
 *   3. **渐变**：描边与填充走 linearGradient / radialGradient，端点取
 *      primary → primaryTo（冰川冰蓝到冰白），不是一根死色线
 *   4. **光晕点**：每个锚点先铺一个径向渐变的软光斑，再压实心小点
 *
 * ⚠️ 尽可以用 `var(--fp-*)`，**不许写不存在的变量名**（写错的 var() 在 SVG 里会
 * 静默掉成黑色），tests/domain/liquid-glass-guard.test.ts 钉着这条。
 * ⚠️ 也不许用 SVG 滤镜（feGaussianBlur / feDisplacementMap）——宪法 §3 明令禁止，
 * 低端安卓与 workerd SSR 都扛不住；上面那四层就是不用滤镜做出辉光的全部手段。
 *
 * 几何**全在 `app/domain/plan-diagram.ts`**，本文件只管把它画出来：
 * 坐标、字号、胶囊尺寸、标签与锚点的对应关系都不在这里手写。历史教训是
 * 几何靠肉眼截图走查（贵且漏），现已由 `tests/domain/plan-diagram.test.ts`
 * 钉成不变量（胶囊不越界 / 不咬字 / 不侵入镜片 / 与锚点同轴）。
 * **在这里再抄一份坐标 = 守卫守的是影子副本，等于没守。**
 */

/**
 * 一段「玻璃高光弧」：从 205° 扫到 305°（屏幕坐标，y 向下，角度顺时针为正）。
 *
 * 为什么值得单独画：全站的玻璃卡靠 `.fp-glass::before` 的顶边高光脊立住质感，
 * 这几张示意图里没有那道脊就会读成「扁的贴纸」。给每个圆在左上到正上方压一段
 * 冰白弧，圆就从色块变成了有厚度的冰块——**不用任何滤镜**（宪法 §3 禁）。
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
 * 标签胶囊：把裸文字装进一枚冰雾小片，**站在线之上**而不是压在线上。
 *
 * 2026-09-22 第四版加的这一层，一次解决三件事：
 *   1. 裸文字直接压在圈线/曲线上，读起来像线把字划开了（「分批止盈」当年只能
 *      被迫缩到点的左边，就是因为压在 Med 陡升的曲线上）
 *   2. 同排相邻的标签会咬字（左右两枚 venn 标签曾只隔 3px）
 *   3. 与全站的 well/elevated 材料同源，图不再是「另一套设计」
 */
function LabelPill({ label, fontSize = LABEL_FS }: { label: DiagramLabel; fontSize?: number }) {
  const r = pillRect(label, fontSize);
  const warm = label.tone === "warm";
  const ink = warm ? "var(--fp-pending)" : "var(--fp-text-secondary)";
  const line = warm ? "var(--fp-pending)" : "var(--fp-primary)";
  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={r.h / 2}
        fill="var(--fp-elevated)"
        fillOpacity="0.86"
        stroke={line}
        strokeOpacity={warm ? 0.5 : 0.32}
        strokeWidth="1"
      />
      <text
        // anchor=end 时 x 是胶囊右缘，文字得再退一个内边距才落在片上（不减就是贴边）
        x={label.anchor === "middle" ? label.x : label.x - PILL_PAD_X}
        y={label.y + fontSize * 0.34}
        textAnchor={label.anchor === "middle" ? "middle" : "end"}
        fontSize={fontSize}
        fill={ink}
      >
        {label.text}
      </text>
    </g>
  );
}

/** 三圈交叉图：三个等权圆 + 中心结论圆。两个理念小节共用一套几何，靠 variant 拉开重量 */
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
   *   - `fill`（定投品种）：实心雾圈，读「三个品种都在这一片里」
   *   - `line`（基金选择）：描边圈 + 虚线刻度环，读「三个条件都得满足才进得去」
   * 只调重量与环的虚实，**不动构图**（主人 2026-09-22 定的：三圈底子不动）。
   */
  variant?: "fill" | "line";
}

export function TriVenn({ idPrefix, labels, center, ariaLabel, variant = "fill" }: TriVennProps) {
  const liney = variant === "line";
  const ringR = VENN_RING_R;

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
        {/* 极光：整张图底下的一团光，让三个圈浮在光里而不是压在死底上 */}
        <radialGradient id={`${idPrefix}-aurora`}>
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.30" />
          <stop offset="55%" stopColor="var(--fp-primary)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </radialGradient>
        {/* 圈内径向微光：比一层平铺的冰雾更有体积感，边缘自然收掉。
            焦点（fx/fy）刻意偏到圆的左上：三个圈各自「左上打光」，
            叠在一起才像三片被同一盏灯照着的冰，而不是一坨均匀的雾 */}
        <radialGradient id={`${idPrefix}-fill`} fx="0.32" fy="0.26">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0.02" />
        </radialGradient>
        {/* 三个圈的描边各走一个角度的冰蓝→冰白渐变，叠在一起才不像复制粘贴 */}
        <linearGradient id={`${idPrefix}-s-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--fp-primary-to)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-s-b`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--fp-primary-to)" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-s-c`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--fp-primary-to)" stopOpacity="0.9" />
        </linearGradient>
        {/* 中心镜片：左上打光、右下落到不透明浮面——像一枚有厚度的冰透镜 */}
        <radialGradient id={`${idPrefix}-lens`} cx="0.3" cy="0.24" r="0.95">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.5" />
          <stop offset="62%" stopColor="var(--fp-elevated)" stopOpacity="0.97" />
          <stop offset="100%" stopColor="var(--fp-elevated)" stopOpacity="0.99" />
        </radialGradient>
      </defs>

      <ellipse cx={VENN_CENTER.x} cy={VENN_CENTER.y} rx="178" ry="128" fill={`url(#${idPrefix}-aurora)`} />

      {/* 三圈。试过给每片压一道「下缘暗弧」制造厚度（2026-09-22），**删掉了**：
          圈的底部本来就落在深底上，再往深处压暗等于什么都没画（截图对比两版无差），
          留着一堆看不见的节点只会让人以为这里有层次。厚度靠高光脊 + 逐片渐变的
          焦点偏移来表达（见上面 defs 的注释） */}
      {VENN_VERTICES.map(v => (
        <circle
          key={v.g}
          cx={v.x}
          cy={v.y}
          r={VENN_R}
          fill={`url(#${idPrefix}-fill)`}
          // line 档把填充整体压下去：同样是那块渐变，读起来从「雾」变成「描边」
          fillOpacity={liney ? 0.5 : 1}
          stroke={`url(#${idPrefix}-s-${v.g})`}
          strokeWidth={liney ? 2.4 : 2}
        />
      ))}
      {/* 高光脊：压在描边同半径处，圈一下子立起来了 */}
      {VENN_VERTICES.map(v => (
        <path
          key={`hl-${v.g}`}
          d={glassArc(v.x, v.y, VENN_R)}
          fill="none"
          stroke="var(--fp-primary-to)"
          strokeWidth="2.5"
          strokeOpacity={liney ? 0.4 : 0.55}
          strokeLinecap="round"
        />
      ))}

      {/* 中心镜片：外圈再套一道细环，读起来像镜头而不是一块贴纸。
          animate-float 让镜片缓慢起伏（uno.config 的 4s ±6px 关键帧，
          responsive.css §8 已在 prefers-reduced-motion 下关掉它） */}
      <g className="animate-float">
        <circle
          cx={VENN_CENTER.x}
          cy={VENN_CENTER.y}
          r={ringR}
          fill="none"
          stroke="var(--fp-primary)"
          strokeWidth="1"
          strokeOpacity={liney ? 0.45 : 0.3}
          // line 档的环做成刻度虚线：这是两张图之间最省的一处差异化
          strokeDasharray={liney ? "3 7" : undefined}
        />
        {/* 半径 45 是被最长那行（「投资价值较高」6 字 × 13.5 ≈ 81px）撑出来的——
            再小文字会顶出圆边，再大就会碰上外圈胶囊（最近的距重心 98，见 domain 的常量） */}
        <circle
          cx={VENN_CENTER.x}
          cy={VENN_CENTER.y}
          r={VENN_LENS_R}
          fill={`url(#${idPrefix}-lens)`}
          stroke="var(--fp-primary)"
          strokeWidth="1.5"
        />
        {/* 镜片也要一道高光脊，不然中心那枚「宝石」是哑的 */}
        <path
          d={glassArc(VENN_CENTER.x, VENN_CENTER.y, VENN_LENS_R)}
          fill="none"
          stroke="var(--fp-primary-to)"
          strokeWidth="2.5"
          strokeOpacity={liney ? 0.9 : 0.7}
          strokeLinecap="round"
        />
        {center.map((line, i) => (
          <text
            key={line}
            x={VENN_CENTER.x}
            y={center.length > 1 ? 135 + i * 19 : 145}
            textAnchor="middle"
            fontSize={LABEL_FS}
            fontWeight="600"
            fill="var(--fp-text-primary)"
          >
            {line}
          </text>
        ))}
      </g>

      {vennLabels(labels).map(l => (
        <LabelPill key={l.text} label={l} />
      ))}
    </svg>
  );
}

/**
 * 定投方法示意图：一条「下跌加码、上涨止盈」的净值曲线。
 *
 * 四个锚点、标签位置、高估虚线的坐标全在 domain 那份数据里（含它们的来历），
 * 这里只负责画：极光 → 三条参考线 → 面积 → 光带 → 曲线 → 虚线 → 锚点 → 胶囊。
 *
 * 参考线给曲线一个「坐标系」的暗示：以前曲线是悬在空底上的一条光，
 * 读者不容易判断它跌了多少、涨到哪。三条（110 / 140 / 150）都极淡，
 * 抢不了戏，但谷底与基线的关系一眼看得出来。
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

  /** 光晕点：先铺一层径向渐变软光斑，再压实心小点 */
  const dot = (p: { x: number; y: number }, warm = false) => (
    <g key={`${p.x}-${p.y}`}>
      <circle cx={p.x} cy={p.y} r="14" fill={`url(#${id}-halo${warm ? "-warm" : ""})`} />
      <circle cx={p.x} cy={p.y} r="4.5" fill={warm ? "var(--fp-pending)" : "var(--fp-primary)"} />
    </g>
  );

  return (
    <svg
      viewBox={`0 0 ${CURVE_VIEW.w} ${CURVE_VIEW.h}`}
      className="mx-auto block w-full"
      // 660 而不是 720：这张图的字号与整张 venn 的**渲染后**字号才咬得齐
      // （venn 在桌面宽 468、曲线 660 时，两边的字都落在一档里；给到 720
      //  曲线的胶囊会比 venn 的大出一圈，同一张卡里两种字号一眼看得出）
      style={{ maxWidth: 660 }}
      role="img"
      aria-label="定投方法示意：开始定投后遇下跌坚持买入，在低位多投；估值越过虚线进入高估阶段时，分批止盈"
    >
      <defs>
        <radialGradient id={`${id}-aurora`}>
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.26" />
          <stop offset="58%" stopColor="var(--fp-primary)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </radialGradient>
        {/* 曲线本体：左端压暗、右端提亮，走势「越走越亮」 */}
        <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.7" />
          <stop offset="52%" stopColor="var(--fp-primary)" />
          <stop offset="100%" stopColor="var(--fp-primary-to)" />
        </linearGradient>
        {/* 面积：自下而上淡出，像一条从冰面升起的光 */}
        <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-halo-warm`}>
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

      <ellipse cx="215" cy="120" rx="205" ry="118" fill={`url(#${id}-aurora)`} />

      {/* 参考线：起于曲线左侧一点，一直拉到画布右缘（曲线本身也出画，读数一致） */}
      {CURVE_GUIDES.map(y => (
        <line
          key={y}
          x1="32"
          y1={y}
          x2={CURVE_VIEW.w}
          y2={y}
          stroke="var(--fp-border)"
          strokeWidth="1"
          strokeOpacity="0.35"
        />
      ))}

      <path d={area} fill={`url(#${id}-area)`} mask={`url(#${id}-fade-mask)`} />
      {/* 光带：同形描边加粗到 11px 压半透明，不用滤镜冒充辉光 */}
      <path d={curve} fill="none" stroke="var(--fp-primary)" strokeWidth="11" strokeOpacity="0.14" strokeLinecap="round" />
      <path d={curve} fill="none" stroke={`url(#${id}-line)`} strokeWidth="3.5" strokeLinecap="round" />

      {/* 高估阈值线：暖色（pending）表示「该留意了」，与涨红跌绿都区分得开。
          标签挂在它自己的右端外侧（见 domain 的 CURVE_LABELS），不标点——它标的是线 */}
      <line
        x1={CURVE_DASH.x1}
        y1={CURVE_DASH.y}
        x2={CURVE_DASH.x2}
        y2={CURVE_DASH.y}
        stroke="var(--fp-pending)"
        strokeWidth="1.5"
        strokeDasharray="5 5"
        strokeOpacity="0.7"
      />

      {/* 四个关键点。下跌坚持那个点以前漏了，主人点了出来 */}
      {dot(p0)}
      {dot(p1)}
      {dot(p2)}
      {dot(p3, true)}

      {/* 引线：把「分批止盈」那枚胶囊接回它标注的交点。
          它没法与点同 x（上方是陡升的曲线，居中必被穿），只能靠这根线表态 */}
      {CURVE_LABELS.map((l) => {
        const lead = labelLeader(l);
        return lead
          ? (
              <line
                key={`lead-${l.text}`}
                x1={lead.x1}
                y1={lead.y1}
                x2={lead.x2}
                y2={lead.y2}
                stroke="var(--fp-pending)"
                strokeWidth="1"
                strokeOpacity="0.5"
              />
            )
          : null;
      })}
      {CURVE_LABELS.map(l => (
        <LabelPill key={l.text} label={l} />
      ))}
    </svg>
  );
}
