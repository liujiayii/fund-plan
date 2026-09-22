import { describe, expect, it } from "vitest";
import { fundShortLabel, fundShortName } from "~/domain/fund-name";

/**
 * 基金全称 → 简称。
 *
 * 用例分三组：
 *   1. **真实名字**（图 1 里那期主理人的品种 + 本地库里已有的几只），缩出来该是什么样
 *   2. **剥不动的情形**：没登记的公司、剥到只剩残片——都必须退回一个看得懂的东西
 *   3. **顺序陷阱**：长公司名优先命中、载体词先于份额类别（写错顺序会剥出残片）
 */

describe("fundShortName：真实名字", () => {
  it("剥掉公司名与载体后缀，留下指数名（主人举的例子）", () => {
    expect(fundShortName("博时标普500ETF联接A")).toBe("标普500");
  });

  it("图 1 那期的九个品种", () => {
    expect(fundShortName("景顺长城中证港股通科技ETF发起联接A")).toBe("中证港股通科技");
    expect(fundShortName("天弘恒生科技ETF联接A")).toBe("恒生科技");
    expect(fundShortName("华宝中证消费龙头ETF联接A")).toBe("中证消费龙头");
    expect(fundShortName("招商中证白酒指数")).toBe("中证白酒");
    expect(fundShortName("汇添富中证生物科技指数A")).toBe("中证生物科技");
    expect(fundShortName("华宝医疗ETF联接A")).toBe("医疗");
    expect(fundShortName("大成中证全指自由现金流ETF发起式联接A")).toBe("中证全指自由现金流");
    expect(fundShortName("中金中证优选300指数(LOF)B")).toBe("中证优选300");
    expect(fundShortName("景顺长城沪港深红利成长低波动指数A")).toBe("沪港深红利成长低波动");
  });

  it("本地库里那几只混合型/发起式也缩得干净", () => {
    expect(fundShortName("银华同力精选混合")).toBe("同力精选");
    expect(fundShortName("新华优选分红混合C")).toBe("优选分红");
    expect(fundShortName("新华趋势领航混合")).toBe("趋势领航");
    expect(fundShortName("山证资管精选行业混合发起式C")).toBe("精选行业");
    expect(fundShortName("华富永鑫灵活配置混合A")).toBe("永鑫");
  });

  it("QDII / 人民币份额 / 长载体名一路剥到底", () => {
    expect(fundShortName("工银瑞信印度市场(QDII)人民币")).toBe("印度市场");
    expect(fundShortName("广发纳斯达克100ETF(QDII)")).toBe("纳斯达克100");
    expect(fundShortName("易方达中债7-10年国开行债券指数A")).toBe("中债7-10年国开行");
    expect(fundShortName("华夏中证5G通信主题ETF联接A")).toBe("中证5G通信主题");
  });

  it("没登记的公司不剥头，其余照剥（简称依旧成立）", () => {
    expect(fundShortName("某某小基金公司中证红利指数A")).toBe("某某小基金公司中证红利");
  });

  it("本来就没有公司前缀的名字也不动头", () => {
    expect(fundShortName("上证50ETF联接A")).toBe("上证50");
  });
});

describe("fundShortName：剥不动就退回全称（宁长勿空）", () => {
  it("剥到只剩一两个字时整条退回全称，绝不显示残片", () => {
    // 「华夏基金」：剥掉公司名只剩「基金」，再剥就是空——退回全称
    expect(fundShortName("华夏基金")).toBe("华夏基金");
    expect(fundShortName("博时ETF")).toBe("博时ETF");
  });

  it("空串与纯空白给空串（调用方据此回落成代码）", () => {
    expect(fundShortName("")).toBe("");
    expect(fundShortName("   ")).toBe("");
  });

  it("首尾空白会被清掉", () => {
    expect(fundShortName("  博时标普500ETF联接A  ")).toBe("标普500");
  });
});

describe("fundShortName：顺序陷阱", () => {
  it("长公司名优先命中，不剥出残缺前缀", () => {
    // 「景顺长城」必须先于「景顺」、「摩根士丹利」必须先于「摩根」
    expect(fundShortName("景顺长城沪深300指数")).toBe("沪深300");
    expect(fundShortName("摩根士丹利双利增强债券A")).toBe("双利增强");
    // 「东方红」先于「东方」；「国投瑞银」先于「瑞银」
    expect(fundShortName("东方红中证竞争力指数A")).toBe("中证竞争力");
    expect(fundShortName("国投瑞银中证500指数")).toBe("中证500");
  });

  it("载体词先于单个字母剥：纳斯达克100ETF 不能被拆成 纳斯达克100ET", () => {
    expect(fundShortName("广发纳斯达克100ETF")).toBe("纳斯达克100");
  });

  it("括号载体先于份额类别剥：(LOF)B 要先掉 B 再掉括号", () => {
    expect(fundShortName("中金中证优选300指数(LOF)B")).toBe("中证优选300");
  });
});

describe("fundShortLabel：覆盖表优先", () => {
  it("没有登记时就是自动缩的结果", () => {
    expect(fundShortLabel("000001", "博时标普500ETF联接A")).toBe("标普500");
  });
});
