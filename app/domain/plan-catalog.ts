/**
 * 螺丝钉估值表里的品种池（2026-10 截图）。
 *
 * 这张表是**唯一权威**：主理人的定投只从这 52 个品种里出（估值表 50 条 +
 * 口述补充 2 条），每个品种对应一只场外基金。所以「公众号原文的简称 → 基金代码」
 * 不该用模糊匹配去猜——实测东财搜索「自由现金流」前六条全是场内 ETF、
 * 「消费龙头」前四条是主动混合型，猜一次就是买错一次，而错的是真金白银。
 *
 * ## 改这张表时怎么核对
 *
 * 用东财全量基金列表反查代码：
 *   https://fund.eastmoney.com/js/fundcode_search.js
 * 名称与简称对不上就是抄错了。本次逐条核对已做过，抓出三处典型错误：
 *
 *   - `021822` = 景顺长城国证石油天然气ETF联接（不是沪深300）
 *   - `012412` = 汇泉策略优选混合A（不是中证医疗）
 *   - `001333` = 不存在（那是个股票代码）
 *
 * 两条「场内 → 场外」是用场内 ETF 反推的（截图里那几行数字串了行）：
 *   - `563020` 易方达红利低波ETF → `020602` 易方达中证红利低波动ETF联接A
 *   - `510310` 易方达沪深300ETF   → `110020` 易方达沪深300ETF联接A
 *
 * ## 为什么用常量而不是数据库表
 *
 * 这份名单是**外部世界的固定事实**（螺丝钉的品种池），不是用户数据。
 * 存库要多一条迁移、多一处「表和代码不一致」的可能，换不来任何东西。
 * 改品种就改这里，跟着代码一起 review。
 */

/** 估值表里的一个品种 */
export interface PlanCatalogItem {
  /** 估值表上的简称（公众号原文用的就是它） */
  alias: string;
  /** 场外基金代码：定投只买这一只 */
  otcCode: string;
  /**
   * 原文里可能出现的书写变体。
   * 例如原文写「沪港深红利低波动」，表上是「沪港深红利低波」。
   */
  variants?: string[];
}

/** 与截图同序（上段低估 → 中段适中 → 下段），便于逐行核对 */
export const PLAN_FUND_CATALOG: readonly PlanCatalogItem[] = [
  { alias: "中证红利低波动", otcCode: "020602", variants: ["红利低波动", "红利低波"] },
  { alias: "沪港深红利低波", otcCode: "007751", variants: ["沪港深红利低波动"] },
  { alias: "中证红利", otcCode: "021399" },
  { alias: "优选300", otcCode: "023711", variants: ["中证优选300"] },
  { alias: "自由现金流", otcCode: "024616" },
  { alias: "沪深300", otcCode: "110020" },
  { alias: "中证800", otcCode: "024870" },
  { alias: "中证全指", otcCode: "025430" },
  { alias: "中证A50", otcCode: "021212" },
  { alias: "中证A500", otcCode: "023965" },
  { alias: "消费50", otcCode: "008975", variants: ["中证消费50"] },
  { alias: "消费龙头", otcCode: "501090" },
  { alias: "医药100", otcCode: "001550", variants: ["中证医药100"] },
  { alias: "中证消费", otcCode: "009179", variants: ["主要消费", "中证主要消费"] },
  { alias: "中证白酒", otcCode: "161725" },
  { alias: "中证医疗", otcCode: "162412", variants: ["医疗"] },
  { alias: "港股科技", otcCode: "016495", variants: ["港股通科技", "中证港股通科技"] },
  { alias: "证券行业", otcCode: "007992", variants: ["证券公司", "券商"] },
  { alias: "中证银行", otcCode: "001594", variants: ["银行"] },
  { alias: "300价值", otcCode: "519671", variants: ["沪深300价值"] },
  { alias: "上证红利", otcCode: "012761" },
  { alias: "中证价值", otcCode: "006748" },
  { alias: "港股红利", otcCode: "004532", variants: ["港股高股息", "港股通高股息"] },
  { alias: "龙头红利", otcCode: "020120", variants: ["龙头红利50"] },
  { alias: "50AH优选", otcCode: "501050", variants: ["50AH"] },
  { alias: "恒生指数", otcCode: "000071", variants: ["恒生"] },
  { alias: "H股指数", otcCode: "110031", variants: ["国企指数", "恒生国企", "H股"] },
  { alias: "基本面50", otcCode: "160716" },
  { alias: "上证50", otcCode: "110003" },
  { alias: "央视50", otcCode: "217027", variants: ["央视财经50"] },
  { alias: "上证180", otcCode: "040180" },
  { alias: "MSCI A50", otcCode: "015037", variants: ["MSCI中国A50", "MSCI中国A50互联互通"] },
  { alias: "上证指数", otcCode: "100053" },
  { alias: "中证A100", otcCode: "213010" },
  { alias: "中证养老", otcCode: "000968", variants: ["养老"] },
  { alias: "香港中小", otcCode: "501021", variants: ["香港中小盘"] },
  { alias: "红利机会", otcCode: "501029", variants: ["标普红利机会"] },
  { alias: "基本面60", otcCode: "159916" },
  { alias: "基本面120", otcCode: "070023" },
  { alias: "可选消费", otcCode: "001133", variants: ["全指可选消费", "中证全指可选消费"] },
  { alias: "500低波动", otcCode: "003318", variants: ["中证500低波动", "500低波"] },
  { alias: "深证100", otcCode: "161227" },
  { alias: "深证成指", otcCode: "163109" },
  { alias: "中证500", otcCode: "025111" },
  { alias: "创业板", otcCode: "161022" },
  { alias: "北证50", otcCode: "024161" },
  { alias: "中证1000", otcCode: "024091" },
  { alias: "标普500", otcCode: "050025", variants: ["标普"] },
  { alias: "纳斯达克100", otcCode: "040046", variants: ["纳指100"] },
  { alias: "科创50", otcCode: "021484", variants: ["科创板"] },

  // —— 截图之外、主人补充的两条（口述提供，已按东财全量列表核对名称）——
  // 2026-10-20 的原文里出现过这两个简称，但估值表上只有「港股科技」「医药100」
  { alias: "恒生科技", otcCode: "012348" }, // 天弘恒生科技ETF联接A
  { alias: "生物科技", otcCode: "501009" }, // 汇添富中证生物科技指数(LOF)A
];

/**
 * 归一化：去掉空白与标点，统一小写。
 *
 * **不去「中证」这类前缀**——表上的简称本身带前缀，原文也带，去掉反而制造
 * 「中证500」与「中证500低波动」这类新的混淆。
 */
export function normalizePlanAlias(text: string): string {
  return text.replace(/[\s（）()【】·、,，。.]/g, "").toLowerCase();
}

/** 一个条目认得的全部写法（简称 + 变体） */
function itemNames(item: PlanCatalogItem): string[] {
  return [item.alias, ...(item.variants ?? [])];
}

/**
 * 查表：简称 → 场外基金。
 *
 * 三级，越往后越松，但**任何一级都要求唯一命中**：
 *   1. 归一化后全等（原文写的就是表上的简称）
 *   2. 命中某个变体（「沪港深红利低波动」vs 表上的「沪港深红利低波」）
 *   3. 双向包含，且只有唯一一条命中
 *
 * 命中不了就返回 null，由页面标红让人选——**绝不返回「最像的那条」**。
 * 猜错一只的代价比多点一次大得多。
 */
export function lookupPlanFund(alias: string): PlanCatalogItem | null {
  const key = normalizePlanAlias(alias);
  if (key === "")
    return null;

  const exact = PLAN_FUND_CATALOG.find(item =>
    itemNames(item).some(n => normalizePlanAlias(n) === key));
  if (exact)
    return exact;

  // 双向包含：太短的 key（「A50」「银行」这种两三个字）容易撞多个条目，
  // 所以要求 3 个字以上，且必须唯一
  if (key.length < 3)
    return null;

  const hits = PLAN_FUND_CATALOG.filter(item =>
    itemNames(item).some((n) => {
      const nn = normalizePlanAlias(n);
      return nn.length >= 3 && (nn.includes(key) || key.includes(nn));
    }));

  return hits.length === 1 ? hits[0] : null;
}

/** 下拉选项：全表 50 条（代码 + 简称），给「手动选」兜底 */
export function planCatalogOptions(): { code: string; alias: string }[] {
  return PLAN_FUND_CATALOG.map(i => ({ code: i.otcCode, alias: i.alias }));
}
