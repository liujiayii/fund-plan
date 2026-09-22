/**
 * `/plan`（低估指数定投计划）的两张示意图 —— 三圈交叉图与定投方法曲线。
 *
 * 为什么自己画 SVG 而不是引图表库：这两张都是**装饰性的理念图**（不是数据图），
 * `@ant-design/charts` 那套底层吃 canvas，SSR 会渲染出空内容、hydration 报
 * useContext 为空（见 CLAUDE.md「依赖 canvas/DOM 的库必须懒加载」）。用 SVG 画
 * 则是纯静态标记，SSR 与浏览器两端产出逐字节相同，没有懒加载与占位骨架的麻烦。
 *
 * 视觉语言（2026-09-22 主人要求「再炫一点」后重做），四层叠出来：
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
 * 几何都是**手算的**，改动前先看这几条（2026-09-22 主人验收后返工）：
 *   - 每个标签必须与它对应的点**同在一条竖线上**（主人指出「开始定投」没对齐、
 *     「下跌坚持」根本没有点）
 *   - 标签之间不许叠字：算完 x 跨度再定圆心距，别凭感觉挪
 *   - 曲线往右上爬的那一段会**吃掉右上角的空间**，标签放它上面会压到线
 *   - 画布边界要留够：第一版 hero 的硬币圆心 186 + 半径 16 = 202，超出 viewBox
 *     宽度 200，右边被裁掉一块
 */

/** 文字尺寸：整张图随容器等比缩放，手机上会缩到约八成，所以基准给到 13.5 */
const FS = 13.5;

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

/** 三圈交叉图：三个等权圆 + 中心结论圆。两个理念小节共用一张，视觉语言一致 */
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
}

export function TriVenn({ idPrefix, labels, center, ariaLabel }: TriVennProps) {
  // 等边三角形：重心 (180,140)，顶点到重心 R=58；圈半径 62 保证三圈两两相交
  // 且都盖住重心（58 < 62），中心那块三重叠区才真的存在
  const verts = [
    { x: 180, y: 82, g: "a" },
    { x: 129.8, y: 169, g: "b" },
    { x: 230.2, y: 169, g: "c" },
  ] as const;
  const R = 62;
  // 标签摆在「重心 → 自己那个圆」方向上、离重心 90 处：这样它落在自己圆的外缘内侧，
  // 既出了中心圆（45 + 半个标签宽），又还没进邻居的圆（实测邻居圆心距 129 > 62）。
  // ⚠️ 这个距离是被**标签宽度**卡出来的，不是被圆卡出来的：78 的时候标签内端
  // 离中心圆只剩 2px，视觉上直接贴在深色圆边上（截图走查）
  const D = 90;
  const dirs = [
    { x: 0, y: -1 },
    { x: -0.866, y: 0.5 },
    { x: 0.866, y: 0.5 },
  ] as const;
  const labelPos = dirs.map(d => ({ x: 180 + d.x * D, y: 140 + d.y * D }));

  return (
    <svg
      viewBox="0 0 360 250"
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
        {/* 圈内径向微光：比一层平铺的冰雾更有体积感，边缘自然收掉 */}
        <radialGradient id={`${idPrefix}-fill`}>
          <stop offset="0%" stopColor="var(--fp-primary)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--fp-primary)" stopOpacity="0.04" />
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

      <ellipse cx="180" cy="140" rx="178" ry="128" fill={`url(#${idPrefix}-aurora)`} />

      {verts.map(v => (
        <circle
          key={v.g}
          cx={v.x}
          cy={v.y}
          r={R}
          fill={`url(#${idPrefix}-fill)`}
          stroke={`url(#${idPrefix}-s-${v.g})`}
          strokeWidth="2"
        />
      ))}
      {/* 高光脊：压在描边同半径处，圈一下子立起来了 */}
      {verts.map(v => (
        <path
          key={`hl-${v.g}`}
          d={glassArc(v.x, v.y, R)}
          fill="none"
          stroke="var(--fp-primary-to)"
          strokeWidth="2.5"
          strokeOpacity="0.55"
          strokeLinecap="round"
        />
      ))}

      {/* 中心镜片：外圈再套一道细环，读起来像镜头而不是一块贴纸。
          animate-float 让镜片缓慢起伏（uno.config 的 4s ±6px 关键帧，
          responsive.css §8 已在 prefers-reduced-motion 下关掉它） */}
      <g className="animate-float">
        <circle
          cx="180"
          cy="140"
          r="52"
          fill="none"
          stroke="var(--fp-primary)"
          strokeWidth="1"
          strokeOpacity="0.3"
        />
        {/* 半径 45 是被最长那行（「投资价值较高」6 字 × 13.5 ≈ 81px）撑出来的——
            再小文字会顶出圆边，再大就会碰上外圈标签（最近的距圆心 90） */}
        <circle cx="180" cy="140" r="45" fill={`url(#${idPrefix}-lens)`} stroke="var(--fp-primary)" strokeWidth="1.5" />
        {/* 镜片也要一道高光脊，不然中心那枚「宝石」是哑的 */}
        <path
          d={glassArc(180, 140, 45)}
          fill="none"
          stroke="var(--fp-primary-to)"
          strokeWidth="2.5"
          strokeOpacity="0.7"
          strokeLinecap="round"
        />
        {center.map((line, i) => (
          <text
            key={line}
            x="180"
            y={center.length > 1 ? 135 + i * 19 : 145}
            textAnchor="middle"
            fontSize={FS}
            fontWeight="600"
            fill="var(--fp-text-primary)"
          >
            {line}
          </text>
        ))}
      </g>

      {labelPos.map((p, i) => (
        <text
          key={labels[i]}
          x={p.x}
          y={p.y}
          textAnchor="middle"
          fontSize={FS}
          fill="var(--fp-text-secondary)"
        >
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

/**
 * 定投方法示意图：一条「下跌加码、上涨止盈」的净值曲线。
 *
 * 四个锚点全部落在曲线上（贝塞尔段的首尾端点天然在曲线上，不是估的），
 * 每个标签与它那个锚点**同 x**：
 *   开始定投(52) · 下跌坚持(112) · 低点多投(190) · 分批止盈(300)
 *
 * 为什么虚线标「高估」而不是一整块色带：第一版画的是右侧整条竖带，实测那 18% 宽的
 * 暖色块比曲线还抢眼（截图走查）。虚线横线才真正表达「估值到了这条线」，
 * 曲线越过它的那一刻正好是该止盈的位置。
 */
export function MethodCurve() {
  const id = "plan-method";
  // 锚点：起点 → 下跌途中 → 谷底 → 与高估线相交处 → 末端
  const p0 = { x: 52, y: 110 };
  const p1 = { x: 112, y: 132 };
  const p2 = { x: 190, y: 140 };
  const p3 = { x: 300, y: 70 };
  // 末端刻意**停在画布右缘之外**（420 就是 viewBox 宽度）：曲线与面积一起出画，
  // 像一张还在往上走的图。停在 390 会留下一块平顶（面积填充顺着平顶落到基线），
  // 看着像台子（截图走查）
  const p4 = { x: 420, y: 10 };
  // 控制点刻意取成「前后相连」的（p3 处 262,120 → 300,70 → 334,34 近似共线），
  // 否则贝塞尔链在 p3 会折出一个肉眼可见的尖角
  const curve
    = `M ${p0.x} ${p0.y}`
      + ` C 74 118 92 126 ${p1.x} ${p1.y}`
      + ` C 134 138 158 141 ${p2.x} ${p2.y}`
      + ` C 226 139 262 120 ${p3.x} ${p3.y}`
      + ` C 334 34 376 18 ${p4.x} ${p4.y}`;
  // 面积填充的基线取 150（正好在谷底 140 之下、标签之上）；右端直接落到画布外
  const BASELINE = 150;
  const area = `${curve} L ${p4.x} ${BASELINE} L ${p0.x} ${BASELINE} Z`;

  /** 光晕点：先铺一层径向渐变软光斑，再压实心小点 */
  const dot = (p: { x: number; y: number }, warm = false) => (
    <g key={`${p.x}-${p.y}`}>
      <circle cx={p.x} cy={p.y} r="14" fill={`url(#${id}-halo${warm ? "-warm" : ""})`} />
      <circle cx={p.x} cy={p.y} r="4.5" fill={warm ? "var(--fp-pending)" : "var(--fp-primary)"} />
    </g>
  );

  return (
    <svg
      viewBox="0 0 420 196"
      className="mx-auto block w-full"
      style={{ maxWidth: 700 }}
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
        <mask id={`${id}-fade-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="420" height="196">
          <rect x="0" y="0" width="420" height="196" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>

      <ellipse cx="215" cy="120" rx="205" ry="118" fill={`url(#${id}-aurora)`} />

      <path d={area} fill={`url(#${id}-area)`} mask={`url(#${id}-fade-mask)`} />
      {/* 光带：同形描边加粗到 11px 压半透明，不用滤镜冒充辉光 */}
      <path d={curve} fill="none" stroke="var(--fp-primary)" strokeWidth="11" strokeOpacity="0.14" strokeLinecap="round" />
      <path d={curve} fill="none" stroke={`url(#${id}-line)`} strokeWidth="3.5" strokeLinecap="round" />

      {/* 高估阈值线：暖色（pending）表示「该留意了」，与涨红跌绿都区分得开 */}
      <line
        x1="195"
        y1={p3.y}
        x2="412"
        y2={p3.y}
        stroke="var(--fp-pending)"
        strokeWidth="1.5"
        strokeDasharray="5 5"
        strokeOpacity="0.7"
      />
      <text x="412" y="60" textAnchor="end" fontSize={FS} fill="var(--fp-pending)">高估</text>

      {/* 四个关键点。下跌坚持那个点以前漏了，主人点了出来 */}
      {dot(p0)}
      {dot(p1)}
      {dot(p2)}
      {dot(p3, true)}

      {/* 标签：开始定投 / 低点多投 共用一条基线（读起来整齐），
          下跌坚持 挪到曲线上方的空处——放同一行会和邻居的标签咬在一起。
          分批止盈 只能摆在自己的点**左边**：它上方是那段陡升的曲线，标签压上去
          会被线从中间穿过（试过居中在上方，x=333 处必然撞线） */}
      <text x="52" y="176" textAnchor="middle" fontSize={FS} fill="var(--fp-text-secondary)">开始定投</text>
      <text x="190" y="176" textAnchor="middle" fontSize={FS} fill="var(--fp-text-secondary)">低点多投</text>
      <text x="112" y="112" textAnchor="middle" fontSize={FS} fill="var(--fp-text-secondary)">下跌坚持</text>
      <text x="288" y="62" textAnchor="end" fontSize={FS} fill="var(--fp-pending)">分批止盈</text>
    </svg>
  );
}
