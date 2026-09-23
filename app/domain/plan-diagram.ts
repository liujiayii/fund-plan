/**
 * `/plan` 三张理念示意图的**几何**：纯数据 + 纯函数，不碰 DOM，可脱离浏览器单测。
 *
 * 为什么把几何从组件里搬出来：这几张图的几何历史上全靠「肉眼截图走查」验收，
 * 而踩过的坑全是同一类硬几何问题（标签与锚点不同 x、标签离中心镜片只剩 2px、
 * 图形出画布被裁）。搬到 domain 后，`tests/domain/plan-diagram.test.ts` 把
 * 「胶囊不越界 / 不咬字 / 不侵入镜片 / 与锚点同轴」钉成不变量，改文案或挪位置
 * 时先红给谁看就谁看，不必再截图。
 *
 * 消费方只有 `app/components/PlanDiagrams.tsx`。
 *
 * ⚠️ 组件那边**不许再手写这几组坐标**——两处各写一份必然走岔，那时守卫测试
 * 守的是一份影子副本，等于没守。
 */

/**
 * 标签字号：整张图随容器等比缩放。
 *
 * 这个数是**被两端夹出来的**，改之前先看这三个数（2026-09-23 实测）：
 *   - 桌面 1440：图版里 venn 渲染宽 468（缩放 1.30）→ 字号落到 17.6px，胶囊高 30px
 *   - 手机 390：同一张图只剩 298 宽（缩放 0.83）→ 字号落到 **11.2px**
 *   - 手机地板：站内最小的文字是 `text-[11px]`（表格副行）。再小就是在图里放「小字注解」，
 *     读不清等于没标
 *
 * 试过 11.5（验收稿那版），桌面确实更秀气、胶囊更薄，但手机上落到 **9.5px**——
 * 直接踩穿地板，曲线那侧（viewBox 420 更宽）只剩 8.9px。**秀气不能拿可读性换**。
 * 曲线的窄屏更吃紧是它的 viewBox 比 venn 宽所致，属于既有状况（上一版同值），
 * 要真正解决得让它在窄屏换一套版式，不在这一轮的范围里。
 */
export const LABEL_FS = 13.5;

/**
 * 中央结论字号。上限是**被几何卡死的**：最长那行「投资价值较高」6 字，
 * 6 × 13.5 = 81 用户单位，而棱镜直径只有 90——再大一档文字就顶出那圈冰白细环了
 * （改它之前先量这个乘积，或同步调 `VENN_LENS_R`）。
 */
export const CENTER_FS = 13.5;

/** 胶囊内边距：左右 7、上下 4.75（与「光学玻璃」画法的验收稿同值） */
export const PILL_PAD_X = 7;
export const PILL_PAD_Y = 4.75;

/**
 * 文字宽度估算：全角（CJK / 全角标点）按 **1 字宽**，半角（拉丁 / 数字）按 **0.55 字宽**。
 *
 * SVG 里量不出文字宽度（没有布局阶段），而胶囊的矩形得在渲染前定下来。
 * 只用于给胶囊定容，估算误差 ±1px 无妨——真正的误判是「整串按半角算」，
 * 那样 6 个汉字的胶囊会窄掉四成、文字直接溢出。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text)
    units += isFullWidth(ch) ? 1 : 0.55;
  return units * fontSize;
}

/**
 * 这个字符是不是「一字宽」的全角字。
 *
 * 用码点区间判断而不是正则区间：区间的两端在源码里是看不出边界的怪字，
 * 改坏了也没人发现（写正则时手滑一个字符，汉字的宽度就整体算错）。
 */
function isFullWidth(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  // CJK 部首扩展 ~ 汉字（2E80–9FFF）｜CJK 标点（3000–303F）｜全角形式（FF00–FFEF）
  return (code >= 0x2E80 && code <= 0x9FFF)
    || (code >= 0x3000 && code <= 0x303F)
    || (code >= 0xFF00 && code <= 0xFFEF);
}

/** 一枚胶囊标签 */
export interface DiagramLabel {
  text: string;
  /** 胶囊锚点 x（anchor=middle 时是中心，anchor=end 时是右缘） */
  x: number;
  /** 胶囊竖向中心 y */
  y: number;
  anchor: "middle" | "end";
  /** 语气：cool = 主色冰蓝；warm = pending 暖黄（止盈 / 高估那一档） */
  tone: "cool" | "warm";
  /** 这个标签标注的锚点（曲线上的点）。有它就要求「要么同 x、要么引线」 */
  dot?: { x: number; y: number };
  /** 与锚点不同 x 时用引线连过去（现在只有「分批止盈」需要） */
  leader?: boolean;
}

export interface PillRect { x: number; y: number; w: number; h: number }

/** 胶囊的矩形（左上角 + 宽高），渲染与守卫测试共用同一份推导 */
export function pillRect(label: DiagramLabel, fontSize = LABEL_FS): PillRect {
  const w = estimateTextWidth(label.text, fontSize) + PILL_PAD_X * 2;
  const h = fontSize + PILL_PAD_Y * 2;
  return {
    x: label.anchor === "middle" ? label.x - w / 2 : label.x - w,
    y: label.y - h / 2,
    w,
    h,
  };
}

/**
 * 引线：胶囊右缘中点 → 它标注的锚点。只有 `leader: true` 的标签有。
 * 没有引线时标签必须与锚点同 x（守卫测试钉着这条）。
 */
export function labelLeader(label: DiagramLabel): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!label.leader || !label.dot)
    return null;
  const r = pillRect(label);
  return { x1: r.x + r.w, y1: label.y, x2: label.dot.x, y2: label.dot.y };
}

// ─────────────────────────── 三圈交叉图 ───────────────────────────

export const VENN_VIEW = { w: 360, h: 250 } as const;
/** 三个顶点围成的等边三角形的重心 */
export const VENN_CENTER = { x: 180, y: 140 } as const;
/** 外圈半径：要保证三圈两两相交且都盖住重心（顶点距重心 58 < 62） */
export const VENN_R = 62;
/** 中心镜片半径。被最长那行文案（「投资价值较高」6 字 ≈ 81px）撑出来的 */
export const VENN_LENS_R = 45;
/** 镜片外那圈细环的半径（定投品种是实线、基金选择是虚线刻度环） */
export const VENN_RING_R = 52;
/**
 * 标签中心到重心的距离。被**标签宽度**卡出来的，不是被圆卡出来的：
 * 78 的时候胶囊内端离中心镜片只剩 2px，视觉上直接贴在深色圆边上（截图走查）；
 * 98 留出足够余量，且左右两枚仍隔着 70+ 单位不咬字。
 */
export const VENN_LABEL_DIST = 98;
/** 顶点（各圈圆心）与「重心 → 顶点」三个方向，依次为上 / 左下 / 右下 */
export const VENN_VERTICES = [
  { x: 180, y: 82, g: "a" },
  { x: 129.8, y: 169, g: "b" },
  { x: 230.2, y: 169, g: "c" },
] as const;
export const VENN_DIRS = [
  { x: 0, y: -1 },
  { x: -0.866, y: 0.5 },
  { x: 0.866, y: 0.5 },
] as const;

/** 三枚外圈标签的位置：沿各自顶点方向、离重心 VENN_LABEL_DIST */
export function vennLabels(labels: readonly [string, string, string]): DiagramLabel[] {
  return VENN_DIRS.map((d, i) => ({
    text: labels[i]!,
    x: VENN_CENTER.x + d.x * VENN_LABEL_DIST,
    y: VENN_CENTER.y + d.y * VENN_LABEL_DIST,
    anchor: "middle" as const,
    tone: "cool" as const,
  }));
}

// ─────────────────────────── 定投方法曲线 ───────────────────────────

export const CURVE_VIEW = { w: 420, h: 196 } as const;
/** 面积填充的基线：正好在谷底之下、标签之上 */
export const CURVE_BASELINE = 150;
/**
 * 曲线锚点：起点 → 下跌途中 → 谷底 → 与高估线相交处 → 末端。
 *
 * 末端刻意**停在画布右缘之外**（420 就是画布宽度）：曲线与面积一起出画，
 * 像一张还在往上走的图。停在 390 会留下一块平顶，看着像台子。
 */
export const CURVE_POINTS = [
  { x: 52, y: 110 },
  { x: 112, y: 132 },
  { x: 190, y: 140 },
  { x: 300, y: 70 },
  { x: 420, y: 10 },
] as const;
/** 高估阈值虚线：y 与「曲线和高估线的交点」同高 */
export const CURVE_DASH = { y: 70, x1: 195, x2: 412 } as const;
/** 底部三条极淡的水平参考线（给曲线一个「坐标系」的暗示，不抢戏） */
export const CURVE_GUIDES = [110, 140, 150] as const;

/**
 * 曲线上的四个关键点标签。
 *
 * 每个标签**要么与它那个锚点同 x**（开始定投 / 下跌坚持 / 低点多投），
 * **要么用引线连过去**（分批止盈）——后者是被曲线逼出来的：它上方是那段陡升的
 * 曲线，居中放在点上方必然被线穿过（试过，x=333 处必撞），所以往左上挪、
 * 用一根引线接回交点。引线长 37，仍在「一眼看得出连着谁」的范围内。
 *
 * 「高估」不标点，它标的是那条虚线本身，所以挂在虚线的右端外侧。
 */
export const CURVE_LABELS: readonly DiagramLabel[] = [
  { text: "开始定投", x: 52, y: 176, anchor: "middle", tone: "cool", dot: { x: 52, y: 110 } },
  { text: "低点多投", x: 190, y: 176, anchor: "middle", tone: "cool", dot: { x: 190, y: 140 } },
  { text: "下跌坚持", x: 112, y: 104, anchor: "middle", tone: "cool", dot: { x: 112, y: 132 } },
  { text: "分批止盈", x: 274, y: 44, anchor: "end", tone: "warm", dot: { x: 300, y: 70 }, leader: true },
  { text: "高估", x: 412, y: 52, anchor: "end", tone: "warm" },
];
