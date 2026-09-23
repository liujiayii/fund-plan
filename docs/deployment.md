# 部署指南

全程使用 Cloudflare 免费版，不需要付费账户。

## 前置准备

```bash
pnpm install
npx wrangler login   # 浏览器授权，若在无头环境用 CLOUDFLARE_API_TOKEN 环境变量
```

## 1. 创建 D1 数据库

```bash
npx wrangler d1 create fund-plan-db
```

命令会输出类似：

```
[[d1_databases]]
binding = "DB"
database_name = "fund-plan-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把这个 `database_id` 填进 `wrangler.jsonc`，替换掉占位符 `REPLACE_WITH_REAL_D1_ID`。

## 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create KV
```

输出里的 `id` 填进 `wrangler.jsonc`，替换掉 `REPLACE_WITH_REAL_KV_ID`。

## 3. 设置管理员用户名

`wrangler.jsonc` 的 `vars.ADMIN_USERNAME` 改成你要用的用户名（默认 `liujiayii`）。

**这个用户名很关键**：用它注册的账号会自动获得 `admin` 角色，
其投资组合会公开展示在首页与 `/master`，所有访客（含未登录游客）都能围观。

> 这不是密钥，放在 `vars` 里即可，不需要 `wrangler secret`。

## 4. 应用数据库迁移

```bash
pnpm db:migrate:prod
```

这会在线上 D1 里建好 10 张表。

## 5. 部署

```bash
pnpm deploy
```

等价于 `pnpm build && wrangler deploy`。

## 6. 部署后检查

### 确认 Cron 已注册

Cloudflare Dashboard → Workers & Pages → 你的 Worker → Settings → Trigger Events，
应能看到两条 Cron：

| 表达式（UTC） | 北京时间 | 作用                                    |
| ------------- | -------- | --------------------------------------- |
| `0 2 * * *`   | 10:00    | 定投扫描，为到期计划生成 pending 申购单 |
| `30 12 * * *` | 20:30    | 拉当日净值 + 撮合所有 pending 订单      |

### 注册管理员账号

访问 `https://<你的域名>/register`，用 `ADMIN_USERNAME` 指定的用户名注册。
注册后访问首页，应能看到「主理人的示范盘」。

### 冒烟测试

1. 访问 `/funds/000001`，应能看到真实的基金档案与净值曲线
2. 买入 1000 元，`/me/orders` 应出现一笔 `待确认` 订单
3. 等当晚 20:30 Cron 跑完（或在 Dashboard 手动触发），订单应变 `已确认`
4. `/me/holdings` 应出现持仓

## 搜索引擎收录（SEO）

爬虫基建（`robots.txt` / `sitemap.xml` / canonical / OG / 结构化数据）已在代码里就位，
但**上线后仍需人工去三大站长平台提交**。收录排查清单、关键词落地页与全部口径，
见 **[seo.md](seo.md)**——SEO 相关的新内容一律写那里，本文只讲部署。

## PR 预览环境

每个 PR 会自动上传为生产 Worker `fund-plan` 的一个**预览版本**
（`.github/workflows/preview.yml`，`wrangler versions upload --preview-alias pr-<PR号>`），
地址固定为 `https://pr-<PR号>-fund-plan.<workers.dev子域>.workers.dev`，
由机器人评论到 PR 上。

### 机制要点

- **versions upload 只上传版本**：不动生产流量、不碰自定义域名、不加 cron。
  生产入口 `liujiayii.dpdns.org` 永远跑 main 合并后的版本
- **绑定与生产共享**（D1/KV 同库同命名空间，2026-09-08 定案）：个人测试站，
  接受测试数据混进生产盘 + KV 写额度（账户级）共享，换取零资源创建成本
  与「预览天然有净值数据」（共享同一个 `fund_nav` 表，能测全交易流程）
- **绝不能用 `-c` 指定自定义 wrangler 配置来另起 preview Worker**：
  `pnpm build` 时 @cloudflare/vite-plugin 生成重定向配置
  （`.wrangler/deploy/config.json` → `build/server/wrangler.json`，vite 产物
  no_bundle 上传），`-c` 会绕开它导致 wrangler 对源码现打包、撞上
  未解析的 `virtual:react-router/server-build`（PR #74 首跑踩坑）
- **部署门控**：本人（所有者 liujiayii）的 PR 自动部署；他人 PR 走
  environment `preview-review`（required reviewer），需在 Actions 里点批准
- workers.dev 在国内被 DNS 污染，**本机访问预览地址需挂代理**；CI 不受影响
- 预览版本不额外占额度；不想留的旧版本可在 Dashboard → Worker → Versions
  里删除，或不管它（自动过期）

## 免费版额度说明

| 资源         | 免费额度    | 本项目消耗          |
| ------------ | ----------- | ------------------- |
| Workers 请求 | 10 万次/天  | 每次页面访问 1 次   |
| D1 读        | 500 万行/天 | 充裕                |
| D1 写        | 10 万行/天  | 每笔订单约 5 行     |
| D1 存储      | 5 GB        | 净值数据很小        |
| KV 读        | 10 万次/天  | 充裕（基金页一次约 8 次 get） |
| KV 写        | 1000 次/天  | ⚠️ 最紧的一环，见下 |
| Cron         | 支持        | 每天 3 次           |

**KV 写入是最紧的一环（1000 次/天；读有 10 万次，差两个数量级）**。

2026-09-23 收到过 CF 的「已用 50%」告警，根因是**基金详情页对「每一只基金」
写 7 个缓存 key**——所以额度直接等于「一天能承接多少只基金」：

| 每只基金的缓存 key | TTL | 均摊写/天 |
| --- | --- | --- |
| `fund:basic:{code}` | 1 天 | 1 |
| `fund:detail` / `position:v2` / `alloc` / `bonus` / `manager` / `style` | 7 天 | 各 1/7 |
| 合计 | | **≈ 1.86** |

这 7 个 key 全走 1 天档时约 137 只/天就写满，而库里已有 113 只基金、sitemap 又把
它们全量投给爬虫（每页还有 6 条同类基金内链）——爬虫把库扫一遍就吃掉 79% 额度。
现已按**数据自身的变动频率**分档：易变的（档案/搜索/排行榜）留 1 天，季度级披露
与只增不改的（重仓股/资产配置/分红/经理/风格/详情）放 7 天。

守卫测试：`tests/domain/fund-data.test.ts` 的「KV 写入预算守卫」钉住了
「单只基金均摊 ≤ 2 次写/天」——新增缓存 key 或把 TTL 改回 1 天会直接红。

两条既有的省法（改动时别破坏）：

- **净值不进 KV，直接进 D1**（`fund_nav` 表），且全站共享一份——
  100 个用户都持有沪深 300，也只拉一次净值
- 搜索结果按词缓存，key 空间无界，TTL 保持 1 天即可，别拉长成存量垃圾

再不够用时按顺序考虑：把 `basic` 也挪到多天档（**记得同步 `ensureFund` 的 1 天
过期判断**，那是同一节奏的另一半）→ 这类「纯东财镜像缓存」换成 Cache API
（免费、无每日操作次数）→ 升级 Workers 付费版（$5/月含 1000 万读 + 100 万写）。

## 国内访问速度

国内用户访问慢是免费版的结构性问题（无大陆节点 + anycast 绕路），
诊断证据、优选 IP 施工图（Cloudflare for SaaS 路线）与匿名页边缘缓存的
说明见 `docs/china-access.md`。部署后记得按其中的验证清单抽查
`x-fp-cache` 响应头与 `/assets/*` 的 immutable 缓存。

## 更新部署

```bash
git pull
pnpm install
pnpm db:generate        # 如果改了 schema
pnpm db:migrate:prod    # 如果有新迁移
pnpm deploy
```

## 忘记密码怎么办

Cloudflare 免费版发不了邮件（无 SMTP，MailChannels 免费通道已关闭），
所以本站没有邮件找回功能。需要手动重置：

```bash
# 1. 在本地用同样的算法生成新密码的 hash 与 salt
#    （PBKDF2-SHA256，10 万次迭代，16 字节随机盐，hex 编码）
# 2. 直接改库
npx wrangler d1 execute fund-plan-db --remote \
  --command "UPDATE user SET password_hash='<hash>', salt='<salt>' WHERE username='<用户名>'"
```

更省事的办法：让用户换个用户名重新注册。

## 回滚

```bash
npx wrangler deployments list
npx wrangler rollback --message "回滚原因"
```

注意：**回滚只回滚代码，不回滚数据库迁移**。如果新版本加了表/列，
回滚后旧代码不会用到它们，一般无害；但如果迁移删了列，回滚会导致旧代码报错。
本项目目前只有一个初始迁移，暂无此风险。
