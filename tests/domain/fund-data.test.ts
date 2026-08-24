import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchFundBasic,
  fetchNavHistory,
  parseFundListJs,
  percentToRate,
  searchFunds,
} from '~/services/fund-data';

/**
 * 数据接入层测试。全部 stub fetch，不打真网——
 * 真接口会变、会限流、会超时，测试必须稳定可复现。
 *
 * 这里的固定响应取自 2026-08-25 对东财接口的真实抓取，
 * 字段名与结构与线上一致。
 */

/** 造一个假的 KV，行为足够真：存得进、取得出、能过期 */
function fakeKV() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function fakeEnv(kv = fakeKV()) {
  return { KV: kv } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('percentToRate 费率解析', () => {
  it('带百分号的字符串转万分之整数', () => {
    expect(percentToRate('1.50%')).toBe(150);
    expect(percentToRate('0.15%')).toBe(15);
    expect(percentToRate('0%')).toBe(0);
  });

  it('不带百分号也按百分比理解', () => {
    expect(percentToRate('1.5')).toBe(150);
    expect(percentToRate('0.15')).toBe(15);
  });

  it('异常输入回退为 0', () => {
    expect(percentToRate('--')).toBe(0);
    expect(percentToRate('')).toBe(0);
    expect(percentToRate('暂无')).toBe(0);
  });

  it('四位以上小数四舍五入到万分之整数', () => {
    expect(percentToRate('0.123%')).toBe(12); // 0.00123 → 12.3 → 12
  });
});

describe('searchFunds 基金搜索', () => {
  const searchResponse = {
    ErrCode: 0,
    Datas: [
      {
        CODE: '000001',
        NAME: '华夏成长混合',
        FundBaseInfo: { FTYPE: '混合型-灵活' },
      },
      {
        CODE: '110022',
        NAME: '易方达消费行业股票',
        FundBaseInfo: { FTYPE: '股票型' },
      },
    ],
  };

  it('解析出 code / name / type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(searchResponse))),
    );
    const r = await searchFunds(fakeEnv(), '000001');
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      code: '000001',
      name: '华夏成长混合',
      type: '混合型-灵活',
    });
  });

  it('结果写入 KV 缓存，第二次不再打网络', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(searchResponse)));
    vi.stubGlobal('fetch', spy);
    const env = fakeEnv();

    await searchFunds(env, '华夏');
    await searchFunds(env, '华夏');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('网络异常时回退缓存而不是崩溃', async () => {
    const kv = fakeKV();
    const env = fakeEnv(kv);

    // 先成功一次把缓存喂进去
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(searchResponse))),
    );
    await searchFunds(env, '华夏');

    // 再让网络挂掉，应当仍能从缓存拿到结果
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const r = await searchFunds(env, '华夏');
    expect(r).toHaveLength(2);
  });

  it('网络异常且无缓存时返回空数组（不抛错，保证页面可用）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const r = await searchFunds(fakeEnv(), '不存在');
    expect(r).toEqual([]);
  });

  it('空关键词直接返回空数组，不打网络', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await searchFunds(fakeEnv(), '   ')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fetchFundBasic 基金档案', () => {
  const basicResponse = {
    Datas: {
      FCODE: '000001',
      SHORTNAME: '华夏成长混合',
      FTYPE: '混合型-灵活',
      SOURCERATE: '1.50%',
      RATE: '0.15%',
      MINSG: '10',
      RISKLEVEL: '4',
      SGZT: '开放申购',
      SHZT: '开放赎回',
      DWJZ: '1.2970',
    },
  };

  it('解析费率取优惠后的 RATE，起购金额转成分', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(basicResponse))),
    );
    const r = await fetchFundBasic(fakeEnv(), '000001');
    expect(r).not.toBeNull();
    expect(r!.code).toBe('000001');
    expect(r!.name).toBe('华夏成长混合');
    expect(r!.type).toBe('混合型-灵活');
    expect(r!.purchaseRate).toBe(15); // 0.15% → 万分之 15
    expect(r!.minPurchaseCents).toBe(1000); // 10 元 → 1000 分
    expect(r!.riskLevel).toBe(4);
    expect(r!.status).toBe('开放申购');
  });

  it('RATE 缺失时回退用 SOURCERATE', async () => {
    const noRate = {
      Datas: { ...basicResponse.Datas, RATE: '--' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(noRate))),
    );
    const r = await fetchFundBasic(fakeEnv(), '000001');
    expect(r!.purchaseRate).toBe(150); // 回退 1.50%
  });

  it('接口返回空数据时返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ Datas: null }))),
    );
    expect(await fetchFundBasic(fakeEnv(), '999999')).toBeNull();
  });

  it('网络异常时返回 null 而不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    expect(await fetchFundBasic(fakeEnv(), '000001')).toBeNull();
  });
});

describe('fetchNavHistory 历史净值', () => {
  const navResponse = {
    Data: {
      LSJZList: [
        {
          FSRQ: '2026-08-24',
          DWJZ: '1.2970',
          LJJZ: '3.8700',
          JZZZL: '-2.41',
        },
        {
          FSRQ: '2026-08-21',
          DWJZ: '1.3290',
          LJJZ: '3.9020',
          JZZZL: '0.45',
        },
      ],
    },
  };

  it('净值字符串精确转成 ×10000 整数', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(navResponse))),
    );
    const rows = await fetchNavHistory(fakeEnv(), '000001');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      navDate: '2026-08-24',
      unitNav: 12970,
      accNav: 38700,
      growthRate: -241, // -2.41% → 万分之 -241
    });
  });

  it('涨跌率为空时按 0 处理', async () => {
    const blank = {
      Data: {
        LSJZList: [
          { FSRQ: '2026-08-24', DWJZ: '1.0000', LJJZ: '1.0000', JZZZL: '' },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(blank))),
    );
    const rows = await fetchNavHistory(fakeEnv(), '000001');
    expect(rows[0].growthRate).toBe(0);
  });

  it('请求带 Referer 头（东财防盗链要求）', async () => {
    const spy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(navResponse)),
    );
    vi.stubGlobal('fetch', spy);
    await fetchNavHistory(fakeEnv(), '000001');

    const init = spy.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get('Referer')).toContain('eastmoney.com');
  });

  it('网络异常时返回空数组（撮合会因此让订单顺延，不误判失败）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('timeout');
      }),
    );
    expect(await fetchNavHistory(fakeEnv(), '000001')).toEqual([]);
  });

  it('净值缺失或非法的行被跳过', async () => {
    const dirty = {
      Data: {
        LSJZList: [
          { FSRQ: '2026-08-24', DWJZ: '', LJJZ: '1.0', JZZZL: '0' },
          { FSRQ: '2026-08-21', DWJZ: '1.5000', LJJZ: '1.5', JZZZL: '0' },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(dirty))),
    );
    const rows = await fetchNavHistory(fakeEnv(), '000001');
    expect(rows).toHaveLength(1);
    expect(rows[0].navDate).toBe('2026-08-21');
  });
});

describe('parseFundListJs 全量列表兜底解析', () => {
  it('从 JS 变量声明里抠出基金数组', () => {
    const js = `var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","HUAXIA"],["110022","YFDXFHYGP","易方达消费行业股票","股票型","YIFANGDA"]];`;
    const list = parseFundListJs(js);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      code: '000001',
      name: '华夏成长混合',
      type: '混合型-灵活',
    });
  });

  it('内容异常时返回空数组而不抛错', () => {
    expect(parseFundListJs('这不是合法的 JS')).toEqual([]);
    expect(parseFundListJs('')).toEqual([]);
  });
});
