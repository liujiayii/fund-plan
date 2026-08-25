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

| 表达式（UTC） | 北京时间 | 作用 |
|---|---|---|
| `0 2 * * *` | 10:00 | 定投扫描，为到期计划生成 pending 申购单 |
| `30 12 * * *` | 20:30 | 拉当日净值 + 撮合所有 pending 订单 |

### 注册管理员账号

访问 `https://<你的域名>/register`，用 `ADMIN_USERNAME` 指定的用户名注册。
注册后访问首页，应能看到「主人的示范盘」。

### 冒烟测试

1. 访问 `/funds/000001`，应能看到真实的基金档案与净值曲线
2. 买入 1000 元，`/me/orders` 应出现一笔 `待确认` 订单
3. 等当晚 20:30 Cron 跑完（或在 Dashboard 手动触发），订单应变 `已确认`
4. `/me/holdings` 应出现持仓

## 免费版额度说明

| 资源 | 免费额度 | 本项目消耗 |
|---|---|---|
| Workers 请求 | 10 万次/天 | 每次页面访问 1 次 |
| D1 读 | 500 万行/天 | 充裕 |
| D1 写 | 10 万行/天 | 每笔订单约 5 行 |
| D1 存储 | 5 GB | 净值数据很小 |
| KV 读 | 10 万次/天 | 命中缓存的搜索/档案 |
| KV 写 | 1000 次/天 | ⚠️ 相对紧张，见下 |
| Cron | 支持 | 每天 2 次 |

**KV 写入是最紧的一环（1000 次/天）**。本项目的设计已经考虑了这点：

- 搜索结果缓存 1 天，同一关键词一天只写一次
- 基金档案缓存 1 天
- **净值不进 KV，直接进 D1**（`fund_nav` 表），且全站共享一份——
  100 个用户都持有沪深 300，也只拉一次净值

如果 KV 写入不够用，把 `app/services/fund-data.ts` 里 `CACHE_TTL` 的值调大即可。

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
