# 开发指南

## 环境要求

- Node.js 20+（开发用 24.9）
- **pnpm**（不要用 npm，理由见下）

## 为什么必须用 pnpm + 淘宝镜像

本项目 `.npmrc` 把 registry 指向 `https://registry.npmmirror.com/`。原因是实测下来：

| 目标                 | 延迟            |
| -------------------- | --------------- |
| 东财接口（国内）     | 0.36 秒 ✅      |
| 淘宝镜像 npmmirror   | 2.05 秒 ✅      |
| **GitHub**           | **3 秒超时** ❌ |
| **npm 官方源 npmjs** | **5 秒超时** ❌ |

所以：

1. **不要用 `pnpm create cloudflare` / `create-react-router` 脚手架**——它们要从 GitHub 拉模板，必然超时。本项目所有配置文件都是手写的。
2. 如果你的全局 `~/.npmrc` 指向公司私有源，那种代理仓库遇到没镜像的包会回源 npmjs，一样会超时。项目级 `.npmrc` 会覆盖它。

### pnpm 构建脚本放行

`pnpm-workspace.yaml` 里有：

```yaml
allowBuilds:
  esbuild: true
  workerd: true
```

这两个包要靠 postinstall 下载原生二进制，不放行的话 vite 和 wrangler 本地运行时都起不来。
注意 pnpm 11 起该配置项叫 `allowBuilds`，早期版本叫 `onlyBuiltDependencies` 且写在 `package.json` 里，都已废弃。

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm dev                  # 起本地开发服务（含真实 workerd 运行时 + 本地 D1/KV）
pnpm build                # 构建
pnpm typecheck            # 类型检查
pnpm test                 # 领域层单元测试（node 环境，快）
pnpm test:workers         # 应用层集成测试（真实 workerd + 真实 D1）
pnpm test:all             # 全部测试
pnpm db:generate          # schema 改动后重新生成迁移 SQL
pnpm db:migrate:local     # 应用迁移到本地 D1
pnpm cf-typegen           # 重新生成 worker-configuration.d.ts
```

首次开发前必须跑一次 `pnpm db:migrate:local`，否则本地 D1 里没有表。

## 精度约定（改代码前务必读）

金融系统的命门。数据库里**没有小数**，全是整数：

| 数据 | 存储                     | 例子                    |
| ---- | ------------------------ | ----------------------- |
| 金额 | 整数「分」（×100）       | 1000 元 → `100000`      |
| 份额 | 整数（×10000）           | 656.8133 份 → `6568133` |
| 净值 | 整数（×10000）           | 1.2345 → `12345`        |
| 费率 | 整数「万分之」（×10000） | 1.5% → `150`            |

中间运算一律用 `decimal.js`，最后 `roundInt()` 四舍五入回整数。
**绝不要用 JS 浮点数直接算钱**——`0.1 + 0.2 !== 0.3` 会让你的账永远对不上。

相关工具都在 `app/domain/money.ts`。

## 分层约定

```
app/domain/     纯函数，不依赖 D1/网络，可脱离运行时单测 ← 金融逻辑放这里
app/services/   应用层，依赖 D1/网络，把 D1 数据喂给领域层再写回
app/routes/     loader/action + 页面组件
```

新增金融计算逻辑时，**先在 domain 层写纯函数 + 单测**，再在 service 层接线。
这样测试跑得快（毫秒级），且不需要起数据库。

## 东财接口的坑（血泪教训）

各接口对请求头的要求**不一样**，实测结论：

| 接口                                       | Referer  | User-Agent               |
| ------------------------------------------ | -------- | ------------------------ |
| 历史净值 `api.fund.eastmoney.com/f10/lsjz` | **必须** | 无所谓                   |
| 基本信息 `fundmobapi.eastmoney.com/...`    | 可选     | **绝不能带浏览器 UA** ⚠️ |
| 搜索 `fundsuggest.eastmoney.com/...`       | 无所谓   | 无所谓                   |

⚠️ `fundmobapi` 是移动端接口，按 UA 判断调用方。带上 Chrome UA 会返回
**HTTP 200 但 `Datas` 为空**——静默失败，极难排查。曾经因此让基金详情页整个 404。

另外 `fundgz.1234567.com.cn`（盘中实时估值）从服务器直连会被挡返回 404，
本项目不依赖它——T+1 撮合用的是当日**收盘净值**。

## 交易日历需要每年更新

`app/domain/trading-calendar.ts` 里的 `CN_HOLIDAYS` 是硬编码的法定节假日表，
**每年需要人工更新一次**（国务院安排通常前一年 11-12 月公布）。

兜底机制：撮合时会把 `fund_nav` 里的净值日期序列作为 `knownTradingDays` 传入——
有净值的那天必然是交易日，可反向校正节假日表的遗漏。

## 调试技巧

dev server 跑起来后，Cloudflare 插件提供了本地可观测性 API：

```bash
# 查 Worker 日志（比翻终端输出方便）
curl -X POST http://localhost:5173/cdn-cgi/local/explorer/api/local/observability/query \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT message FROM logs ORDER BY rowid DESC LIMIT 20"}'

# 查 KV 缓存内容
curl http://localhost:5173/cdn-cgi/local/explorer/api/storage/kv/namespaces
```

手动触发 Cron（不用等到点）：

```bash
# 定投扫描（北京 10:00 那个）
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+2+*+*+*"
# 净值同步 + 撮合（北京 20:30 那个）
curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=30+12+*+*+*"
```

直接查本地 D1：

```bash
npx wrangler d1 execute fund-plan-db --local --command "SELECT * FROM orders"
```

### Windows 终端的中文坑

Windows 默认 GBK 控制台，用 curl 发中文参数会按 GBK 编码，服务端按 UTF-8 解读就成乱码。
测试中文搜索时用明确的 UTF-8 百分号编码：

```bash
curl "http://localhost:5173/funds?q=%E7%99%BD%E9%85%92"   # 白酒
```

同理，终端里看到的中文乱码往往只是显示问题，不代表数据真的坏了——
用 `python -c "..."` 读取并写文件再看，或直接看浏览器。

## 缓存注意事项

基金搜索与档案走 KV 缓存（1 天）。**如果接口逻辑改了但结果没变化，先清缓存**：

```bash
# 列出所有 key
curl http://localhost:5173/cdn-cgi/local/explorer/api/storage/kv/namespaces/<id>/keys
# 删除某个 key（注意 URL 编码）
curl -X DELETE http://localhost:5173/cdn-cgi/local/explorer/api/storage/kv/namespaces/<id>/values/<encoded-key>
```

曾经因为带错 UA 时把空搜索结果缓存下来，导致修好代码后仍然搜不到东西。
