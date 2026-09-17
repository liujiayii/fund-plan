# 搜索引擎收录与曝光（SEO）

> 本站 SEO 的**唯一出处**：域名纪律、已就位的爬虫基建、站长平台提交、
> 收录排查清单、关键词落地页与口径。
>
> 2026-09-17 从 `docs/deployment.md` 拆出来单独维护（那篇只讲部署）。
> 部署步骤见 [deployment.md](deployment.md)，国内访问速度见
> [china-access.md](china-access.md)。

## 1. 域名纪律：全站只服务一个可索引域名

主站钉死 `https://liujiayii.dpdns.org`，canonical / sitemap / robots 只出这一个 host。

2026-09-17 撤掉了试签用的 `liujiayi.dpdns.org`（本站从不使用它，而内容逐字节相同的
第二 host 会被搜索引擎当「另一个站」——百度对跨域 canonical 的支持远不如 Google），
来龙去脉见 [china-access.md](china-access.md) 第三轮。

往后若要再挂 host、或要给某个 URL 加 noindex，**先查 `site:` 三引擎**：
被收录的若是那个 host，先把主站推上去再撤，否则等于把仅有的入口也丢掉。

## 2. 爬虫基建（代码里已就位）

部署后自检：

```bash
curl -sI https://liujiayii.dpdns.org/robots.txt    # 200，text/plain
curl -s  https://liujiayii.dpdns.org/robots.txt    # 含 Sitemap: …/sitemap.xml
curl -sI https://liujiayii.dpdns.org/sitemap.xml   # 200，application/xml
curl -s  https://liujiayii.dpdns.org/sitemap.xml | grep -c '<lastmod>'            # = 有净值日期的基金数（没净值行的只出 loc）
curl -s  https://liujiayii.dpdns.org/tools/fee-calculator | grep -o '净申购金额'   # 正文 SSR
curl -s  https://liujiayii.dpdns.org/funds/000001 | grep -o '"@type":"BreadcrumbList"'
```

| 机制 | 在哪 | 要点 |
| ---- | ---- | ---- |
| `robots.txt` / `sitemap.xml` | `app/routes/robots[.]txt.ts` / `sitemap[.]xml.ts` | 资源路由（不走 Layout），内容由 `app/domain/seo.ts` 纯函数生成；sitemap 只收录**库里已落档**的基金——空 404 进索引比漏收更糟 |
| canonical / OG / noindex | `pageMeta`、`buildFundMeta`（`app/domain/seo.ts`） | 公开页出 canonical + `og:*`；`/me*` `/admin*` 一律 `noindex, nofollow` |
| `<lastmod>` | `buildSitemapXml` | 基金页取各自的 `max(nav_date)`——内容真变了才变；静态页**刻意不给**，Google 明确说 lastmod 不准确会被忽略，宁缺勿假 |
| 面包屑结构化数据 | `buildFundBreadcrumbJsonLd` | 走 RR8 `meta` 的 `script:ld+json`。层级必须用真实存在的页（`/` → `/funds` → `/funds/:code`），别造中间层 |
| H1 | `app/routes/_index.tsx` | 首页 hero 是真 `<h1>`；其余公开页仍是 antd `Title level={3}`（渲染成 h3）——`level` 同时决定标签与字号、`component` 被内部覆盖（antd v6 `Title.js` 里 `component` 排在 `...restProps` 之后），改成 h1 会连带字号漂移，属**已知技术债** |
| 页面响应头 | `app/domain/page-cache-header.ts` | 匿名请求（含爬虫）`private, no-cache`、登录态 `private, no-store`。旧版对爬虫也发 `no-store`（「任何缓存都不许留」），是喂给抓取工具的负信号 |

缓存头口径：sitemap 1 小时、robots 1 天——改了公开页文案不用重新提交 sitemap，爬虫会自己再来。

## 3. 站长平台提交（人工，一次性）

仓库里的爬虫基建只是"准备好了"，**没有人工提交，光有 `robots.txt` / `sitemap.xml`
也可能几个月没人来**。

### Google Search Console

1. 打开 [Google Search Console](https://search.google.com/search-console)
2. 添加资源 → **网址前缀** → `https://liujiayii.dpdns.org`
3. 验证：用 **DNS TXT**（Cloudflare Dashboard → 该 zone → DNS → 加一条 TXT）。
   本站没有 Google Analytics 跟踪代码（只有 CF Web Analytics 自动注入），
   别选 GA 验证；「已登录的 Google 账号」也不能单独过 URL-prefix 验证
4. 验证通过后：左侧 **站点地图** → 提交 `https://liujiayii.dpdns.org/sitemap.xml`
5. **网址检查** 里抽查首页，点「请求编入索引」。Google 通常几天到几周收录

### Bing Webmaster Tools

1. 打开 [Bing Webmaster](https://www.bing.com/webmasters)
2. 添加站点 `https://liujiayii.dpdns.org`
3. 验证：同样用 DNS TXT，或直接 **导入 Google Search Console**（GSC 先过就能一键同步）
4. **站点地图** → 提交同一条 `sitemap.xml`
5. Bing 收录通常比 Google 快，常在几天内

### 百度搜索资源平台

1. 打开 [百度搜索资源平台](https://ziyuan.baidu.com/)
2. 用户中心 → 添加网站 → `https://liujiayii.dpdns.org`
3. 验证：文件验证（把验证文件内容做成 Worker 路由）或 HTML 标签都行；
   DNS TXT 百度也支持
4. 数据引入 → **链接提交** → 填写 sitemap 地址
5. **预期要降**：`*.dpdns.org` 是免费二级域，百度对这类域名很苛刻，
   可能长期不收或收了也不给展现。真想在百度搜到，长期还是得有自己的域名

### 心里有数

- 提交 ≠ 立刻排到第一。索引只是入场券，排名靠外链、查询量和内容
- `/me` `/admin` 被 `robots.txt` Disallow 且页面 `noindex`，登录盘不会进索引
- `site:` 查询是唯一能自己确认收录的口径（`cn.bing` 在无结果时会兜底显示无关结果，
  那**就是**零收录）

## 4. 收录掉了怎么查（2026-09-17 实战）

「提交收录之后反而搜不到」不是提交这个动作造成的——提交只触发**重新抓取与重新评估**。
按顺序定位，别凭猜：

1. GSC →「效果」拉 3 个月曲线，找到展示量归零的**日期**，再对齐 `git log` 的部署日期
2. GSC →「页面」报告：首页 URL 的具体状态（已编入 / 已抓取尚未编入 / 重复网页 / 已排除）
3. 百度搜索资源平台 →「索引量」+「抓取异常」+「抓取诊断」
4. 三个引擎各查一次 `site:liujiayii.dpdns.org`
5. **别反复点「请求编入索引」**——有配额，反复请求没用

代码侧已排查过的事实（**都不构成封锁，别再往这里找原因**）：

- 爬虫视角一切正常：公开页 200、正文 SSR 渲染、canonical / robots.txt / sitemap 就位
- 域名只有一个（见 §1），第二 host 的重复内容问题已消除
- 三个引擎里 Bing 当时对本站是**零收录**（`site:` 无结果）——那属于"还没建立索引"，
  不是被技术手段挡住

## 5. 内容策略：让爬虫有值得收录的东西

排名的真瓶颈不是技术，是**「没有值得收录的独有内容」**：基金页原先整页都是东财字段，
一页页长得一样，爬虫眼里是采集站。判据：**页面数 × 每页独特性 = 收录规模**。

### 5.1 基金页的定投回测（独家内容）

每页一张**定投回测**卡（`app/domain/dca-backtest.ts`）：每月首个交易日买 1000 元、
最近 12 期，算出累计投入 / 期末市值 / 收益率 / 最大回撤，并把真数字写进 `title` 与
`description`（`buildFundMeta`），吃「<基金名> 定投回测」「<代码> 定投收益」这类长尾词。

- 口径（改实现必须同步文案与单测）：每月首个**有净值的交易日**买入——1 号逢休市
  自然顺延，不查节假日表；申购费走**内扣法**且复用撮合的 `calcPurchase`（净额 =
  金额 ÷ (1+费率)，**不是** × (1−费率)，后者是外扣法会多算）；净值取**累计净值**
  （等价分红再投）；最大回撤取「已投份额市值」的峰谷，未投出的现金不算
- 期数不足 3 期（新基金、净值历史太薄）时**整卡不渲染**、描述回落通用版——
  不给爬虫「有标题没数字」的坏内容
- 数据全来自本地 `fund_nav`，纯内存计算：不新增 D1 查询、不新增外部接口
- 本地验证：`/funds/000001` 应看到「定投回测」卡，页面源码里 `description` 带
  期数/市值/收益率（dev 首次请求该路由可能 500，是懒编译路由模块的产物，再请求一次即正常）

### 5.2 费用计算器与内链

- **`/tools/fee-calculator`**（强意图长尾词落地页）：申购费内扣法 + FIFO 阶梯赎回费试算。
  算法**直接复用** domain 的 `calcPurchase` / `quoteRedeemByHoldDays`，试算数字与站内
  真实账本一致——这是它相对同类工具的唯一优势，别另写一套算法。
  支持 `?rate=150&nav=12345`（万分之 / ×10000，与库里口径一致）预填，基金页的
  「赎回费率阶梯」卡带参链过来。⚠️ 解析 query 参数要先判 `null`：参数缺失时
  `Number(null) === 0`，会把「没带参」误判成「费率 0%」，首屏静默少算申购费
  （本地冒烟实测踩过）。正文（公式、档位表、口径说明）全部 SSR，爬虫不跑 JS 也能读到。
- **内链**：基金页「同类基金」（同 `fund.type`、最多 6 条、一条查询）与首页 / 费率卡
  指向计算器的链接。内链要**相关**才有价值：`type` 为空时整卡不渲染。
- **导航入口**：`app/domain/nav.ts` 的 `NAV_ITEMS` 里有「费用计算器」一项——侧栏在
  **每个页面**都渲染（桌面侧栏与移动抽屉共用 `NavLinks`），等于给这一页全站内链。
  新增"值得被收录"的公开页时，优先考虑挂进导航，而不是只加 sitemap。
  底栏 `MOBILE_TAB_KEYS` 只留四个高频入口，别往那儿塞。

### 5.3 还没做的（按性价比）

1. **让基金页数量涨起来**：现在只有被访问过的代码才落档（`ensureFund` 写的才进 sitemap）
2. **自有域名**：免费二级域 + 无备案的信任度天花板就在那儿，长期绕不开
