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

## 代码规范与 git 钩子

用 `@antfu/eslint-config`（flat config，见 `eslint.config.js`），风格是**双引号 + 分号 + 2 空格缩进**。

```bash
pnpm lint       # 检查
pnpm lint:fix   # 自动修（大部分问题都能自动修）
pnpm verify     # lint + typecheck + test，提交前全量校验
```

### git 钩子（simple-git-hooks）

| 钩子 | 动作 | 耗时 |
|---|---|---|
| `pre-commit` | `lint-staged` → 对暂存文件跑 `eslint --fix` | 秒级 |
| `pre-push` | `typecheck` + `test` | 十几秒 |

钩子会**自动格式化并重新 stage**，所以提交时不用手动跑 lint。
装依赖时 `simple-git-hooks` 的 postinstall 会自动写入 `.git/hooks`
（需要 `pnpm-workspace.yaml` 的 `allowBuilds` 放行，已配好）。

紧急情况绕过：`git commit --no-verify`。

### ⚠️ TypeScript 7 与 typescript-eslint 的并存

TS 7 是 Go 重写版，`typescript-eslint` 还不支持（会直接抛错拒绝运行）。
按**微软官方方案**做了双别名并存：

```json
"@typescript/native": "npm:typescript@^7.0.2",     // 提供 tsc（TS 7，typecheck 用）
"typescript": "npm:@typescript/typescript6@^6.0.2" // 提供 API（TS 6，eslint 用）
```

所以 `pnpm typecheck` 走的是 TS 7 的 `tsc`，而 ESLint 内部 `require('typescript')` 拿到的是 6.0.3。
**不要把 `typescript` 直接升到 7**，否则 lint 会挂。

## UnoCSS（原子化 CSS）

用法就是 Tailwind 那套类名（`presetWind4` 与 Tailwind v4 对齐）：

```tsx
<Card className="h-full">
  <Title className="mt-0">标题</Title>
</Card>
```

配置在 `uno.config.ts`，另有几个自定义快捷方式：
`text-rise`（涨红）、`text-fall`（跌绿）、`flex-center`、`flex-between`。

### ⚠️ 为什么是 CLI 预生成，不是 Vite 插件

`pnpm dev` / `pnpm build` 都会先跑 `pnpm uno:build`，把样式生成到 `app/uno.gen.css`
（该文件**入库**，不要手改，改了下次生成就被覆盖）。

原因是踩了两个坑：

1. **`unocss/vite` 插件 + Vite 8 不兼容**：插件依赖 Vite 的内部 `vite:css-post` 插件，
   而 Vite 8 换成 Rolldown 内核后该插件不存在。表现极其隐蔽——
   构建只报一行警告就成功了，但产出的 CSS 里只有一个 48 字节的占位符，**所有工具类全部丢失**。
2. **PostCSS 模式会让构建挂死**（超过 7 分钟无响应）。

CLI 方案已验证可靠：工具类正确进入最终产物。改了 class 之后如果样式没生效，
先确认 `pnpm uno:build` 跑过（或用 `pnpm uno:watch` 开监听）。

### ⚠️ 两个必须保持关闭的配置

- **`preflights.reset: false`** —— UnoCSS 的全局重置会冲掉 antd 自带的样式重置，
  导致按钮没背景色、输入框没边框。antd 已有 reset，不要第二套。
- **不启用 `presetAttributify`** —— 属性化写法会把 antd 组件的普通 props 误当工具类：
  `<Tag color="red">` 会生成 `[color~="red"]{color:red}`、
  `<Table align="middle">` 会生成 `[align~="middle"]{...}`，直接污染 antd 组件渲染。
  实测开启后 23 条生成规则里有 8 条是这类垃圾。

约定：**UnoCSS 只用来写布局与间距**，颜色/圆角/阴影仍走 antd 主题 token，
避免两套设计系统打架。

## 供应链策略（pnpm trustPolicy）

`pnpm-workspace.yaml` 里开了 `trustPolicy: no-downgrade`（严格模式），
并对 `semver@6.3.1` 做了精确豁免。

**这不是偷懒放行**——已核实为 pnpm 的误判：该版本发布于 2022-01，
而 npm 的 provenance 签名机制 2023-04 才推出，它不可能带有当时还不存在的签名。
pnpm 的规则是「更早发布的版本有签名而此版本没有 → 可疑」，在此场景下时间序判断失效。
它是 `@react-router/dev` → `@babel/core` 的传递依赖，无法规避。

将来若再遇到类似报错，**先核实发布时间与 provenance 机制的时间线**，
确认是误判再用 `trustPolicyExclude` 精确到版本号豁免，不要整体关掉策略。

## ⚠️ 改了 database_id 之后必须重跑本地迁移

miniflare 按 `database_id` **哈希出本地数据库文件名**，所以一旦改动
`wrangler.jsonc` 里的 `database_id`（比如从占位符换成真实 id），
本地就会切到一个**全新的空库**，旧库的表和数据都还在硬盘上但用不到了。

症状：页面报 `Failed query: select ... from "session" ...`，
因为浏览器里还留着旧库发的 session cookie，而新库连 `session` 表都没有。

修法：

```bash
pnpm db:migrate:local
```

可以这样确认本地库到底有没有表：

```bash
npx wrangler d1 execute fund-plan-db --local \
  --command "SELECT name FROM sqlite_master WHERE type='table'"

# 也能直接看文件大小，空库只有 4KB
ls -la .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite
```

## ⚠️ 纯客户端库必须懒加载（antd charts 的坑）

`@ant-design/charts` 底层是 G2，依赖 canvas / DOM，**不能在 SSR 阶段渲染**。
直接用会报：

```
Cannot read properties of null (reading 'useContext')
```

这个报错很误导——看着像 React 装了两份，实际是 SSR 渲染出空内容、
客户端 hydration 时结构对不上。

`app/components/NavChart.tsx` 里的正确姿势：

```tsx
// 1. 懒加载切成独立 chunk，服务端不 import
const Line = lazy(async () => {
  const mod = await import("@ant-design/charts");
  return { default: mod.Line };
});

// 2. 用 useSyncExternalStore 判断是否已在客户端
//    （比 useEffect + setState 少一次渲染，也不会触发 lint 告警）
const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

// 3. SSR 与加载期间渲染同一个骨架屏，保证结构一致
{mounted ? <Suspense fallback={<ChartSkeleton />}><Line {...config} /></Suspense> : <ChartSkeleton />}
```

附带收益：G2 那 2.2MB 被切成独立 chunk，首屏 `root` chunk 里零 antv 引用，
只有真正访问基金详情页时才下载。

**以后再引入任何依赖 canvas / window / document 的库，都照这个模式处理。**
