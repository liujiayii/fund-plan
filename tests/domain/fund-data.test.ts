import type { Db } from "~/db/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureFund,
  fetchAssetAllocation,
  fetchBonusHistory,
  fetchFundBasic,
  fetchFundDetail,
  fetchFundPosition,
  fetchFundRank,
  fetchIndexNav,
  fetchInvestStyle,
  fetchManagerInfo,
  fetchNavHistory,
  fetchNavHistoryDetailed,
  parseFundListJs,
  percentToRate,
  searchFunds,
} from "~/services/fund-data";

/**
 * 数据接入层测试。全部 stub fetch，不打真网——
 * 真接口会变、会限流、会超时，测试必须稳定可复现。
 *
 * 这里的固定响应取自 2026-08-25 对东财接口的真实抓取，
 * 字段名与结构与线上一致。
 */

/** 假 KV 的一次写：留档 key 与选项，写预算守卫要靠它检查 TTL */
interface FakePut {
  key: string;
  value: string;
  options?: KVNamespacePutOptions;
}

/**
 * 造一个假的 KV，行为足够真：存得进、取得出、能过期。
 *
 * `putFails` 模拟额度打满（免费版 1000 写/天，超了与 API 均返回 429 并抛错）——
 * 用来钉死「写缓存失败绝不能连累已经抓到的数据」。
 */
function fakeKV(opts: { putFails?: boolean } = {}) {
  const store = new Map<string, string>();
  const puts: FakePut[] = [];
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, options?: KVNamespacePutOptions) {
      if (opts.putFails)
        throw new Error("KV PUT failed: 429 Too Many Requests");
      store.set(key, value);
      puts.push({ key, value, options });
    },
    _store: store,
    _puts: puts,
  } as unknown as KVNamespace & { _store: Map<string, string>; _puts: FakePut[] };
}

function fakeEnv(kv = fakeKV()) {
  return { KV: kv } as unknown as Env;
}

/**
 * 按 URL 关键字路由的 fetch 桩：一个测试要同时喂多个接口时用
 * （基金页一次并发打 7 个东财接口，每个响应形状都不同）。
 */
function stubRoutedFetch(routes: [match: string, payload: unknown][]) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([match]) => url.includes(match));
    if (!hit)
      throw new Error(`未打桩的 URL：${url}`);
    return new Response(JSON.stringify(hit[1]));
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("percentToRate 费率解析", () => {
  it("带百分号的字符串转万分之整数", () => {
    expect(percentToRate("1.50%")).toBe(150);
    expect(percentToRate("0.15%")).toBe(15);
    expect(percentToRate("0%")).toBe(0);
  });

  it("不带百分号也按百分比理解", () => {
    expect(percentToRate("1.5")).toBe(150);
    expect(percentToRate("0.15")).toBe(15);
  });

  it("异常输入回退为 0", () => {
    expect(percentToRate("--")).toBe(0);
    expect(percentToRate("")).toBe(0);
    expect(percentToRate("暂无")).toBe(0);
  });

  it("四位以上小数四舍五入到万分之整数", () => {
    expect(percentToRate("0.123%")).toBe(12); // 0.00123 → 12.3 → 12
  });
});

describe("searchFunds 基金搜索", () => {
  const searchResponse = {
    ErrCode: 0,
    Datas: [
      {
        CODE: "000001",
        NAME: "华夏成长混合",
        FundBaseInfo: { FTYPE: "混合型-灵活" },
      },
      {
        CODE: "110022",
        NAME: "易方达消费行业股票",
        FundBaseInfo: { FTYPE: "股票型" },
      },
    ],
  };

  it("解析出 code / name / type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(searchResponse))),
    );
    const r = await searchFunds(fakeEnv(), "000001");
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      code: "000001",
      name: "华夏成长混合",
      type: "混合型-灵活",
    });
  });

  it("结果写入 KV 缓存，第二次不再打网络", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(searchResponse)));
    vi.stubGlobal("fetch", spy);
    const env = fakeEnv();

    await searchFunds(env, "华夏");
    await searchFunds(env, "华夏");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("空结果不写 KV——搜索是唯一无界的写通道，别让随机词把它刷爆", async () => {
    const kv = fakeKV();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Datas: [] }))),
    );
    const env = fakeEnv(kv);

    expect(await searchFunds(env, "查无此基")).toEqual([]);
    expect(kv._puts).toHaveLength(0);
    // 空结果每次回源：上游是廉价的搜索接口，比「额度被遍历的词吃光」划算得多
    expect(await searchFunds(env, "查无此基")).toEqual([]);
    expect(kv._puts).toHaveLength(0);
  });

  it("关键词归一化：首尾空白 / 大小写 / 连续空白折叠成同一个 key", async () => {
    const kv = fakeKV();
    const spy = vi.fn(async () => new Response(JSON.stringify(searchResponse)));
    vi.stubGlobal("fetch", spy);
    const env = fakeEnv(kv);

    await searchFunds(env, "  CSI  300 ");
    await searchFunds(env, "csi 300");

    expect(spy).toHaveBeenCalledTimes(1);
    expect([...kv._store.keys()]).toEqual(["fund:search:csi 300"]);
  });

  it("超长关键词截断到 32 字符（key 长度不被长串撑爆）", async () => {
    const kv = fakeKV();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(searchResponse))),
    );

    await searchFunds(fakeEnv(kv), "长".repeat(200));

    expect([...kv._store.keys()]).toEqual([`fund:search:${"长".repeat(32)}`]);
  });

  it("网络异常时回退缓存而不是崩溃", async () => {
    const kv = fakeKV();
    const env = fakeEnv(kv);

    // 先成功一次把缓存喂进去
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(searchResponse))),
    );
    await searchFunds(env, "华夏");

    // 再让网络挂掉，应当仍能从缓存拿到结果
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const r = await searchFunds(env, "华夏");
    expect(r).toHaveLength(2);
  });

  it("网络异常且无缓存时返回空数组（不抛错，保证页面可用）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const r = await searchFunds(fakeEnv(), "不存在");
    expect(r).toEqual([]);
  });

  it("空关键词直接返回空数组，不打网络", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await searchFunds(fakeEnv(), "   ")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("fetchFundBasic 基金档案", () => {
  const basicResponse = {
    Datas: {
      FCODE: "000001",
      SHORTNAME: "华夏成长混合",
      FTYPE: "混合型-灵活",
      SOURCERATE: "1.50%",
      RATE: "0.15%",
      MINSG: "10",
      RISKLEVEL: "4",
      SGZT: "开放申购",
      SHZT: "开放赎回",
      DWJZ: "1.2970",
    },
  };

  it("解析费率取优惠后的 RATE，起购金额转成分", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(basicResponse))),
    );
    const r = await fetchFundBasic(fakeEnv(), "000001");
    expect(r).not.toBeNull();
    expect(r!.code).toBe("000001");
    expect(r!.name).toBe("华夏成长混合");
    expect(r!.type).toBe("混合型-灵活");
    expect(r!.purchaseRate).toBe(15); // 0.15% → 万分之 15
    expect(r!.minPurchaseCents).toBe(1000); // 10 元 → 1000 分
    expect(r!.riskLevel).toBe(4);
    expect(r!.status).toBe("开放申购");
    expect(r!.redeemStatus).toBe("开放赎回"); // SHZT：2026-09-08 起 FundDetail 复用它
  });

  it("RATE 缺失时回退用 SOURCERATE", async () => {
    const noRate = {
      Datas: { ...basicResponse.Datas, RATE: "--" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(noRate))),
    );
    const r = await fetchFundBasic(fakeEnv(), "000001");
    expect(r!.purchaseRate).toBe(150); // 回退 1.50%
  });

  it("接口返回空数据时返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Datas: null }))),
    );
    expect(await fetchFundBasic(fakeEnv(), "999999")).toBeNull();
  });

  it("网络异常时返回 null 而不抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchFundBasic(fakeEnv(), "000001")).toBeNull();
  });
});

describe("fetchNavHistory 历史净值", () => {
  const navResponse = {
    Data: {
      LSJZList: [
        {
          FSRQ: "2026-08-24",
          DWJZ: "1.2970",
          LJJZ: "3.8700",
          JZZZL: "-2.41",
        },
        {
          FSRQ: "2026-08-21",
          DWJZ: "1.3290",
          LJJZ: "3.9020",
          JZZZL: "0.45",
        },
      ],
    },
  };

  it("净值字符串精确转成 ×10000 整数", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(navResponse))),
    );
    const rows = await fetchNavHistory(fakeEnv(), "000001");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      navDate: "2026-08-24",
      unitNav: 12970,
      accNav: 38700,
      growthRate: -241, // -2.41% → 万分之 -241
    });
  });

  it("涨跌率为空时按 0 处理", async () => {
    const blank = {
      Data: {
        LSJZList: [
          { FSRQ: "2026-08-24", DWJZ: "1.0000", LJJZ: "1.0000", JZZZL: "" },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(blank))),
    );
    const rows = await fetchNavHistory(fakeEnv(), "000001");
    expect(rows[0].growthRate).toBe(0);
  });

  it("请求带 Referer 头（东财防盗链要求）", async () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(navResponse)),
    );
    vi.stubGlobal("fetch", spy);
    await fetchNavHistory(fakeEnv(), "000001");

    const init = spy.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Referer")).toContain("eastmoney.com");
  });

  it("网络异常时返回空数组（撮合会因此让订单顺延，不误判失败）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    expect(await fetchNavHistory(fakeEnv(), "000001")).toEqual([]);
  });

  // 2026-09-23 新增：边缘打 lsjz 实测单页要 7~8s，正贴着我们 8s 的超时线
  // （4 次探针访问 TTFB 6.8~8.5s）。所以超时必须可注入——
  // cron 与页面后台回填没人等，给它们更宽的余量。
  it("超时可注入：挂住的接口按注入值放弃，不等默认的 8s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted", "AbortError")));
          }),
      ),
    );
    const t0 = Date.now();
    const rows = await fetchNavHistory(fakeEnv(), "000001", 60, 30);
    expect(rows).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(3000);
    // 15s 上限：修前会等默认的 8s，别被 vitest 的 5s 默认值提前掐断
  }, 15_000);

  it("某一波翻页全失败就收手，不把剩余波次一路打完", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls++;
        const idx = Number(/pageIndex=(\d+)/.exec(url)?.[1] ?? 1);
        if (idx > 1)
          throw new Error("Network connection lost");
        return new Response(
          JSON.stringify({
            TotalCount: 400,
            Data: {
              LSJZList: Array.from({ length: 20 }, (_, i) => ({
                FSRQ: `2026-01-${String(i + 1).padStart(2, "0")}`,
                DWJZ: "1.0000",
                LJJZ: "1.0000",
                JZZZL: "0",
              })),
            },
          }),
        );
      }),
    );

    const rows = await fetchNavHistory(fakeEnv(), "000001", 400);

    expect(rows).toHaveLength(20); // 首页已到手的照常返回
    // 首页 + 第一波 5 页；之后收手（修前会把剩下 14 页也打完）
    expect(calls).toBe(6);
  });

  // 2026-09-23 CodeRabbit 评审：调用方必须能分辨「部分成功」——
  // 否则回填闸门会把「库里只有首页那 20 行」记成「拉取成功」而锁满 6 小时

  /** 造一页 20 行的响应（东财单页上限） */
  const pageOf20 = (month: string) =>
    Array.from({ length: 20 }, (_, i) => ({
      FSRQ: `2026-${month}-${String(i + 1).padStart(2, "0")}`,
      DWJZ: "1.0000",
      LJJZ: "1.0000",
      JZZZL: "0.5",
    }));

  it("整波全败：返回已到手的部分行，但 complete=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const idx = Number(/pageIndex=(\d+)/.exec(url)?.[1] ?? 1);
        if (idx > 1)
          throw new Error("Network connection lost");
        return new Response(
          JSON.stringify({ TotalCount: 400, Data: { LSJZList: pageOf20("03") } }),
        );
      }),
    );

    const r = await fetchNavHistoryDetailed(fakeEnv(), "000001", 400);

    expect(r.rows).toHaveLength(20);
    expect(r.complete).toBe(false);
  });

  it("翻完计划页数：complete=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const idx = Number(/pageIndex=(\d+)/.exec(url)?.[1] ?? 1);
        return new Response(
          JSON.stringify({
            TotalCount: 400,
            Data: { LSJZList: pageOf20(String(idx).padStart(2, "0")) },
          }),
        );
      }),
    );

    const r = await fetchNavHistoryDetailed(fakeEnv(), "000001", 60);

    expect(r.rows).toHaveLength(60);
    expect(r.complete).toBe(true);
  });

  it("遇到短页（上游没有更多数据）：仍算完整", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const idx = Number(/pageIndex=(\d+)/.exec(url)?.[1] ?? 1);
        // 第 2 页只有 10 行 = 后面没数据了（TotalCount 不准时的兜底）
        const list = idx === 2 ? pageOf20("02").slice(0, 10) : pageOf20("03");
        return new Response(
          JSON.stringify({ TotalCount: 400, Data: { LSJZList: list } }),
        );
      }),
    );

    const r = await fetchNavHistoryDetailed(fakeEnv(), "000001", 60);

    expect(r.complete).toBe(true);
  });

  it("首屏就失败：空行 + complete=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );

    const r = await fetchNavHistoryDetailed(fakeEnv(), "000001");

    expect(r.rows).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it("要的条数超过单页上限时自动翻页拼齐（东财 lsjz 单页钳 20 行）", async () => {
    // 东财 2026 年起对 lsjz 单页钳制 20 行（pageSize 填大了也只回 20，
    // ≥400 直接回空）——要 400 天必须翻 20 页。这里 mock 三页拼 60 条。
    const mkPage = (offset: number) => ({
      TotalCount: 1657,
      Data: {
        LSJZList: Array.from({ length: 20 }, (_, i) => {
          const d = new Date(Date.UTC(2026, 7, 1 + offset + i));
          const iso = d.toISOString().slice(0, 10);
          return { FSRQ: iso, DWJZ: "1.0000", LJJZ: "1.0000", JZZZL: "0" };
        }),
      },
    });
    const pages = [mkPage(0), mkPage(20), mkPage(40)];
    const spy = vi.fn(async (url: string) => {
      const m = /pageIndex=(\d+)/.exec(url);
      const idx = m ? Number(m[1]) - 1 : 0;
      return new Response(JSON.stringify(pages[idx] ?? { Data: { LSJZList: [] } }));
    });
    vi.stubGlobal("fetch", spy);

    const rows = await fetchNavHistory(fakeEnv(), "000001", 60);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(60);
  });

  it("翻页时最后一页不满即停（不请求空页）", async () => {
    const page1 = {
      TotalCount: 30,
      Data: {
        LSJZList: Array.from({ length: 20 }, (_, i) => ({
          FSRQ: `2026-08-${String(31 - i).padStart(2, "0")}`,
          DWJZ: "1.0000",
          LJJZ: "1.0000",
          JZZZL: "0",
        })),
      },
    };
    const page2 = {
      TotalCount: 30,
      Data: {
        LSJZList: Array.from({ length: 10 }, (_, i) => ({
          FSRQ: `2026-08-${String(11 - i).padStart(2, "0")}`,
          DWJZ: "1.0000",
          LJJZ: "1.0000",
          JZZZL: "0",
        })),
      },
    };
    const spy = vi.fn(async (url: string) => {
      const m = /pageIndex=(\d+)/.exec(url);
      const idx = m ? Number(m[1]) - 1 : 0;
      return new Response(JSON.stringify(idx === 0 ? page1 : page2));
    });
    vi.stubGlobal("fetch", spy);

    const rows = await fetchNavHistory(fakeEnv(), "000001", 60);
    // 只要 60 条但第二页就凑齐了 30 条 TotalCount——到 TotalCount 即停
    expect(spy).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(30);
  });

  it("净值缺失或非法的行被跳过", async () => {
    const dirty = {
      Data: {
        LSJZList: [
          { FSRQ: "2026-08-24", DWJZ: "", LJJZ: "1.0", JZZZL: "0" },
          { FSRQ: "2026-08-21", DWJZ: "1.5000", LJJZ: "1.5", JZZZL: "0" },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(dirty))),
    );
    const rows = await fetchNavHistory(fakeEnv(), "000001");
    expect(rows).toHaveLength(1);
    expect(rows[0].navDate).toBe("2026-08-21");
  });
});

describe("parseFundListJs 全量列表兜底解析", () => {
  it("从 JS 变量声明里抠出基金数组", () => {
    const js = `var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","HUAXIA"],["110022","YFDXFHYGP","易方达消费行业股票","股票型","YIFANGDA"]];`;
    const list = parseFundListJs(js);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      code: "000001",
      name: "华夏成长混合",
      type: "混合型-灵活",
    });
  });

  it("内容异常时返回空数组而不抛错", () => {
    expect(parseFundListJs("这不是合法的 JS")).toEqual([]);
    expect(parseFundListJs("")).toEqual([]);
  });
});

describe("fetchFundRank 排行榜", () => {
  // rankhandler 返回 `var rankData = {datas:["..."],...};`
  const rankResp = `var rankData = {datas:["018751,山证混合C,SZ,2026-08-25,1.4142,1.4142,-2.63,10.67,36.03,19.98,-0.39,18.91"],allRecords:1};`;

  it("解析出代码/名称/净值/日涨跌/近1月收益率(列8)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rankResp)));
    const r = await fetchFundRank(fakeEnv(), "hh", "1yzf", 8);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      code: "018751",
      name: "山证混合C",
      navDate: "2026-08-25",
      unitNav: 14142,
      growthRate: -263,
      periodRate: 3603,
    });
  });

  it("命中 KV 缓存时不打网络", async () => {
    const spy = vi.fn(async () => new Response(rankResp));
    vi.stubGlobal("fetch", spy);
    const env = fakeEnv();
    await fetchFundRank(env, "hh", "1yzf", 8);
    await fetchFundRank(env, "hh", "1yzf", 8);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("网络异常返回空数组", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await fetchFundRank(fakeEnv(), "hh", "1yzf", 8)).toEqual([]);
  });

  it("空收益率字段 → periodRate 为 null", async () => {
    // 字段 9 为空串（"3.4,,5.6" 之间），periodCol 指向它
    const blank = `var rankData = {datas:["000001,华夏成长,HX,2026-08-25,1.2345,1.2345,1.23,2.3,3.4,,5.6"]};`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blank)));
    const r = await fetchFundRank(fakeEnv(), "hh", "1yzf", 9);
    expect(r[0].periodRate).toBeNull();
  });
});

describe("fetchFundDetail 基金详情", () => {
  const detailResp = {
    Datas: {
      FCODE: "000001",
      JJJL: "郑晓辉,刘睿聪",
      JJGS: "华夏基金",
      ESTABDATE: "2001-12-18",
      ENDNAV: "3938207602.85",
      BENCH: "中证800成长",
      MGREXP: "1.20%",
      TRUSTEXP: "0.20%",
      // 2026-09-08 实测：评级字段是 RLEVEL_SZ（上证星级 1~5；此处取 3 便于断言解析）
      RLEVEL_SZ: "3",
    },
  };
  // SHZT（赎回状态）实测在 BasicInformation 响应里，fetchFundDetail 会并发
  // 复用 fetchFundBasic 补齐——stub 按域名分路喂两份响应
  const basicResp = {
    Datas: {
      FCODE: "000001",
      SHORTNAME: "华夏成长混合",
      FTYPE: "混合型-灵活",
      SOURCERATE: "1.50%",
      RATE: "0.15%",
      MINSG: "10",
      RISKLEVEL: "4",
      SGZT: "开放申购",
      SHZT: "开放赎回",
    },
  };

  it("解析经理/公司/成立日/规模/基准/费率/评级/赎回状态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("FundMNNBasicInformation")
          ? new Response(JSON.stringify(basicResp))
          : new Response(JSON.stringify(detailResp))),
    );
    const r = await fetchFundDetail(fakeEnv(), "000001");
    expect(r).not.toBeNull();
    expect(r!.manager).toBe("郑晓辉,刘睿聪");
    expect(r!.company).toBe("华夏基金");
    expect(r!.estabDate).toBe("2001-12-18");
    expect(r!.scaleYuan).toBe(3938207602.85);
    expect(r!.benchmark).toBe("中证800成长");
    expect(r!.mgmtFeeRate).toBe(120); // 1.20% → 万分之 120
    expect(r!.trustFeeRate).toBe(20);
    expect(r!.rating).toBe(3); // RLEVEL_SZ → 上证三星
    expect(r!.redeemStatus).toBe("开放赎回"); // 取自档案接口的 SHZT
  });

  it("规模 '--' 时 scaleYuan 为 null", async () => {
    const noScale = { Datas: { ...detailResp.Datas, ENDNAV: "--" } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(noScale))));
    expect((await fetchFundDetail(fakeEnv(), "000001"))!.scaleYuan).toBeNull();
  });

  it("评级 RLEVEL_SZ 异常值钳到 0~5：负数归 0、超界封顶 5", async () => {
    // CodeRabbit 评审：rating 透传东财，负数会让 "★".repeat 在渲染期抛
    // RangeError（整页白屏），超界值会把概况卡撑破——钳制做在解析处，
    // 该字段的所有消费方一起受保护
    const stubWith = (rlvel: string) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("FundMNNBasicInformation")
            ? new Response(JSON.stringify(basicResp))
            : new Response(JSON.stringify({ Datas: { ...detailResp.Datas, RLEVEL_SZ: rlvel } }))),
      );
    stubWith("-2");
    expect((await fetchFundDetail(fakeEnv(), "000001"))!.rating).toBe(0);
    stubWith("9");
    expect((await fetchFundDetail(fakeEnv(), "000001"))!.rating).toBe(5);
  });

  it("网络异常返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchFundDetail(fakeEnv(), "000001")).toBeNull();
  });
});

describe("fetchFundPosition 投资组合（股票/债券/行业）", () => {
  // 2026-09-08 实测：债券键名是 fundboods（接口自己的拼写），字段
  // ZQDM/ZQMC/ZJZBL；行业不在本接口，走独立的 FundMNSectorAllocation
  const posResp = {
    Datas: {
      fundStocks: [
        { GPDM: "300308", GPJC: "中际旭创", JZBL: "6.45", INDEXNAME: "通信", PCTNVCHGTYPE: "增持" },
        { GPDM: "688347", GPJC: "华虹宏力", JZBL: "5.57", INDEXNAME: "电子", PCTNVCHGTYPE: "增持" },
      ],
      fundboods: [
        { ZQDM: "019827", ZQMC: "26国债01", ZJZBL: "7.05" },
      ],
    },
  };
  const sectorResp = {
    Datas: [
      { HYMC: "制造业", SZ: "286612.688067", ZJZBL: "72.78" },
      { HYMC: "信息传输、软件和信息技术服务业", ZJZBL: "7.18" },
    ],
  };

  it("解析股票/债券/行业三视图", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("FundMNSectorAllocation")
          ? new Response(JSON.stringify(sectorResp))
          : new Response(JSON.stringify(posResp))),
    );
    const r = await fetchFundPosition(fakeEnv(), "000001");
    expect(r.stocks).toHaveLength(2);
    expect(r.stocks[0]).toEqual({
      code: "300308",
      name: "中际旭创",
      ratio: 645,
      industry: "通信",
      changeType: "增持",
    });
    expect(r.bonds).toEqual([{ code: "019827", name: "26国债01", ratio: 705 }]);
    expect(r.industries).toEqual([
      { name: "制造业", ratio: 7278 },
      { name: "信息传输、软件和信息技术服务业", ratio: 718 },
    ]);
  });

  it("网络异常返回三空数组", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchFundPosition(fakeEnv(), "000001")).toEqual({
      stocks: [],
      bonds: [],
      industries: [],
    });
  });
});

describe("fetchIndexNav 沪深300", () => {
  const indexResp = {
    data: { klines: ["2026-08-25,4542.24,4552.03", "2026-08-26,4549.43,4590.79"] },
  };

  it("解析日期/收盘", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(indexResp))));
    const r = await fetchIndexNav(fakeEnv(), "1.000300", 30);
    expect(r).toEqual([
      { date: "2026-08-25", close: 4552.03 },
      { date: "2026-08-26", close: 4590.79 },
    ]);
  });

  it("成功时双写：主缓存 + 无过期陈旧兜底 key", async () => {
    const kv = fakeKV();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(indexResp))));
    await fetchIndexNav(fakeEnv(kv), "1.000300", 30);
    const payload = JSON.stringify([
      { date: "2026-08-25", close: 4552.03 },
      { date: "2026-08-26", close: 4590.79 },
    ]);
    expect(kv._store.get("fund:index:1.000300:30")).toBe(payload);
    // 兜底 key 内容一致（fakeKV 不模拟 TTL，过期行为靠真实 KV 保证）
    expect(kv._store.get("fund:index:1.000300:30:stale")).toBe(payload);
  });

  it("拉取全灭但有陈旧兜底：返回旧数据，基准线仍可画", async () => {
    const kv = fakeKV();
    const stale = JSON.stringify([{ date: "2026-08-20", close: 4500.0 }]);
    kv._store.set("fund:index:1.000300:30:stale", stale);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network connection lost");
      }),
    );
    expect(await fetchIndexNav(fakeEnv(kv), "1.000300", 30))
      .toEqual([{ date: "2026-08-20", close: 4500.0 }]);
  });

  it("网络异常且无兜底（冷启动）返回空数组", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchIndexNav(fakeEnv(), "1.000300", 30)).toEqual([]);
  });

  // 2026-09-23 新增：push2his 被限流/被挡时可能回 HTTP 200 + data:null。
  // 原先只有 catch 出口读兜底缓存，这条出口直接返回空数组——
  // 基准线整段消失且不打任何日志（比抛异常更隐蔽）。
  it("HTTP 200 但 data 为空时同样走陈旧兜底", async () => {
    const kv = fakeKV();
    const stale = JSON.stringify([{ date: "2026-08-20", close: 4500.0 }]);
    kv._store.set("fund:index:1.000300:30:stale", stale);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: null }))),
    );
    expect(await fetchIndexNav(fakeEnv(kv), "1.000300", 30))
      .toEqual([{ date: "2026-08-20", close: 4500.0 }]);
  });

  it("HTTP 200 但 data 为空且无兜底（冷启动）返回空数组", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: null }))),
    );
    expect(await fetchIndexNav(fakeEnv(), "1.000300", 30)).toEqual([]);
  });

  // 2026-09-23 新增：窗口右端不能再取「今天」——盘中抓取会把当天实时价
  // 写进 7 天缓存并冻结。右端改用「最后已收盘的交易日」。
  it("盘中取数：窗口右端是上一个交易日，不是今天", async () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(indexResp)),
    );
    vi.stubGlobal("fetch", spy);
    // 2026-09-23 周三 北京 14:00（盘中）= UTC 06:00
    await fetchIndexNav(
      fakeEnv(),
      "1.000300",
      30,
      new Date("2026-09-23T06:00:00Z"),
    );
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("end=20260922");
    expect(url).toContain("beg=20260823");
  });
});

// ---------------------------------------------------------------------------
// 稳健档四接口（资产配置/历史分红/基金经理/投资风格）。
// 固定响应的形状取自 2026-09-08 对东财移动端接口的实测采样，
// 字段名（GP/ZQ/HB、FHINFO/FHFCZ、MGRNAME/LEMPDATE/PENAVGROWTH、TAGLIST/FEANAME）
// 与线上一致——东财改字段名时这里的解析断言会先红，页面不会静默退化成「—」。
// ---------------------------------------------------------------------------

describe("fetchAssetAllocation 资产配置", () => {
  // Datas 按报告期排列、最新在前，只取首行
  const allocResp = {
    Datas: [
      { GP: "85.23", ZQ: "5.10", HB: "9.67" },
      { GP: "80.00", ZQ: "10.00", HB: "10.00" },
    ],
  };

  it("解析最新报告期的股/债/现占比（百分数，非万分之）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(allocResp))));
    const r = await fetchAssetAllocation(fakeEnv(), "000001");
    expect(r).toEqual({ stocks: 85.23, bonds: 5.1, cash: 9.67 });
  });

  it("三项全 '--' 归一成 0 后视为无数据：返回 null 并写 'null' 哨兵缓存", async () => {
    const kv = fakeKV();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Datas: [{ GP: "--", ZQ: "--", HB: "--" }] }))),
    );
    const env = fakeEnv(kv);
    expect(await fetchAssetAllocation(env, "000001")).toBeNull();
    // 评审修正：无数据也落 KV——不写的话这类基金每次访问都实打东财
    expect(kv._store.get("fund:alloc:000001")).toBe("null");
  });

  it("无报告期（Datas:null，新基金）返回 null 并写 'null' 哨兵缓存", async () => {
    const kv = fakeKV();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Datas: null }))));
    const env = fakeEnv(kv);
    expect(await fetchAssetAllocation(env, "000001")).toBeNull();
    expect(kv._store.get("fund:alloc:000001")).toBe("null");
  });

  it("哨兵缓存命中：直接返回 null，不打网络", async () => {
    const kv = fakeKV();
    kv._store.set("fund:alloc:000001", "null");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchAssetAllocation(fakeEnv(kv), "000001")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("网络异常返回 null 且不写缓存（瞬时故障不落盘，下次访问还有机会）", async () => {
    const kv = fakeKV();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const env = fakeEnv(kv);
    expect(await fetchAssetAllocation(env, "000001")).toBeNull();
    expect(kv._store.size).toBe(0);
  });
});

describe("fetchBonusHistory 历史分红", () => {
  const bonusResp = {
    Datas: {
      // FHINFO：分红记录；FHFCZ 是「每份派现（元）」，展示口径是每 10 份
      FHINFO: [
        { FSRQ: "2025-11-20", FHFCZ: "0.07" },
        { FSRQ: "2025-05-15", FHFCZ: "0.15" },
        { FSRQ: "", FHFCZ: "0.10" }, // 缺除息日的脏行，应被过滤
      ],
    },
  };

  it("解析年份/每10份派现/除息日：FHFCZ ×10 走 Decimal 吃尾差，缺日期行过滤", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(bonusResp))));
    const r = await fetchBonusHistory(fakeEnv(), "000001");
    expect(r).toEqual([
      { year: "2025", per10Shares: 0.7, recordDate: "2025-11-20" },
      { year: "2025", per10Shares: 1.5, recordDate: "2025-05-15" },
    ]);
  });

  it("无分红基金（Datas:null）返回空数组并写 '[]' 空缓存", async () => {
    const kv = fakeKV();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Datas: null }))));
    const env = fakeEnv(kv);
    expect(await fetchBonusHistory(env, "000001")).toEqual([]);
    expect(kv._store.get("fund:bonus:000001")).toBe("[]");
  });

  it("网络异常返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchBonusHistory(fakeEnv(), "000001")).toBeNull();
  });
});

describe("fetchManagerInfo 基金经理", () => {
  const mgrResp = {
    // 每行是一段「管理团队任期」，现任段的 LEMPDATE 是 "--"
    Datas: [
      { MGRNAME: "张三", FEMPDATE: "2019-05-20", LEMPDATE: "--", PENAVGROWTH: "70.492" },
      { MGRNAME: "李四", FEMPDATE: "2015-01-01", LEMPDATE: "2023-12-31", PENAVGROWTH: "55.10" },
    ],
  };

  it("只取现任（LEMPDATE='--'），任期回报格式化为百分号串，规模/简介恒空串", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(mgrResp))));
    const r = await fetchManagerInfo(fakeEnv(), "000001");
    expect(r).toEqual([
      { name: "张三", workTime: "2019-05-20", fundSize: "", profit: "70.49%", resume: "" },
    ]);
  });

  it("无现任经理（Datas:null，指数基金）返回空数组并写 '[]' 空缓存", async () => {
    const kv = fakeKV();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Datas: null }))));
    const env = fakeEnv(kv);
    expect(await fetchManagerInfo(env, "000001")).toEqual([]);
    // 评审修正：空结果也落 KV——不写的话无经理基金每次访问都实打东财
    expect(kv._store.get("fund:manager:000001")).toBe("[]");
  });

  it("网络异常返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchManagerInfo(fakeEnv(), "000001")).toBeNull();
  });
});

describe("fetchInvestStyle 投资风格", () => {
  const styleResp = {
    // 标签混装：质量标签（十年优秀基等）与风格标签（「投资」前缀）同在 TAGLIST
    Datas: [
      { FEATYPE: "质量", TAGLIST: [{ FEANAME: "十年优秀基" }, { FEANAME: "优秀基金经理" }] },
      { FEATYPE: "风格", TAGLIST: [{ FEANAME: "投资大盘股" }, { FEANAME: "投资港股" }] },
    ],
  };

  it("只取「投资」前缀的风格标签，「 / 」串联；质量标签不混入", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(styleResp))));
    expect(await fetchInvestStyle(fakeEnv(), "000001")).toBe("投资大盘股 / 投资港股");
  });

  it("纯质量标签基金返回 null 并写 'null' 哨兵缓存", async () => {
    const kv = fakeKV();
    const pure = { Datas: [{ TAGLIST: [{ FEANAME: "十年优秀基" }] }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(pure))));
    const env = fakeEnv(kv);
    expect(await fetchInvestStyle(env, "000001")).toBeNull();
    expect(kv._store.get("fund:style:000001")).toBe("null");
  });

  it("网络异常返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await fetchInvestStyle(fakeEnv(), "000001")).toBeNull();
  });
});

/**
 * KV 写入预算守卫。
 *
 * 背景（2026-09-23）：收到 CF「Workers KV 操作数接近每日上限」告警。免费版写额度
 * 只有 1000 次/天（读是 10 万），而基金详情页对**每一只基金**要写 7 个缓存 key；
 * 线上库已有 113 只基金、sitemap 又把它们全量投给爬虫——单只基金当天被访问一次
 * 就是 113 × 7 ≈ 791 次写（79% 额度）。所以把「季度级变动」的那几个 key 统一挪到
 * 7 天档（见 CACHE_TTL 注释），把成本摊成「每只基金每天 ≤ 2 次写」。
 *
 * 这条守卫的作用：以后新增缓存 key、或把某个 TTL 改回 1 天，写量会重新爬上去，
 * 这里先红——逼一次有意识的额度核算，而不是等下一封告警邮件。
 */

/**
 * 基金页 loader 会调用的全部取数函数（注册表）。
 *
 * 9 个里：7 个各写一个 per-fund key；`ensureFund` 内部写 `fund:basic`（夹具用直接调
 * `fetchFundBasic` 模拟它的效果）；`fetchNavHistory` 只读写 D1、不碰 KV。
 */
const FUND_PAGE_FETCHERS = [
  "ensureFund",
  "fetchAssetAllocation",
  "fetchBonusHistory",
  "fetchFundDetail",
  "fetchFundPosition",
  "fetchIndexNav",
  "fetchInvestStyle",
  "fetchManagerInfo",
  "fetchNavHistory",
] as const;

describe("KV 写入预算守卫（免费版 1000 写/天）", () => {
  /** 冷启动一次基金页：7 个缓存接口全走一遍，收集各自写下的 key 与 TTL */
  async function coldStartPuts(): Promise<FakePut[]> {
    const kv = fakeKV();
    stubRoutedFetch([
      ["FundMNNBasicInformation", { Datas: { FCODE: "000001", SHORTNAME: "华夏成长混合", FTYPE: "混合型-灵活", RATE: "0.15%", MINSG: "10", RISKLEVEL: "3", SGZT: "开放申购", SHZT: "开放赎回" } }],
      ["FundMNDetailInformation", { Datas: { FCODE: "000001", JJJL: "张三" } }],
      // 重仓股与指数 kline：空数据不落缓存（写了读的时候也是白读），所以给真数据
      ["FundMNInverstPosition", { Datas: { fundStocks: [{ GPDM: "600519", GPJC: "贵州茅台", JZBL: "9.50" }] } }],
      ["FundMNSectorAllocation", { Datas: [] }],
      ["push2his.eastmoney.com", { data: { klines: ["2026-09-22,3900.00,3910.50"] } }],
      // 以下四个「无数据也落哨兵」，正是它们让无数据基金不必每次访问都打东财
      ["FundMNAssetAllocationNew", { Datas: null }],
      ["FundMNBonusDetail", { Datas: null }],
      ["FundMNMangerList", { Datas: null }],
      ["FundMNTagList", { Datas: null }],
    ]);
    const env = fakeEnv(kv);
    // 与 funds.$code loader 同序：ensureFund 先落档案（fetchFundBasic），再并发拉各卡。
    // ⚠️ 别改成一把并发——fetchFundDetail 内部也会调 fetchFundBasic，并发冷启动会把
    // 同一个 basic key 写两遍（顺序是写次数的一部分）
    await fetchFundBasic(env, "000001");
    await Promise.all([
      fetchFundDetail(env, "000001"),
      fetchFundPosition(env, "000001"),
      fetchAssetAllocation(env, "000001"),
      fetchBonusHistory(env, "000001"),
      fetchManagerInfo(env, "000001"),
      fetchInvestStyle(env, "000001"),
      fetchIndexNav(env, "1.000300", 400),
    ]);
    return kv._puts;
  }

  it("单只基金冷启动一次：7 个 key 各写一遍，均摊到每天 ≤ 2 次", async () => {
    const puts = await coldStartPuts();
    // 指数是全局 key（所有基金共用一份序列），不按基金计
    const perFund = puts.filter(p => !p.key.startsWith("fund:index:"));
    expect(perFund.map(p => p.key).sort()).toEqual([
      "fund:alloc:000001",
      "fund:basic:000001",
      "fund:bonus:000001",
      "fund:detail:000001",
      "fund:manager:000001",
      "fund:position:v2:000001",
      "fund:style:000001",
    ]);

    // 每写一次 key，均摊成本 = 1 / TTL 天数。无 TTL（永久 key）会算出 Infinity 让
    // 断言直接红——永久缓存是个设计决定，得先来改这条守卫、再改代码（指数那两个
    // key 已在上面按前缀排除，正常路径走不到无 TTL 分支）
    const perDay = perFund.reduce(
      (sum, p) => sum + 1 / ((p.options?.expirationTtl ?? 0) / 86400),
      0,
    );
    // 严格小于 2：当前 ≈ 1.19（basic 3 天 + 6 个 7 天档），留了余量。阈值只是粗线，
    // 精确的锁是上面的 key 集合断言与源码守卫——新增一个 1 天档 key 会直接冲过 2
    expect(perDay).toBeLessThan(2);
  });

  /**
   * 夹具是「手抄的 loader」：与真实页面是两份实现，页面上新增取数调用时夹具不会自动
   * 跟上（2026-09-23 对抗式 review 指出的空头承诺）。所以这里直接读源码对账：基金页
   * 里出现的取数函数必须与注册表一致，多一个少一个都红——逼一次显式登记，顺带想清楚
   * 它带来的写量。
   */
  it("基金页 loader 的取数函数清单与注册表一致（新增一个就红）", () => {
    const pageSrc = readFileSync(
      path.resolve(import.meta.dirname, "../../app/routes/funds.$code.tsx"),
      "utf8",
    );
    const called = pageSrc
      .split("\n")
      // 跳过注释行：只是「提到」某个函数名不该让守卫红
      .filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
      // 用后行断言只要函数名本身（m[0]），不用捕获组取
      .flatMap(line => [...line.matchAll(/\b(?:fetch[A-Z]\w+|ensureFund)(?=\s*\()/g)].map(m => m[0]));
    expect([...new Set(called)].sort()).toEqual([...FUND_PAGE_FETCHERS].sort());
  });
});

/**
 * `ensureFund` 的档案新鲜度窗口必须与 `CACHE_TTL.basic` **同节奏**。
 *
 * DB 侧比 KV 侧短 → 「每天刷一次、每次都拿到同一份缓存」，白写一次 D1；比 KV 长 →
 * 档案永远不刷新。这就把窗口钉成 3 天：2 天前的不许刷（窗口 > 2 天），3 天前零 1 分钟
 * 的必须刷（窗口 ≤ 3 天）。改 `CACHE_TTL.basic` 的人会被这里拦住，逼一次同步。
 */
describe("ensureFund 档案新鲜度窗口（3 天，与 KV 缓存同节奏）", () => {
  const DAY = 86_400_000;

  /** 最小 D1 桩：只实现 ensureFund 用到的方法（findFirst / insert().values().onConflictDoUpdate） */
  function fakeDbWithProfile(updatedAt: number) {
    const row = {
      code: "000001",
      name: "华夏成长混合",
      type: "混合型-灵活",
      purchaseRate: 15,
      redeemTiers: [],
      minPurchase: 1000,
      riskLevel: 3,
      status: "开放申购",
      updatedAt,
    };
    const upserts: unknown[] = [];
    const db = {
      query: { fund: { findFirst: async () => row } },
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoUpdate: async () => {
            upserts.push(v);
          },
        }),
      }),
      _upserts: upserts,
    };
    return db as unknown as Db & { _upserts: unknown[] };
  }

  it("窗口内的档案不刷新：不打东财也不 upsert", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const db = fakeDbWithProfile(Date.now() - 2 * DAY);

    await ensureFund(db, fakeEnv(), "000001");

    expect(spy).not.toHaveBeenCalled();
    expect(db._upserts).toHaveLength(0);
  });

  it("超过窗口（3 天零 1 分钟）就拉一次东财并 upsert 落库", async () => {
    const spy = stubRoutedFetch([
      ["FundMNNBasicInformation", { Datas: { FCODE: "000001", SHORTNAME: "华夏成长混合", FTYPE: "混合型-灵活", RATE: "0.15%", MINSG: "10", RISKLEVEL: "3", SGZT: "开放申购", SHZT: "开放赎回" } }],
    ]);
    const db = fakeDbWithProfile(Date.now() - 3 * DAY - 60_000);

    await ensureFund(db, fakeEnv(), "000001");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(db._upserts).toHaveLength(1);
  });
});

/**
 * 写失败不能丢数据（额度打满的现场）。
 *
 * 免费版额度用尽后 KV 的 put 会 429 抛错。原先 put 与「抓东财」共用同一个 try/catch，
 * 写缓存失败被当成抓取失败：详情页 7 张卡集体变空、库里没有的基金直接 404——
 * 明明数据已经到手了。缓存是旁路，写不进去最多下次再回源。
 */
describe("KV 写入失败（额度打满 429）不影响返回的数据", () => {
  const basicResp = { Datas: { FCODE: "000001", SHORTNAME: "华夏成长混合", FTYPE: "混合型-灵活", RATE: "0.15%", MINSG: "10", RISKLEVEL: "3", SGZT: "开放申购", SHZT: "开放赎回" } };

  it("fetchFundBasic 仍返回档案（否则新基金页会 404）", async () => {
    stubRoutedFetch([["FundMNNBasicInformation", basicResp]]);
    const basic = await fetchFundBasic(fakeEnv(fakeKV({ putFails: true })), "000001");
    expect(basic?.name).toBe("华夏成长混合");
    expect(basic?.purchaseRate).toBe(15);
  });

  it("fetchFundDetail 仍返回详情（否则概况卡整张空）", async () => {
    stubRoutedFetch([
      ["FundMNNBasicInformation", basicResp],
      ["FundMNDetailInformation", { Datas: { FCODE: "000001", JJJL: "张三", JJGS: "华夏基金" } }],
    ]);
    const detail = await fetchFundDetail(fakeEnv(fakeKV({ putFails: true })), "000001");
    expect(detail?.manager).toBe("张三");
    expect(detail?.company).toBe("华夏基金");
  });

  it("写失败留一条日志（线上能一眼看出是额度问题、不是东财挂了）", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubRoutedFetch([["FundMNNBasicInformation", basicResp]]);
    await fetchFundBasic(fakeEnv(fakeKV({ putFails: true })), "000001");
    const logged = errSpy.mock.calls.map(c => String(c[0])).join("\n");
    errSpy.mockRestore();
    expect(logged).toContain("KV 写入");
  });

  it("fetchIndexNav 仍返回新抓到的序列（旧行为会退回兜底缓存或空）", async () => {
    stubRoutedFetch([
      ["push2his.eastmoney.com", { data: { klines: ["2026-09-22,3900.00,3910.50"] } }],
    ]);
    const rows = await fetchIndexNav(fakeEnv(fakeKV({ putFails: true })), "1.000300", 400);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.close).toBe(3910.5);
  });

  it("searchFunds 仍返回新搜到的结果（旧行为会退回旧缓存或空）", async () => {
    stubRoutedFetch([
      ["fundsuggest.eastmoney.com", { Datas: [{ CODE: "000001", NAME: "华夏成长混合", FundBaseInfo: { FTYPE: "混合型-灵活" } }] }],
    ]);
    const items = await searchFunds(fakeEnv(fakeKV({ putFails: true })), "华夏");
    expect(items).toHaveLength(1);
    expect(items[0]?.code).toBe("000001");
  });
});
