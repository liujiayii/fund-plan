import type { DiagramLabel, PillRect } from "~/domain/plan-diagram";
import { describe, expect, it } from "vitest";
import {
  CURVE_DASH,
  CURVE_LABELS,
  CURVE_VIEW,
  estimateTextWidth,
  labelLeader,
  pillRect,
  VENN_CENTER,
  VENN_LABEL_DIST,
  VENN_LENS_R,
  VENN_VIEW,
  vennLabels,
} from "~/domain/plan-diagram";

/**
 * 理念三图的几何守卫（2026-09-22 第四版「标签胶囊化」时立的钉子）。
 *
 * 为什么值得测：这三张图的丑与对，历史上全栽在同一类事上，而且**都靠人眼截图
 * 才抓到**——贵且容易漏：
 *   - 「开始定投」的文字没跟它的点同 x（anchor=start 的半个字宽）
 *   - 「下跌坚持」只有标签没有点
 *   - venn 的外圈标签离中心镜片只剩 2px，视觉上贴在深色圆边上
 *   - hero 的硬币圆心 186 + 半径 16 = 202，出了 viewBox 宽度 200，右边被裁
 *   - 「分批止盈」居中放在点的上方，x=333 处必然被陡升的曲线穿过
 *
 * 这几条本质是**几何不变量**，不该靠肉眼：胶囊不许出画布、胶囊之间不许咬字、
 * 标签不许侵入中心镜片、标签要么与锚点同 x 要么用引线连过去。
 * 几何是纯数据（app/domain/plan-diagram.ts），node 环境毫秒级跑完。
 */

/** 矩形间的最近距离（分离量）：负数表示重叠，返回负的重叠深度 */
function rectGap(a: PillRect, b: PillRect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (dx > 0 || dy > 0)
    return Math.max(dx, dy);
  return Math.max(dx, dy); // 两个都 ≤0：取较大的那个 = 重叠最浅的一轴
}

/** 矩形到点的最近距离（点在矩形内时为 0） */
function rectPointDistance(r: PillRect, p: { x: number; y: number }): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** 所有标签（两张 venn 复用一套几何，用最长的那组文案当最坏情况） */
const VENN_LONG_LABELS = vennLabels(["宽基指数基金", "策略指数基金", "行业指数基金"]);
const VENN_SHORT_LABELS = vennLabels(["费率较低", "跟踪误差较小", "规模较大"]);
const ALL_PILLS: { name: string; rect: PillRect }[] = [
  ...VENN_LONG_LABELS.map(l => ({ name: l.text, rect: pillRect(l) })),
  ...CURVE_LABELS.map(l => ({ name: l.text, rect: pillRect(l) })),
];

describe("理念三图几何", () => {
  it("胶囊宽度按字数估算：全角整字宽、半角约半字宽", () => {
    expect(estimateTextWidth("低估阶段", 13.5)).toBeCloseTo(54);
    expect(estimateTextWidth("500", 13.5)).toBeCloseTo(3 * 0.55 * 13.5);
    // 半角混全角：先算单位数再乘字号
    expect(estimateTextWidth("中证500", 13.5)).toBeCloseTo((2 + 1.65) * 13.5);
  });

  it("每个胶囊都落在自己的画布内（含 2 单位余量）", () => {
    const canvases = [
      ...VENN_LONG_LABELS.map(l => ({ l, v: VENN_VIEW })),
      ...VENN_SHORT_LABELS.map(l => ({ l, v: VENN_VIEW })),
      ...CURVE_LABELS.map(l => ({ l, v: CURVE_VIEW })),
    ];
    for (const { l, v } of canvases) {
      const r = pillRect(l);
      expect(r.x, `${l.text} 左缘`).toBeGreaterThanOrEqual(2);
      expect(r.y, `${l.text} 上缘`).toBeGreaterThanOrEqual(2);
      expect(r.x + r.w, `${l.text} 右缘`).toBeLessThanOrEqual(v.w - 2);
      expect(r.y + r.h, `${l.text} 下缘`).toBeLessThanOrEqual(v.h - 2);
    }
  });

  it("同图内的胶囊互不咬字（最小间隙 4）", () => {
    const groups: [string, DiagramLabel[]][] = [
      ["venn 长文案", VENN_LONG_LABELS],
      ["venn 短文案", VENN_SHORT_LABELS],
      ["曲线", [...CURVE_LABELS]],
    ];
    for (const [group, labels] of groups) {
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const gap = rectGap(pillRect(labels[i]!), pillRect(labels[j]!));
          expect(gap, `${group}：「${labels[i]!.text}」与「${labels[j]!.text}」`).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("venn 标签落在「重心 → 顶点」的射线上，且离重心等距", () => {
    const venn = [VENN_LONG_LABELS, VENN_SHORT_LABELS];
    for (const labels of venn) {
      for (const l of labels) {
        const dx = l.x - VENN_CENTER.x;
        const dy = l.y - VENN_CENTER.y;
        expect(Math.hypot(dx, dy), `${l.text} 到重心的距离`).toBeCloseTo(VENN_LABEL_DIST, 1);
      }
    }
    // 三个方向互不相同（不重叠成一点）
    const dirs = VENN_LONG_LABELS.map(l => `${l.x.toFixed(1)},${l.y.toFixed(1)}`);
    expect(new Set(dirs).size).toBe(3);
  });

  it("venn 胶囊不侵入中心镜片（留 4 单位余量）", () => {
    for (const labels of [VENN_LONG_LABELS, VENN_SHORT_LABELS]) {
      for (const l of labels) {
        const d = rectPointDistance(pillRect(l), VENN_CENTER);
        expect(d, `${l.text} 到镜片必留 ${VENN_LENS_R}+4`).toBeGreaterThanOrEqual(VENN_LENS_R + 4);
      }
    }
  });

  it("曲线标签要么与它标注的锚点同 x，要么用引线连过去", () => {
    for (const l of CURVE_LABELS) {
      if (!l.dot)
        continue;
      const leader = labelLeader(l);
      if (leader) {
        // 引线终点必须正是那个锚点，且够短（长引线在窄屏上读不出来）
        expect(leader.x2, `${l.text} 引线终点 x`).toBe(l.dot.x);
        expect(leader.y2, `${l.text} 引线终点 y`).toBe(l.dot.y);
        expect(Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1)).toBeLessThanOrEqual(48);
        // 引线不打别人：沿线取点，不许落进任何其它胶囊
        for (let t = 0; t <= 1; t += 0.05) {
          const p = { x: leader.x1 + (leader.x2 - leader.x1) * t, y: leader.y1 + (leader.y2 - leader.y1) * t };
          for (const other of ALL_PILLS) {
            if (other.name === l.text)
              continue;
            expect(rectPointDistance(other.rect, p), `${l.text} 引线穿过了「${other.name}」`).toBeGreaterThan(0);
          }
        }
      }
      else {
        expect(l.x, `${l.text} 应与锚点同 x`).toBe(l.dot.x);
      }
    }
  });

  it("没有胶囊压在高估虚线上", () => {
    const line = { y: CURVE_DASH.y, x1: CURVE_DASH.x1, x2: CURVE_DASH.x2 };
    for (const l of CURVE_LABELS) {
      const r = pillRect(l);
      const xOverlap = r.x < line.x2 && r.x + r.w > line.x1;
      const yStraddle = r.y <= line.y + 2 && r.y + r.h >= line.y - 2;
      expect(xOverlap && yStraddle, `${l.text} 压在高估虚线上`).toBe(false);
    }
  });
});
