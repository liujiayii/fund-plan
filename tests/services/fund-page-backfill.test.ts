import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "~/db/client";
import { fund, fundNav } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { loader } from "~/routes/funds.$code";
import { CloudflareContext } from "../../workers/app";

/**
 * 基金详情页的长历史回填：**访客不该替全网等 8s**。
 *
 * 2026-09-23 实测：从 CF 边缘打 lsjz 单页要 7~8s（4 次探针 TTFB 6.8~8.5s）。
 * 所以分两档：
 *  - 库里**有数据但残缺** → 现有数据先渲染，回填丢 `ctx.waitUntil`；
 *  - 库里**一行都没有** → 这一页没数据就是废页（爬虫只来一次），仍然等它拉完。
 *
 * 直接调 loader（不经 fetch handler）：context 用伪对象，`ctx.waitUntil` 的任务
 * 被捕获成数组，测试里显式 await——workerd 里没人帮你等它跑完。
 * 东财接口一律 stub（其余接口回空，各 parser 都按「拉不到就降级」处理）。
 */

/** 伪 context：与 RouterContextProvider 同形，只实现 get；waitUntil 收进数组 */
function makeContext(bag: { tasks: Promise<unknown>[] }): unknown {
  return {
    get: (key: unknown) =>
      key === CloudflareContext
        ? { env, ctx: { waitUntil: (p: Promise<unknown>) => bag.tasks.push(p) } }
        : undefined,
  };
}

function callLoader(code: string, bag: { tasks: Promise<unknown>[] }) {
  return loader({
    request: new Request(`https://x.dev/funds/${code}`),
    context: makeContext(bag),
    params: { code },
  } as never);
}

/** lsjz 可注入延迟与行数；其余东财接口一律回空（页面照常降级渲染） */
function stubEastmoney(
  opts: { lsjzDelayMs?: number; navs?: number; state?: { lsjzDone: boolean } } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/f10/lsjz")) {
        if (opts.lsjzDelayMs)
          await new Promise(r => setTimeout(r, opts.lsjzDelayMs));
        if (opts.state)
          opts.state.lsjzDone = true;
        const n = opts.navs ?? 3;
        return new Response(
          JSON.stringify({
            TotalCount: n,
            Data: {
              LSJZList: Array.from({ length: n }, (_, i) => ({
                FSRQ: `2026-09-${String(20 - i).padStart(2, "0")}`,
                DWJZ: "1.5000",
                LJJZ: "1.5000",
                JZZZL: "0",
              })),
            },
          }),
        );
      }
      return new Response(JSON.stringify({ Datas: null, data: null }));
    }),
  );
}

async function reset() {
  const db = getDb(env.DB);
  await db.delete(fundNav);
  await db.delete(fund);
}

/** 建一只基金：navBackfilledAt=null 让闸门放行，updatedAt 新鲜以免触发档案刷新 */
async function seedFund(code = "028439") {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: "测试新基金C",
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
    navBackfilledAt: null,
  });
}

async function seedNavs(code: string, dates: string[]) {
  const db = getDb(env.DB);
  for (const navDate of dates) {
    await db.insert(fundNav).values({
      fundCode: code,
      navDate,
      unitNav: 10000,
      accNav: 10000,
      growthRate: 0,
    });
  }
}

beforeEach(async () => {
  await reset();
  vi.unstubAllGlobals();
});

describe("基金详情页回填：访客不被回填挡住", () => {
  it("有数据但残缺：现有序列先渲染，回填丢后台", async () => {
    const db = getDb(env.DB);
    await seedFund();
    await seedNavs("028439", ["2026-09-10", "2026-09-11"]);
    // 用「lsjz 什么时候回」这个事实做断言，而不是墙钟阈值——
    // loader 在 lsjz 还没回来时就该已经返回了（真网络下那要等 7~8s）
    const state = { lsjzDone: false };
    stubEastmoney({ lsjzDelayMs: 800, state });

    const bag = { tasks: [] as Promise<unknown>[] };
    const data = (await callLoader("028439", bag)) as { series: unknown[] };

    expect(state.lsjzDone).toBe(false);
    expect(data.series).toHaveLength(2);
    expect(bag.tasks).toHaveLength(1);

    // 后台任务真的补了数据（下一次访问/爬虫就能看到）
    await Promise.all(bag.tasks);
    expect(state.lsjzDone).toBe(true);
    const rows = await db
      .select()
      .from(fundNav)
      .where(eq(fundNav.fundCode, "028439"));
    expect(rows.length).toBe(5);
  });

  it("库里一行都没有：等它拉完再渲染（没数据的页是废页）", async () => {
    await seedFund();
    stubEastmoney({ navs: 2 });

    const bag = { tasks: [] as Promise<unknown>[] };
    const data = (await callLoader("028439", bag)) as { series: unknown[] };

    expect(data.series).toHaveLength(2);
    expect(bag.tasks).toHaveLength(0);
  });
});
