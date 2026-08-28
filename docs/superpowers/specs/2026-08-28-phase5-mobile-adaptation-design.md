# 移动端适配（期五）—— 设计文档

> 2026-08-28 · 状态：**已施工**（2026-08-28 收尾，实现区间 `80850fb..8cb7add`，分支 feat/phase5-mobile-adaptation）
> 人工验收清单待走：`.superpowers/sdd/2026-08-28-phase5-mobile-adaptation/browser-checklist.md`
> 前置文档：[`2026-08-25-alipay-style-refactor-design.md`](./2026-08-25-alipay-style-refactor-design.md)
>
> ⚠️ **本文推翻前置文档的「桌面为主」定位。** 具体推翻了哪几条、哪几条依然成立，
> 见 §1.2。前置文档对应段落已加指向本文的取代标注。
>
> 本文只描述**布局与响应式**。金融内核、精度铁律、T+1 规则、撮合幂等、
> 权限模型一概不动；页面的信息层级与配色也不动 —— 那些是期一到期四的成果。

## 1. 背景与目标

### 1.1 现状：不是疏漏，是既定后果

期一到期四把桌面端做到了支付宝基金那个档次，但**移动端从未进入过设计范围**。
证据不是猜的：全仓 `app/**` 里 **0 条媒体查询、0 个响应式 hook**
（无 `useBreakpoint` / `matchMedia` / `window.innerWidth` 的任何调用），
antd 栅格的 `xs`/`sm` prop 全站只出现 **7 次**。

**这是记录在案的决定，不是马虎。** 前置文档 §1「定位边界（已确认）」写着
「桌面为主，不引入 antd-mobile、不做底部 Tab」，§12 把「移动端 App 观感」
列入明确不做的范围。所以本期的性质是 **新增一个此前被明确排除的需求维度**，
不是补漏 —— 这个区别决定了本文必须先处理与前置文档的冲突（§1.2），
而不是默默改代码。

窄屏下的实际状况（375px 视口实测，依据见 §4.1 宽度预算）：

| 分级 | 数量 | 典型后果 |
| ---- | ---- | -------- |
| **阻塞级** | 9 处 | 内容顶穿 Card 与 Content，**整页出现横向滚动条**；或核心信息读不到 |
| **体验级** | 21 处 | 能用但挤，或布局意图静默落空（写了两列实际渲染成一列） |

最刺眼的三处，用来说明问题的性质：

1. **`SellPanel.tsx:154` 的 FIFO 试算表塞在 `Alert` 里** —— `Alert` 带
   description 时内部可用宽仅 **231px**，而 4 列表格 min-content 约 330px。
   全站最窄的容器套了最宽的内容，**而这是「卖出」的核心决策信息**。
2. **`PortfolioView.tsx:40` 写了 `Col xs={12}` 想要两列，实际渲染成一列** ——
   「128,450.66 元」在 `StatBig size=32` 下 min-content 约 209px，超过
   `(279+24)/2−24 = 127.5px`；CSS 的 `min-width:auto` 压过 `maxWidth:50%`，
   Col 撑到 209px，`Row` 的 `flexFlow:'row wrap'` 把它换行。
   于是「两列」意图静默退化成一列 209px 宽、右侧空 94px。**`/`、`/me`、`/master` 三页共用这一处。**
3. **`root.tsx:125` 的顶部 Menu 窄屏只剩约 103px**，antd 把溢出项收进
   `EllipsisOutlined`，**5 个一级导航全部塌成一个 `···`**；已登录时（头像 +
   用户名 + 「（主理人）」）Menu 被压到接近 0。

### 1.2 与前置文档的冲突处理

前置文档有 4 处明确排除本期工作，逐条给出结论：

| 前置文档位置 | 原文要点 | 本文结论 |
| ------------ | -------- | -------- |
| §1 `:28` 定位边界 | 形态「**桌面为主**」，不引入 antd-mobile、**不做底部 Tab** | **部分推翻**：定位改为「双端平权」；底部 Tab **做**。"不引入 antd-mobile" **保留** |
| §2 `:37` 设计原则 1 | 「不试图在桌面上复刻手机的尺寸与手势」 | **保留原意，缩小适用范围**：桌面端仍不复刻手机尺寸与手势；本期只在窄屏生效，桌面观感一行不退 |
| §12 `:504` YAGNI | 「移动端 App 观感 / antd-mobile / 底部 Tab 栏 —— 已定桌面为主」 | **部分推翻**：底部 Tab 移出排除项。"antd-mobile" 与「原生手势/转场动画」**仍在排除项**（见 §12） |
| §13 `:516` 决策速查 | 组件库「继续 antd」，理由「定位桌面为主；换 antd-mobile 等于重写所有页面」 | **决策不变，理由更新**：继续 antd。本期**零新增依赖**，底部 Tab 是手写 `<nav>` + CSS，不需要换组件库 |

**关键一句：期一到期四的成果一行都不用返工。** 期一把三张持仓表全部卡片化，
那恰好是移动端最想要的形态；本期是在既有卡片上加断点，不是拆它。
唯一需要改动结构的是 §7 那三个 `Table` 与 §8 的 `FundListItem`。

### 1.3 目标与定位

**双端平权：桌面观感一行不退，移动端从「缩小的网页」变成「能舒服用的页面」。**

「平权」是取舍判据，落到实处有两个含义：

- **不给任何单个页面加码。** 优先级严格按**严重程度**排（阻塞级 → 体验级），
  不因为「某页更常用」而插队。
- **桌面回归是硬门槛。** 任何改动若让 `md`（768px）以上的观感**退化**，
  即视为改错 —— 本期绝大多数 CSS 都写在 `max-width: 767px` 的媒体查询里。

  > ⚠️ **唯一有意的桌面变更：`SellPanel` 把 FIFO 试算表移出 `Alert`（§7）。**
  > `Alert` 的 `padding: 20px 24px` + `showIcon` 在**任何宽度下**都在挤压这张表，
  > 这是既有缺陷而非移动端问题，所以两端一起修。除此之外不得有第二处桌面变更；
  > 若实施中发现某处非改桌面不可，**停下来先改 spec**，不要顺手改了。

## 2. 定位边界（已确认）

| 维度 | 决定 |
| ---- | ---- |
| 形态 | **双端平权**。继续用 antd，**零新增依赖**；移动端加底部 TabBar |
| 分界 | 单一断点 **768px**（antd `md`），以下为移动端 |
| 下限 | **320px** 保「不溢出、能用」；**375px** 是体验打磨基准 |
| 断点信号 | **纯 CSS 媒体查询**为主；结构必须不同的少数几处走双渲染 + CSS 显隐。**不引入任何 JS 断点 hook** |
| 深度 | 保底（不溢出）+ 体验打磨（触控区、字号、间距、表格降级）。**不做原生手感**（下拉刷新 / 手势 / 转场动画） |
| 视觉 | 期一的色彩与信息层级一律不动 |

## 3. 设计原则

1. **零 JS、零 hydration 风险。** 项目是 SSR（React Router 8 framework mode
   + workerd）。任何靠 JS 探视口的方案在服务端都拿不到宽度：antd 的
   `Grid.useBreakpoint()` 首渡返回空对象，写 `screens.md ? 桌面 : 移动`
   会让**桌面用户每次都闪过一帧移动布局**。纯 CSS 媒体查询是唯一零闪烁解。
2. **先抬基线，再修个案。** 窄屏 padding 收窄一处改动就把可用宽从 279px
   抬到 319px（§5），一批「临界溢出」自动消失。先做这个，再逐条修剩下的，
   避免为已经不存在的问题写补丁。
3. **能压缩就压缩，不能压缩才降级。** 大多数溢出的根因是
   `whiteSpace:"nowrap"` 与缺失的 `min-width:0` 让元素**不可压缩**。
   先去掉不可压缩性，只有信息量真的放不下时才换结构（§7）。
4. **不为适配破坏既有封装。** `SectionCard` 刻意不透传 `style`/`styles`
   （其源码注释写明了理由：防止长成万能壳）。本期**不开这个口子**，
   改用全局 CSS 覆盖 `.ant-card-body`（§5.2）。
5. **桌面零回归。** 见 §1.3。

## 4. 断点与 CSS 架构

### 4.1 宽度预算（所有判断的依据）

375px 视口下逐层剩余宽度。**这张表是本期所有「溢出/不溢出」结论的来源**，
改任何 padding 前先回来看它：

| 层 | 来源 | 剩余可用宽 |
| -- | ---- | ---------- |
| body | — | 375 |
| `Content` padding 24/24 | `app/root.tsx:187` | **327** |
| `SectionCard` = Card，body padding = `paddingLG` = 24 | antd Card 默认 | **279** |
| `Alert` 带 description（padding `20px 24px`，`showIcon` 再减约 30） | antd Alert 默认 | **约 200** |
| `Timeline` item 内容缩进约 26 | antd Timeline 默认 | 约 253 |
| `Modal`（`maxWidth: calc(100vw - 32px)`，body 24） | antd Modal 默认 | 295 |

**279px 是绝大多数内容的真实上限** —— 光 padding 就吃掉 96px，
占 375px 屏宽的 **25.6%**。

### 4.2 两条必须记住的 antd / rc 机制

本期近半数阻塞项由这两条解释，写代码时反复用到：

1. **`<Table>` 不写 `scroll.x` 就没有滚动容器。** rc-table 的
   `overflowX:'auto'` 只在 `horizonScroll`（即 `scroll.x` 为真）时生成；
   而 `.ant-card` 根节点**没有** `overflow:hidden`。所以宽表格会一路
   顶穿 Card → 顶穿 `Content` → **整页出现横向滚动条**，
   不是「表格内横滚」，是整个页面歪掉。
2. **`Space` 默认 `wrap=false`，且 `.ant-space-item` 没有 `min-width:0`。**
   所以不带 `wrap` 的 `Space` 里各 item 只能缩到自己的 min-content 就停住；
   叠加 `whiteSpace:"nowrap"` 会把 min-content 钉成整串文本全长 → **完全不可压缩**。

### 4.3 断点值：必须对齐 antd

**UnoCSS 与 antd 的断点当前不一致，只有 768 撞对：**

| 来源 | 断点值 |
| ---- | ------ |
| UnoCSS `presetWind4`（Tailwind v4 默认） | sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536 |
| antd 栅格（`responsiveObserver`） | xs 480 / sm 576 / md **768** / lg 992 / xl 1200 / xxl 1600 |

混用 `Col sm={12}`（576）与 `sm:flex-col`（640）会在 **576~640px 之间
出现两套断点错位的跳变**。因此 `uno.config.ts` 的 **`theme.breakpoint`** 显式对齐
antd 的六个值。

> ⚠️ **键名是单数 `breakpoint`，不是 `breakpoints`。** `presetWind4@66.8.1` 的
> `dist/theme.mjs:554` 定义的是 `const breakpoint = { sm: "40rem", md: "48rem", … }`
> ——Wind4 为对齐 Tailwind v4 的 `--breakpoint-*` 变量改了键名，写复数会静默无效。
>
> 本期**不使用任何 UnoCSS 断点变体类**（媒体查询全在 `responsive.css` 手写，
> 且自定义 extractor 认不出动态 className）。所以这项对齐是**防御性**的：
> 挡住将来有人顺手写 `md:p-3` 时与 antd 栅格错位。

**主断点选 768（`md`）**，理由：它是两套体系唯一重合的值，改不改对齐都安全，
且恰好是平板竖屏的自然界线。**全期只用这一个分界**，不引入第二个断点档
——多档断点是维护灾难，收益却极小。

### 4.4 CSS 入口：新增 `app/styles/responsive.css`

**现状是没有入口可写媒体查询：**

- `uno.config.ts` 的 `preflights.reset = false`（为了不冲掉 antd 自带重置），
  所以 UnoCSS 不产出任何全局样式；
- `app/uno.gen.css` 是 `pnpm uno:build` 的**纯产物**，`dev`/`build` 都前置了
  该命令，手改必被覆盖（该文件当前 0 条媒体查询）；
- UnoCSS 的断点变体类（`md:p-3`）在本项目**不完全可靠**：
  `uno.config.ts` 用了自定义 extractor，只匹配 `class=`/`className=` 后跟的
  **静态字符串字面量**，`className={cond ? "a" : "b"}` 与含 `${}` 的模板串
  提取不到。

**决定：新增手写 `app/styles/responsive.css`（入 git，非产物），
在 `root.tsx` 里 import。** 顺序必须是：

```
antd/dist/reset.css  →  ./uno.gen.css  →  ./styles/responsive.css
```

放最后才能覆盖 UnoCSS 工具类与 antd 组件类。该文件承载本期**全部**媒体查询，
是「窄屏长什么样」的唯一出处 —— 不允许在组件里散写 `@media`。

文件内只放三类东西：

1. `max-width: 767px` 下的全局基线覆盖（§5）
2. `.mobile-only` / `.desktop-only` 显隐工具类（§7）
3. 具名组件的窄屏样式（底部 TabBar、日历格子、图表容器高度）

## 5. 全站基线：两个杠杆先落地

### 5.1 `Content` padding 24 → 12

`root.tsx:187` 的 `padding: "24px 24px 48px"` 在 375px 下吃掉 48px 横向
（12.8% 屏宽），**它是所有溢出的放大器**。窄屏改 12，可用宽 327 → **351px**。

底部 padding 需同时为 TabBar 让位：

```
padding-bottom: calc(56px + env(safe-area-inset-bottom) + 16px)
```

### 5.2 Card body padding 24 → 16

`SectionCard` 刻意不透传 `style`/`styles`，因此**唯一出口是全局 CSS**：

```css
@media (max-width: 767px) {
  .ant-card-body { padding: 16px; }
}
```

**为什么不走 `ConfigProvider` 的 token：** token 是全局的，无法只在窄屏生效
（`ConfigProvider` 的值在 SSR 时就定了，要按视口切换就必须引 JS 断点，
违背 §3.1）。全局 CSS 媒体查询是唯一零 JS 解。

**两个杠杆合计（375px 视口）：`375 − 12×2 = 351`，`351 − 16×2 = 319`。
可用内容宽 279px → 319px（+14.3%）。** 这一步做完再看
体验级清单，一部分「临界溢出」项已自然消失，不必再写补丁。

## 6. 底部 TabBar

### 6.1 形态与项数

新增 `app/components/MobileTabBar.tsx`，`position: fixed` 固定底部，
窄屏显示、`md` 以上 CSS 隐藏。

**放 4 项：首页 / 基金 / 自选 / 我的。** 把「主理人的盘」从底栏拿掉 ——
首页已有它的引流卡片入口，不必占一格。

数字依据：320px ÷ 4 = **80px/格**，够放图标 + 双字标签；
5 格只剩 64px，图标与标签会挤到贴边。

### 6.2 顶栏窄屏的对应改动

`root.tsx` 的 Header 窄屏：**CSS 隐藏 Menu**，只留 logo（18px → 16px）
与登录态区。导航职责整体移交底栏，顶栏退化为品牌 + 账号。

> ⚠️ Menu 用 CSS 隐藏而非条件渲染 —— 条件渲染需要 JS 断点（违背 §3.1）。
> 隐藏的 Menu 在移动端仍在 DOM 里，代价是几个 `<li>`，可接受。

### 6.3 安全区

```css
padding-bottom: env(safe-area-inset-bottom);
```

吃掉 iPhone 底部横条。不加会让最后一格标签被系统横条压住。

### 6.4 高亮逻辑抽成纯函数（本期唯一 domain 新增）

现有 `selectedKey` 算法在 `root.tsx:81-84`，用 `startsWith` 取首个命中。
它有一个**顺序陷阱**，源码注释已写明：

> `/me/watchlist` 必须排在 `/me` 之前，否则会被 `/me` 先吃掉，
> 导致自选页高亮「我的」。

底栏要复用同一套高亮逻辑。**逐字复制会重演期十三那次
「两份独立漂移」的教训**（`PortfolioView.tsx:28` 记着那笔账）。
因此抽成 `app/domain/nav.ts` 的纯函数 + node 单测，
**顺手用测试把这个顺序陷阱钉死** —— 以后谁调 `NAV_ITEMS` 顺序谁红。

这是本期唯一新增的领域函数，也是本期唯一能被自动化测试覆盖的部分（见 §11）。

## 7. 三个 Table 的窄屏降级

全站只有 3 处 `<Table>`，**全都没写 `scroll.x`**（后果见 §4.2）。
按 §3.3，信息量真的放不下，所以换结构而非只加横滚：

| 位置 | 列数 / min-content | 处理 |
| ---- | ------------------ | ---- |
| `SellPanel.tsx:154` FIFO 试算表 | 4 列 / 约 330px，容器仅 231px | **先移出 `Alert`** 直接放卡内（231 → 279px，叠加 §5 两个杠杆后 319px；桌面也受益），再窄屏降级成卡片 |
| `me.holdings.$code.tsx:140` 份额批次表 | 5 列 / 约 430px | 降级成卡片。**它是 FIFO 阶梯费率可见性的载体**（`share_lot` 存在的唯一理由），不能只让它横滚 |
| `funds.$code.tsx:304` 重仓股表 | 5 列 / 约 420-480px | 降级成 `DataRow` 列表 |

`PeriodReturnTable.tsx` 是**现成范本** —— 它刻意不用 `Table`，
源码注释写明了理由，7 行 `DataRow` 窄屏零风险。

### 7.1 双渲染 + CSS 显隐

```tsx
<div className="mobile-only">{/* 卡片 / DataRow 列表 */}</div>
<div className="desktop-only">{/* 原 Table，一行不改 */}</div>
```

两个 class 在 `responsive.css` 定义。**零 JS、零 hydration 风险、桌面零回归。**

代价是这三处 DOM 渲染两份。可接受，因为：行数都在 20 以内；
桌面那份 `Table` **完全不动**，回归风险最低；换 JS 条件渲染省下的 DOM
换来的是每个桌面用户一帧闪烁（§3.1）。

## 8. `FundListItem` 窄屏两段式

**辐射最广的单个文件** —— 5 个页面消费它：
`HoldingList` / `OrderList` / `DcaPlanList` / `funds._index` / `me.watchlist`。

现状是单行三段（左名称 `flex:1` + 右主副值 + 最右操作区），
后两段 `nowrap` 不可压缩，把基金名挤到 50~80px，15px 中文名 3~4 字就换行。
`me.watchlist.tsx:99` 的操作区「查看」+「取消自选」占 148px，
留给名称仅约 53px。

**窄屏改上下两段：名称占满第一行；数值 + 操作第二行。** 同时：

- **去掉 `:97` 的 `whiteSpace:"nowrap"`** —— 它是 `OrderList.tsx:100` 那串
  「净申购 4,950.00 元 · 成交净值 1.2345 · 4,010.1234 份 · 费 50.00 元」
  （min-content 约 380px）顶穿整页的**根因**。
  `OrderTimeline.tsx:45` 渲染同样的数据却安全，区别只在它没写 `nowrap`。
- gap 16 → 8

改完 **5 个页面都要回归**（写进验收清单）。

## 9. 逐项修正清单

§5~§8 之外的改动，模式一致、逐条钉。按「改一处受益多处」排序：

| 位置 | 改动 | 受益面 |
| ---- | ---- | ------ |
| `ui/StatBig.tsx:44` | 数值行加 `min-width:0`，值 span 允许收缩 | 8 个调用点的共同上限 |
| `PortfolioView.tsx:40,47,56,65` | `Col xs={12}` → `xs={24}` | `/`、`/me`、`/master` 三页 |
| `ui/PeriodTabs.tsx:21` | 外层套 `overflow-x:auto`（`Segmented` 不换行不滚动，246px vs 279px 临界） | 两个图表 |
| `AssetTrendChart` + `NavChart` | 抽共享 `CHART_HEIGHT` 常量（**4 处硬编码 320**，含 2 份骨架屏），窄屏靠 CSS 容器高度配 `autoFit`；放开 `labelAutoRotate` | 两图表 + 两骨架屏 |
| `funds.$code:186` / `me.holdings:49` / `me.holdings.$code:124` / `me.dca:168` | 4 处 `Space size={48} wrap` → `Row/Col xs={12}`。现状是横向 gap 48 放不下 → 折成 N 行，且 wrap 时 rowGap 同为 48，5 个数字占掉约 535px 高 | 4 页 |
| `me.orders.tsx:62` / `master.tsx:131,159` | 3 个 `Pagination` 传 `responsive`（⚠️ antd 的自动缩小是 `xs && !size && responsive`，**不显式传就不生效**）+ 外层 `overflow-x:auto` | 2 页 |
| `ProfitCalendar.tsx:143,188,213` | `repeat(7, minmax(0,1fr))`；`minHeight:44` → `aspect-ratio:1`；窄屏 padding 与字号下调。现状格子内容宽 24.4px，11px 的「+1234」需 30px，**被 ellipsis 截成「+12…」，日历只剩色块** | `/me` |
| `funds._index.tsx:117` | 两个 `Segmented`（4 类型 + 3 周期，合计约 454px）从 `extra` 移进卡内独立一行 + `overflow-x:auto`。Card 标题行是不换行的 flex，只有 279px | `/funds` |
| `me.dca.tsx:200` | 操作区两按钮（120px `nowrap`）叠加副值约 126px 已顶到 279px 上限，金额到 4 位数即溢出 → 合成 `···` Dropdown 或移到行下方 | `/me/dca` |
| `SellPanel.tsx:126` | `Slider` step = 份额/100，279px 上 2.8px/档，手指无法定位 → 换 25/50/75/全部 快捷按钮（`BuyPanel.tsx:115` 已是这个正确形态） | 卖出 |
| `me.holdings.$code.tsx:112` | `Space align="baseline"` 加 `wrap`，返回按钮单独一行。现状后三项 222px `nowrap`，h3 被挤到 57px，9 字基金名折成 4 行 | 持仓详情 |
| `master.tsx:100` | Tabs label 去掉计数（「交易记录（50）」→「交易记录」）。4 项合计约 462px，虽有 antd 自带横滚兜底，但退化成必须点箭头才能切 | `/master` |
| `TxList.tsx:51` | gap 16 → 8 | 流水 |
| `login.tsx:64` / `register.tsx:56` / `me.settings.tsx:161` | `maxWidth:420` → `min(420px, 100%)`。**当前不坏是靠隐式兜底**（外层 padding 让实际宽 327px < 420，maxWidth 不生效），§5.1 把 padding 改小后这个兜底会变薄，先显式化 | 3 页，防御性 |

**已经写对、不动的**（可作范本）：
`_index.tsx:167` 的 `Col xs={24} sm={12} lg={6}`（全站唯一完全正确的栅格）、
`OrderTimeline.tsx:34` 的 `flexWrap:"wrap"` + 无 `nowrap` 长文本、
`PeriodReturnTable.tsx` 的表格降级、`BuyPanel.tsx:115` 的 `Space wrap`、
`me.dca.tsx:237` 的 Modal（有 antd 官方 `calc(100vw-32px)` 兜底）。

## 10. 交付顺序

按依赖与收益排，不按页面排：

1. **地基**：`uno.config.ts` 断点对齐 + `responsive.css` 建档 + `root.tsx` 接入
2. **两个杠杆**（§5）—— 做完重新量一遍，划掉自然消失的项
3. **`nav.ts` 纯函数 + 单测**（§6.4），再落 `MobileTabBar` 与顶栏（§6）
4. **`FundListItem` 两段式**（§8）—— 辐射 5 页，越早做后面越省
5. **三个 Table 降级**（§7）
6. **逐项修正**（§9），按表内顺序
7. **人工验收**（§11）

每步独立可 `pnpm verify` + commit。**一个 Task 一个 commit**（沿用 CLAUDE.md 约定）。

## 11. 测试策略

**必须先说清：纯 CSS 与布局改动无法自动化单测。** 本项目没有 e2e 框架，
本期**不引入**（Playwright 需要新依赖 + 跑 dev server + 改 CI，
而本机 GitHub / npm 官方源不通，浏览器二进制下载是额外风险）。
所以防线分三层，不假装有第四层：

| 层 | 手段 | 保什么 |
| -- | ---- | ------ |
| 领域层 | `app/domain/nav.ts` 新增单测（`pnpm test`） | 底栏高亮逻辑 + `/me/watchlist` 顺序陷阱（§6.4） |
| 回归 | `pnpm verify` + `pnpm test:workers` 全绿 | 布局改动没碰坏任何业务逻辑 |
| 人工 | `.superpowers/sdd/2026-08-28-phase5-mobile-adaptation/browser-checklist.md` | 窄屏实际观感 —— **这是唯一必须人做的部分，子代理没有浏览器** |

**验收清单照期一的格式写**：每条写明「要看什么」和「看错了说明哪里坏了」，
不写泛泛的「看看对不对」。三档视口：**320 / 375 / 390px**，
其中 320 只验「不溢出、能用」，375 验体验打磨。

清单必须覆盖的高风险项（改动辐射最广者）：
`FundListItem` 的 5 个消费页、`PortfolioView` 的 3 个共用页、
`StatBig` 的 8 个调用点、三个降级 Table 的信息完整性
（**降级后不能丢字段** —— 期一卡片化时踩过这个坑）。

**桌面回归也要验**：`md` 以上任一页面观感变化即为改错（§1.3）。

## 12. 明确排除项（YAGNI）

- **`antd-mobile` 或任何新依赖** —— 底部 TabBar 手写 `<nav>` + CSS 即可，
  换组件库等于重写所有页面（沿用前置文档 §13 的判断）
- **原生手感**：下拉刷新 / 手势返回 / 页面转场动画 / 骨架屏过渡
- **JS 断点 hook**（`useBreakpoint` / `matchMedia`）—— 见 §3.1
- **第二个断点档** —— 全期只用 768 一个分界（§4.3）
- PWA / 添加到主屏 / 离线缓存
- 横屏专门适配
- 暗色模式（前置文档已排除，本期不变）
- e2e / 视觉回归测试框架 —— 见 §11

## 13. 关键决策速查

| 决策 | 选择 | 理由 |
| ---- | ---- | ---- |
| 定位 | **双端平权** | 桌面观感一行不退，移动端不再是「缩小的网页」 |
| 断点信号 | **纯 CSS 媒体查询** | SSR 下 JS 断点必然闪一帧；CSS 零闪烁零 hydration 风险 |
| 断点数量 | **只用 768 一个** | 多档断点维护成本高、收益极小 |
| 断点值 | 对齐 antd 六档 | UnoCSS 默认 640 与 antd 576 错位，混用会在 576-640px 跳变 |
| CSS 入口 | 新建手写 `responsive.css`，import 放最后 | `uno.gen.css` 是产物；`preflights.reset=false` 意味着现无入口 |
| 导航形态 | **底部 TabBar 4 项** | 理财 App 事实标准；1 次点击、全入口常驻；4 项在 320px 有 80px/格 |
| Table 处理 | **双渲染 + CSS 显隐** | 桌面那份 Table 一行不改，回归风险最低 |
| Card padding | 全局 CSS 覆盖 `.ant-card-body` | 不破 `SectionCard` 的「不透传 style」封装原则 |
| 新增依赖 | **零** | 沿用前置文档判断 |
| 新增 domain | **只有 `nav.ts`** | 高亮逻辑要被顶栏与底栏共用，抽出来才能单测 + 防漂移 |
| 自动化测试 | 只覆盖 `nav.ts`，其余靠人工清单 | 布局无法单测，不假装有覆盖 |
| 前置文档 | 4 处加取代标注，不原地改写 | 保留「曾定桌面为主、后来为何改」的决策史 |
