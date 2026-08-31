/**
 * 访问人次统计的判定逻辑（纯函数，不依赖 Fetch API）。
 *
 * 「一次访问」的定义：浏览器发起的**页面导航请求**（HTML 文档）。
 * 本站导航用的是原生 <a> 全页跳转，所以一次导航 = 一次访问，语义即 PV（人次）。
 *
 * 以下请求**不算**访问：
 *  - loader / fetch API 的 XHR（sec-fetch-dest 为 "empty"）
 *  - JS / CSS / 图片等静态资源（"script" / "style" / "image"…）
 *  - POST 等非 GET 请求
 *  - 爬虫与命令行工具（User-Agent 特征过滤，能挡多少挡多少，不求全）
 */
export interface VisitRequestInfo {
  /** HTTP 方法，如 "GET" */
  method: string;
  /** Sec-Fetch-Dest 请求头：浏览器导航为 "document"，XHR 为 "empty"，资源为 "script" 等；非浏览器通常缺失 */
  secFetchDest: string | null;
  /** Accept 请求头（老浏览器没有 Sec-Fetch-Dest 时用来兜底判定） */
  accept: string | null;
  /** User-Agent 请求头 */
  userAgent: string | null;
}

/** 爬虫 / 命令行 / 无头浏览器的 UA 特征。命中即不计入「人次」 */
const BOT_UA_RE = /bot|crawler|spider|curl|wget|headless|python-requests|http-client/i;

/**
 * 判定一次请求是否算一次「访问人次」。
 *
 * 判定链：GET → 是 HTML 文档请求（sec-fetch-dest=document，缺失时退化看 Accept 含 text/html）→ UA 非爬虫。
 * 三个条件全过才计数，宁少勿滥——计数虚高比偏低更没意义。
 */
export function isPageVisit(r: VisitRequestInfo): boolean {
  // 只数读请求；下单、签到这类 action 的 POST 不算「来看了一眼」
  if (r.method !== "GET")
    return false;

  // 新标准头：浏览器导航请求固定为 "document"。
  // XHR/loader 请求是 "empty"，静态资源是 "script"/"style" 等，天然被排除。
  const isDocument = r.secFetchDest === "document"
    // 老浏览器/特殊客户端不发 Sec-Fetch-Dest：退化用 Accept 含 text/html 判定，
    // 但只在头整个缺失时才兜底——发了 "empty" 的就别再捞回来了
    || (r.secFetchDest === null && (r.accept ?? "").includes("text/html"));
  if (!isDocument)
    return false;

  // 爬虫与命令行不计入：搜索引擎的 bot 每天把访问量刷出几十倍没有意义
  if (BOT_UA_RE.test(r.userAgent ?? ""))
    return false;

  return true;
}
