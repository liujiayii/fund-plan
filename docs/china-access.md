# 国内访问优化施工图

Cloudflare 免费版对国内用户慢是**结构性问题**（无大陆节点 + anycast 绕路），
本文记录 2026-08-31 的诊断证据、已落地的仓库内优化、以及「出入境改造」的
完整施工步骤。**两轮 17ce 实测已定案走 B1 优选 IP**（见「实测结论」），
B2 保留作备忘。

## 诊断结论（2026-08-31，联通直连实测）

完整链路：DNS 60ms / TCP 230ms / TLS 0.66~1.66s / **TTFB 4.3~5.4s**。

三层病灶，互相放大：

| 病灶 | 证据 | 后果 |
| ---- | ---- | ---- |
| ① 入境绕路 | 域名解析到 `104.21.73.133 / 172.67.145.12`，联通去这对 IP 绕**阿姆斯特丹（AMS）**，连续 5 次请求全部 `-AMS`；同一时刻 `104.16.132.229` 直进 LAX 只要 165ms | 第一跳 RTT 多付 40%+，TLS/HTTP 的每个往返都被放大 |
| ② Worker 与 D1 分居两大洲 | 响应头 `Cf-Placement: local-AMS`；D1 主库在 `WNAM`（美西）；首页 SSR 约 17 条 D1 查询 × 跨大西洋 100~300ms/条 ≈ 3.4s，与实测 TTFB 几乎完全对账 | 服务端时间占大头，这是 4~5 秒的主要成分 |
| ③ 资源缓存保守 | JS/CSS 边缘已 HIT，但 `Cache-Control: max-age=0, must-revalidate` | 回访用户每个资源都要发条件请求 |

**为什么开了 Smart Placement 还是慢**：它优化的是「Worker → 后端」的路径，
管不了「用户 → CF 入口」的第一跳；而且它不把 D1 绑定的延迟算进后端成本
（东财接口都有 KV 缓存、看起来没有慢后端），于是分析结论是贴着用户入口跑。
API 实查 `placement_status: SUCCESS` + 请求实际 `local-AMS` 印证了这一点。

### 隐藏病灶：免费版 10ms CPU 上限（error 1102）

部署后验证时发现的**存量问题**（旧代码同样存在，缓存层只是轻微加码）：
SSR bundle 上传体积 11.7MB，冷启动 isolate 上「模块初始化 + React 渲染」
贴着免费版 **10ms CPU/请求**的上限，偶发 `error code: 1102`（超 CPU），
实测约 1/10 的冷路径请求会随机白屏报错。17ce 那次「全节点失败」正是它
与并发雪崩的混合现场，读法如下：

- 各节点大量 `HTTP 500`：160 节点同时涌入，D1 突发争用让 loader 抛错、
  走到应用的错误边界——是**应用渲染的 500**，不是 CF 错误页；
- 大量 `0` / 10s 超时：SSR 排队 + 绕路链路叠加；
- `error 1102`：冷 isolate 超出 CPU 上限——单用户日常访问偶发白屏的元凶。

**应对**：匿名页缓存已升级为 stale-while-revalidate，`/` 与 `/master` 的
游客路径不再付 SSR CPU（后台刷新挂掉也只是缓存继续旧，自愈）；但个性化
页面（/me、/funds/…）仍走实时 SSR，冷 isolate 上依旧可能偶发 1102——
根治需 Workers 付费版（$5/月，CPU 上限 30s）或瘦身 SSR bundle。
另注：17ce 的 160 节点并发对 D1 直连 SSR 的站点是自打自压，结果只当
压力测试看，不代表真实用户体验。

### 入境 IP 对照实验（本机联通，2026-08-31 午后）

同一路线、同一时刻，`curl --resolve` 强连不同 CF anycast IP（CF 边缘按 SNI
路由，任意 CF IP 都能伺候本站主机名）：

| IP | 入境机房 | TCP 往返 | 备注 |
| -------------- | -------- | ---------- | ---- |
| 104.21.73.133  | AMS      | ~230ms     | 现在解析到的（zone 抽签抽到的烂签） |
| 172.67.145.12  | AMS      | ~230ms     | 同上，pair 的另一个 |
| 104.16.132.229 | **LAX**  | **185ms**  | cloudflare.com 自己的 pair |
| 103.21.244.1   | **LAX**  | **164ms**  | 同段可用 |
| 104.21.48.1    | AMS      | ~240ms     | 同为 104.21.x 但路由不同，粒度在 /20 级 |
| 172.64.32.1    | **SIN**  | **85ms**   | 新加坡最近，但见下文「优选选 LAX 而不是 SIN」 |
| 108.162.192.1  | **SIN**  | **85ms**   | 同上 |
| 188.114.96.3   | AMS      | ~230ms     | 新 zone 常抽到的段 |
| 162.159.136.1  | FRA      | 3200ms     | 拥堵到不可用 |
| 141.101.64.1   | 超时     | —          | 不可达 |

⚠️ IP 段的路由质量会漂移，上表只是当日快照；做优选前要重测（见「维护」）。

**优选选 LAX 而不是 SIN**：SIN 首跳 85ms 看着最香，但 Worker 是贴着入口
机房跑的（病灶②），SIN 入境 = Worker 在新加坡 + D1 在美西，每条查询
~160ms；LAX 入境 = Worker 在美西 + D1 在身边，查询毫秒级。**综合最优是
LAX/SJC 段**。除非走 B2 把 D1 搬去欧洲，那时优选目标才反转。

## 已完成的仓库内优化（perf/china-access 分支）

以下改动对**任何入境路径**的用户都有效，不依赖外部配置：

1. **D1 查询瘦身并行化**（`perf(ssr)` commit）
   - `latestNavMap`：1+N 次往返 → 一条相关子查询 SQL
   - `getPortfolio` / `getAssetTimeline` / 首页 loader：能并行的全并行
   - AMS 入境用户首页 TTFB 预计 4.5s → ~2.5s
2. **`/assets/*` 上 immutable 长缓存**（`public/_headers`）：回访免条件请求
3. **匿名页边缘缓存（stale-while-revalidate）**（`feat(cache)` / `fix(cache)`
   commit）：`/` 与 `/master` 的游客视角整页缓存在入口机房 Cache API——
   fresh（60s 内）直接命中，TTFB ≈ 单程 RTT；stale（60s~1h）先给旧页、
   后台重渲染覆盖，SSR 永不进用户关键路径（规避上面的 1102）。带
   `session` cookie 一律旁路；排障看 `x-fp-cache` 响应头
   （hit / stale / miss / bypass）。

**部署后验证清单**：

```bash
# 1. 资源长缓存生效（应看到 Cache-Control: ...immutable；第二次 cf-cache-status: HIT）
curl -sSI https://liujiayii.dpdns.org/assets/root-Dm1z4mVn.js | grep -iE 'cache-control|cf-cache-status'

# 2. 匿名页缓存（模拟浏览器导航，两次应 miss → hit）
curl -sS -D - -o /dev/null -H 'sec-fetch-dest: document' -H 'accept: text/html' \
  -A 'Mozilla/5.0' -H 'cookie: fp_vid=11111111-1111-1111-1111-111111111111' \
  https://liujiayii.dpdns.org/ | grep -i x-fp-cache

# 3. 带 session cookie 必须是 bypass
#   （同上加 -H 'cookie: fp_vid=...; session=x'）

# 4. Dashboard → 域名 → Network → 0-RTT Connection Resumption 打开
#    （HTTP/3 看响应头 alt-svc: h3 已默认开启）
```

## 实测结论（两轮 17ce，2026-08-31）：定案 B1

### 第一轮 15:12（修复前）：数据不可用，但立了大功

164 节点几乎全灭（HTTP 500 ×90+、超时 ×63）——两病齐发：免费版 10ms
CPU 的 1102（见「隐藏病灶」）+ 160 节点并发压垮 D1。这轮促成了
stale-while-revalidate 与裸 GET 缓存两个修复。

### 第二轮 15:56（修复后）：94% 成功、缓存命中 77%

| 运营商 | 成功   | TTFB 中位 | 入境机房分布（CF-RAY 实测）         | 入境 RTT 中位 |
| ------ | ------ | --------- | ----------------------------------- | ------------- |
| 电信   | 47/51  | 1680ms    | **AMS×30**、SJC×10、SEA×4、LAX×3    | 400ms         |
| 联通   | 42/44  | 2121ms    | SJC×22、AMS×11、LAX×6、SEA×3        | 394ms         |
| 移动   | 53/56  | 2869ms    | SJC×22、SEA×18、AMS×12              | 447ms         |

读数与定案依据：

1. **服务端已不是瓶颈**。缓存命中节点的 TTFB ≈ 3~4 × 入境 RTT（探测端
   走 HTTP/1.1 完整握手的账），Worker 侧只剩 ~500ms 量级；第二轮期间
   Smart Placement 已把 Worker 挪到 SJC（`Cf-Placement: remote-SJC`）与
   D1 团聚，裸 SSR 服务端时间降到 ~450-650ms。
2. **剩下的延迟 100% 是「国内 → CF 入境」的网络路径**。最惨的是电信：
   64% 的节点绕 AMS（欧洲），入境 RTT 中位 431ms——首页再怎么缓存，
   光握手就要烧掉 1.5s。
3. 优选 IP 实测：**合格 IP 上缓存命中 TTFB 0.42~1.0s**（新加坡段
   `104.18.32.115` 最快，本线 TCP 仅 ~85ms）。⚠️ 实测时务必确认响应
   是本站内容（看 `x-fp-cache` 头）而非错误页——只看 CF-RAY 和耗时，
   会把 403 错误页的响应时间误读成「优选 IP 很快」，踩过这个坑。

→ **走 B1（SaaS 优选 IP）**。B2 救不了入境 RTT 本身，且会把已团聚的
Worker 与 D1 拆散，否决。

### 优选 IP 的资格门槛：error 1034（Edge IP Restricted）

CF 边缘**并非「任意 anycast IP 都伺候任意 zone」**：部分 IP 是专用的
（如 `104.16.132.229` / `104.16.133.229`——cloudflare.com 自用的优质对，
国内路由极佳但只回 403 `error code: 1034`）。所以优选 IP 要过双门槛：
①能伺候本 zone（请求返回本站内容或 404 才算合格；403/1034 = 禁用）
②国内路由快。2026-08-31 本机联通实测：

| IP                        | 入境 | TCP RTT | 首页 TTFB（命中） | 资格 |
| ------------------------- | ---- | ------- | ----------------- | ---- |
| 104.18.32.115             | SIN  | ~85ms   | 0.42~0.87s        | ✅ 本线路最优 |
| 103.21.244.1              | LAX  | ~185ms  | ~1.0s             | ✅ 稳 |
| 104.16.160.1              | LAX  | ~190ms  | 1.3~1.8s          | ✅ 晚高峰抖 |
| 104.16.132.229 / .133.229 | LAX  | ~195ms  | —                 | ❌ 1034 禁用（CF 自留） |
| 172.64.32.1 / 108.162.192.1 | SIN | ~85ms  | —                 | ❌ 1034 禁用 |

> 注意：Smart Placement 的落点会随流量重新分析而漂移（本日就经历了
> local → remote-SJC 的变化）。上线 B1 后若发现 `Cf-Placement` 离开
> 美西，再评估是否 `placement: { mode: "off" }` 让 Worker 贴着入口跑。

## B1 · Cloudflare for SaaS 优选 IP（推荐路线）

### 原理

CF 边缘按 SNI/Host 路由到 zone，**不关心客户端连的是哪个 CF IP**——所以只要
DNS 把国内用户引到「实测路由好的 CF IP」即可。本站 zone 托管在 CF DNS 上，
proxied 记录只会回答 zone 固定分配的 IP 对（没法自选）；要让 DNS 回答自选 IP，
需要把某个主机名的 DNS 挪出 CF，用 **Cloudflare for SaaS 的 custom hostname**
让流量仍走本账号 CF zone 进 Worker（免费版含 100 个 custom hostname）。

DNS 在国内服务商（DNSPod）还能**分线路解析**：境内走优选 IP、境外走默认。

### 施工步骤

1. **再注册一个免费子域**（dpdns.org 同现有流程，注意账号域名数量上限），
   NS 委派给 CF。此 zone 专职做 SaaS 提供方，自身 IP 对的质量无所谓。
   - **顺手一测（免费试签）**：把新域名以 custom domain 形式挂到 Worker
     （`wrangler.jsonc` 的 routes 加
     `{ "pattern": "<新域名>", "custom_domain": true }`），逼出它分到的
     IP 对再 `curl --resolve` 实测。**已实测（2026-08-31）**：新域名
     `liujiayi.dpdns.org` 抽到 `104.21.47.129 / 172.67.171.38`，本机
     联通线依然绕 AMS（TCP 553ms）——但 anycast 因 ISP 而异（主 pair
     联通 52% 走 SJC、电信 64% 走 AMS），新 pair 的真实成色要用 17ce
     分 ISP 实测：若电信显著改善，可直接把新域名当国内入口用，
     **免去整套 SaaS 与绑卡**。
2. **启用 SaaS**：该 zone → SSL/TLS → Custom Hostnames → Enable。
   ⚠️ **需先给 CF 账号绑支付方式**（100 个 custom hostname 内免费，超出
   才 $0.10/个/月——本站只用 1 个，不会产生扣费；但绑卡是开通门槛）。
   设 fallback origin 为如 `service.liujiayi.dpdns.org`，并在 DNS 里给它
   建一条 **originless 记录：`AAAA 100::`**（流量由 Worker 接，不需要真源站）。
3. **绑 Worker 路由**：zone → Workers Routes 添加
   `cn.liujiayii.dpdns.org/*` → `fund-plan`（或 `*/*` 全捕，此 zone 专用）。
   跑一次 `wrangler deploy` 验证路由仍在；若被清掉，把它以
   `{ "pattern": "cn.liujiayii.dpdns.org/*", "zone_id": "<该 zone id>" }`
   写进 `wrangler.jsonc` 的 routes（ZoneIdRoute 写法，显式 zone_id 避免
   wrangler 按 PSL 猜 zone 的老坑，见 wrangler.jsonc 里 100117 的历史注释）。
4. **委派 DNS**：主 zone（liujiayii.dpdns.org）加 NS 记录把 `cn` 委派给
   DNSPod（DNSPod 免费版支持境内/境外分线路）。
5. **DNSPod 配解析**（zone：`cn.liujiayii.dpdns.org`）：

   | 线路 | 记录 | 值 |
   | ---- | ---- | -- |
   | 境内（默认） | A × 2 | 优选 IP（见「优选 IP 怎么选」） |
   | 境外 | A × 2 | `104.21.73.133` / `172.67.145.12`（现 zone pair，境外用户本来就就近） |

6. **添加 custom hostname**：SaaS 面板添加 `cn.liujiayii.dpdns.org`，证书
   验证用 DNSPod 里放 TXT 记录（DCV）。
7. **验证**：
   ```bash
   # 入境机房应变成 LAX/SJC 段（不再是 AMS）
   curl -sSI -H 'accept: text/html' https://cn.liujiayii.dpdns.org/ | grep -iE 'cf-ray|x-fp-cache'
   # 静态资源在该主机名下也要能拿到（assets 与路由跨 zone 的组合，重点回归）
   curl -sSI https://cn.liujiayii.dpdns.org/assets/$(ls build/client/assets | head -1) | grep -iE 'HTTP|cf-cache-status|cache-control'
   ```
8. 把国内用户入口切到 `https://cn.liujiayii.dpdns.org`（旧域名不动，
   随时可整体放弃 cn 子域回退，零代码改动）。

### 优选 IP 怎么选

- **双门槛**：先过 1034 资格关（`curl --resolve 域名:443:IP https://域名/`，
  返回本站内容/404 才合格，403 即禁用），再比路由快慢。
- 起手候选（2026-08-31 本机联通实测，**用前必重测**——路由会漂移）：
  `104.18.32.115`（SIN，TCP ~85ms，命中 TTFB 0.42~0.87s）、
  `103.21.244.1`（LAX，TCP ~185ms，命中 ~1.0s）、`104.16.160.1`（LAX）。
- ⚠️ `104.16.132.229`、`104.16.133.229`、`172.64.32.1`、`108.162.192.1`
  路由虽好但被 1034 禁用，测了也是白测。
- 系统性筛选：[CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest)
  （GitHub 需走代理下载）先按延迟粗筛，再逐个过 1034 资格关；三家的最优
  IP 未必相同，DNSPod 按 ISP 分线路各配各的。

### 维护

IP 质量会漂移（运营商调整、CF 调 anycast）。每月或明显变慢时：重跑
CloudflareSpeedTest / 17ce → DNSPod 改 A 记录即可，**不需要动任何代码**。

## B2 · D1 搬家 weur（已否决，步骤留作备忘）

> **2026-08-31 实测后否决**：Smart Placement 已把 Worker 放到 SJC 与 D1
> 团聚，搬库反而拆散它们；且 B2 只救「入境在欧洲」的 SSR 路径，救不了
> 入境 RTT 本身（第二轮 17ce 显示缓存命中后剩下的全是网络路径开销）。

**原本的适用条件**：国内流量绝大多数绕欧洲入境，且不想维护 SaaS + DNSPod。

原理：入境在哪儿 Worker 就在哪儿跑（local placement），把 D1 搬到入境
附近（`weur`），跨洲往返变本地毫秒级。

```bash
# 1. 建新库（位置提示是尽力而为，不保证精确落点）
npx wrangler d1 create fund-plan-db-eu --location=weur
# 2. 导出旧库 → 导入新库（库才 1MB 级，窗口期几分钟）
npx wrangler d1 export fund-plan-db --remote --output=backup.sql
npx wrangler d1 import fund-plan-db-eu --remote --file=backup.sql
# 3. wrangler.jsonc 换 database_id → 迁移对齐 → 部署
pnpm db:migrate:prod && pnpm deploy
# 4. 观察无异常后删旧库
```

⚠️ 反向代价：若仍有用户从美西/亚太入境（电信常见 LAX），他们的查询反而
变跨洲。**B1 与 B2 不要叠加**（优选 LAX + D1 在欧洲 = 两头不讨好）。

## 已排除的路线（别再调研）

| 路线 | 为什么不行 |
| ---- | ---------- |
| Argo Smart Routing | 优化 CF 内部选路，不改变用户→入口的 anycast 第一跳，对国内绕路无效 |
| China Network | 企业版 + 需要 ICP 备案；dpdns.org 免费域拿不到备案 |
| D1 read replication / Sessions API | Workers 付费版功能 |
| workers.dev 备用入口 | 域名被 DNS 污染，国内基本不可用 |
| 换部署商 | 存储层（D1/KV/Cron）绑死 CF 全家桶，等于重写全站 |
| 直接给主域改 A 记录指优选 IP | zone DNS 在 CF 上，proxied 记录固定回答 zone 分配的 IP 对，改记录内容不改变 DNS 应答（这就是必须绕道 SaaS 的原因） |
