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

## PR 预览环境

每个 PR 会自动部署到预览环境（`.github/workflows/preview.yml`，
配置在 `wrangler.preview.jsonc`）：独立 Worker `fund-plan-preview`，
通过 `https://fund-plan-preview.<账户ID>.workers.dev` 访问，
地址由机器人评论到 PR 上。

### 隔离策略（2026-09-08 定案）：共享生产 D1/KV

预览 Worker 实例独立，但 **D1 与 KV 与生产共享同一个库/命名空间**。
个人测试站，接受以下代价换取零资源创建成本：

- **PR 里的注册/下单/定投是真实写操作，直接进生产盘**——测试数据会出现在
  `/admin`、排行榜与主理人的组合里，污染了得手写 SQL 清理
- **KV 写额度（账户级 1000 次/天）两边共享**，预览拉基金档案/搜索会挤占
- **preview.yml 刻意不做 D1 迁移**：迁移只由 deploy.yml（main Test 全绿后）
  执行，PR 的 schema 变更不允许在合并前改生产库结构
- **preview 配置绝不能加 crons**：否则 preview 与生产两个 Worker 每天各扫
  一次定投/撮合，同一计划双倍下单、T+1 被提前撮合

> 曾考虑官方 versions preview URL（`wrangler versions upload`）：预览版本
> 与生产共享绑定，效果等价且 URL 不固定，无额外收益，不采用。
> 日后若测试污染成为实际痛点，再切独立 D1/KV（免费版 10 库/100 namespace
> 余量充足），只需换 `wrangler.preview.jsonc` 两个 ID。

### 注意事项

- workers.dev 在国内被 DNS 污染，**本机访问预览环境需挂代理**；CI 部署不受影响
- 多个 PR 共用同一个预览 Worker，后推送的覆盖先前的
- 预览 Worker 长期保留不吃多少额度；不想留了手动删：
  `npx wrangler delete -c wrangler.preview.jsonc`

## 免费版额度说明

| 资源         | 免费额度    | 本项目消耗          |
| ------------ | ----------- | ------------------- |
| Workers 请求 | 10 万次/天  | 每次页面访问 1 次   |
| D1 读        | 500 万行/天 | 充裕                |
| D1 写        | 10 万行/天  | 每笔订单约 5 行     |
| D1 存储      | 5 GB        | 净值数据很小        |
| KV 读        | 10 万次/天  | 命中缓存的搜索/档案 |
| KV 写        | 1000 次/天  | ⚠️ 相对紧张，见下   |
| Cron         | 支持        | 每天 2 次           |

**KV 写入是最紧的一环（1000 次/天）**。本项目的设计已经考虑了这点：

- 搜索结果缓存 1 天，同一关键词一天只写一次
- 基金档案缓存 1 天
- **净值不进 KV，直接进 D1**（`fund_nav` 表），且全站共享一份——
  100 个用户都持有沪深 300，也只拉一次净值

如果 KV 写入不够用，把 `app/services/fund-data.ts` 里 `CACHE_TTL` 的值调大即可。

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
