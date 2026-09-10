# 液态玻璃设计宪法（全站 UI 硬约束）

> 状态：2026-09-10 与主理人确认；同日施工前自审第二版（对照代码补了 §2.1 色雾实现、
> §2.2 覆盖优先级、§2.6 内井 token、§3 操作条层级、§4 卖点卡预算、§6 节点预算表、§7 暗色算法）。
> 本文件进 git，是后续所有视觉改动的上位法。
> 页面施工 spec：`.superpowers/specs/2026-09-10-liquid-glass-redesign.md`（本地，不入库）。
> 前作 visual-refresh / visual-depth 的晨雾靛蓝身份作废；token 基建（`theme.ts` → uno → `--fp-*`）保留。

本文只回答一件事：**玻璃是什么、用在哪、绝不能用在哪。** 页面怎么排、导航怎么改，看施工 spec。

---

## 1. 身份一句话

**暗底夜盘 + 全站玻璃拟物。** 卡片、导航、按钮、抽屉、弹窗都是半透明冰块，压在缓慢漂移的色雾上。内容不「扁」——这是刻意选的左边那条路，不是 iOS 26/27 的铬玻璃。

iOS 铬玻璃（内容扁、玻璃只给系统栏）是**二期切换目标**，本期不做。切换成本见施工 spec §十二。

国内涨跌习惯保留：涨红跌绿，主色让给品牌紫粉，两套语义不准打架。

---

## 2. 材料层（唯一合法的玻璃）

全站只允许下面这一套。组件里禁止再发明第二种透明、第二种描边、第二种模糊。

### 2.1 舞台（页面底）

| token | 值 | 角色 |
| --- | --- | --- |
| `bg` | `#100E1C` | 深紫黑，页面底（2026-09-10 走查从 #07060C 提亮两档：纯黑底压出的玻璃像黑板，文字读不清） |
| `fogA` | `#6D4DFF` | 漂移色雾 · 紫 |
| `fogB` | `#FF3D8A` | 漂移色雾 · 粉 |
| `fogC` | `#39D6FF` | 漂移色雾 · 青（第三团，别再加第四） |

色雾是 **3 团、`mix-blend-mode: screen`、透明度 0.4、14s 缓动循环** 的固定定位层（`position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden`），挂在根布局，全站同一份，不按页复制。
`prefers-reduced-motion: reduce` 时色雾静止在初始位置，不删——删了玻璃就没衬底，会变成一块脏灰塑料。

实现纪律（性能，不是审美）：

- 每团是一个 `radial-gradient(closest-side, 色 0%, transparent 70%)` 的大圆（直径约 `60vmax`），软边靠渐变本身，**不用 `filter: blur()`**——三个全屏级元素每帧重算高斯模糊，低端安卓直接掉到个位数帧。
- 动画只动 `transform: translate(...)`（合成层属性），加 `will-change: transform`；不动 `left/top`、不动 `opacity`。
- 每团各自一条 keyframes、时长同 14s 但相位错开（`animation-delay` 负值），三团不会同步呼吸。
- 内容层（`main` / 侧栏 / 胶囊）在色雾之上（`position: relative; z-index: 1`），否则 `backdrop-filter` 透到的是页面底色而不是雾。

### 2.2 玻璃（`.fp-glass`）

所有「浮起来的面」都吃这一个类，禁止手写第二套 `backdrop-filter`。

```css
.fp-glass {
  /* 双层：上层白色高光渐变，下层半透明深紫底衬（2026-09-10 走查改）。
     只有白色渐变时卡片下半截压在黑底上是纯黑、压在雾上被雾染色，文字可读性随雾漂移；
     深紫底衬把内容面稳在可读的中间灰紫，雾仍从底下透，玻璃感靠模糊 + 高光脊 + 描边。
     ⚠️ 三条都带 !important：antd cssinjs 的样式标签在 SSR 时注入到 </head> 前、
     排在本文件的 <link> 之后（entry.server.tsx），同特异性下 .ant-card 的
     background 简写会把渐变冲成实色。responsive.css 盖 antd 内部类同此手法 */
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04)),
    rgba(34, 30, 56, 0.5) !important;
  backdrop-filter: blur(22px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(22px) saturate(180%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),  /* 顶边高光脊 */
    0 18px 40px rgba(0, 0, 0, 0.35) !important;
  /* 不写 border-radius、不写 position：圆角由角色决定（下表），定位由消费方
     自带（antd Card 是 relative，侧栏 sticky，胶囊 fixed）。曾写过
     border-radius: inherit——它会让 antd Card 继承父级的 0 圆角，删掉 */
}
/* 彩虹描边走伪元素，不走 border 色——border 会被模糊吃掉 */
.fp-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.70),
    rgba(180, 140, 255, 0.15) 40%,
    rgba(255, 80, 160, 0.45) 70%,
    rgba(255, 255, 255, 0.25)
  );
  /* 标准「只描边」mask；新代码复制这段，不要改角度或加第四色停 */
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

消费方必须自带定位上下文（`relative` / `sticky` / `fixed` 任一），伪元素 `inset: 0` + `border-radius: inherit` 天然贴合圆角，不需要 `overflow: hidden`；只有叠了 `.fp-glass-specular` 的门面才需要 `overflow: hidden`（扫光条会跑出去）。
圆角由角色决定，不写死在 `.fp-glass` 里：

| 角色 | 圆角 |
| --- | --- |
| 控件 / 按钮 / 输入 / 胶囊 Tab | 999px（胶囊）或 12px |
| 卡片 / 分组列表壳 | 22px |
| 桌面侧栏轨 | 24px |
| 弹窗 | 22px |
| 移动端底抽屉顶角 | `22px 22px 0 0` |

### 2.3 镜面高光（可选，仅门面）

`.fp-glass-specular` 在玻璃上叠一道 8s 一轮、峰值 10%、宽而柔的横向扫光（`mix-blend-mode: screen`，一轮里 45% 时间静止）。
**只允许**出现在：总资产卡、登录左屏、首页 hero——都是宽而矮的门面。
**导航铬（侧栏、胶囊 Tab）不扫光**：竖长的轨上扫光像扫码枪（2026-09-10 主人反馈），铬的质感靠描边 + 高光脊。
列表行、表格、表单、admin、抽屉内部 **禁止** 加高光——那是噪音。

### 2.4 文字与数字

| 角色 | token | 色 | 字体 |
| --- | --- | --- | --- |
| 主文字 | `textPrimary` | `#F7F4FF` | 系统栈（中文） |
| 次要文字 | `textSecondary` | `#CDC4FF` | 系统栈 |
| 三级文字（标签 / 坐标轴） | `textTertiary` | `#A39BCF` | 系统栈 |
| 占位 / 禁用 | `textPlaceholder` | `#7A7398` | 系统栈 |
| 平（0 盈亏 / 无数据） | `neutral` | `#A39BCF`（与三级文字同值，语义不同） | — |
| 数字 | — | `#F7F4FF` | `"Space Grotesk"` + `tabular-nums`（已有 `font-num`） |
| 涨 | `up` | `#FF5D8F` | 可加极弱 `text-shadow: 0 0 8px rgba(255,61,110,.55)`，仅强调位 |
| 跌 | `down` | `#39FFCE` | 同上，青辉光仅强调位 |
| 待办 / 在途 | `pending` | `#F0D078` | 第三语义，不跟涨跌混 |

antd 的 `colorTextDescription` / `colorTextLabel` 必须钉到 `textSecondary`：`Typography type="secondary"` 与 Card extra 走它，默认派生自三级色，暗底上整页副标题会糊成一片（2026-09-10 走查）。三级色只留给标签与坐标轴。

对比度底线（对玻璃内容面 ≈ `#2E2A48` 实测）：主文字 ≈ 12:1、次要 ≈ 8:1、三级 ≈ 5:1、占位 ≈ 3.2:1（占位不承载信息，允许）。

数字 **禁止** 用渐变填字、禁止外发光铺满所有金额。辉光只给总资产和当日涨跌两处。

键盘可达：手写的导航元素（侧栏项、胶囊 Tab 项、操作条）必须有 `:focus-visible` 环——`outline: 2px solid primary; outline-offset: 2px`。玻璃上没有默认 outline 色可依赖，不写就是不可达。

### 2.5 品牌色

| token | 值 | 用途 |
| --- | --- | --- |
| `primary` | `#7C5CFF` | 选中、链接、进度条、图表主序列 |
| `primaryTo` | `#FF3D6E` | 渐变终点；主 CTA 渐变 `90deg, primary → primaryTo` |
| `primaryBg` | `rgba(124, 92, 255, 0.22)` | 选中浅底（玻璃上的紫雾，不是实色块） |

主 CTA 可以是实色渐变药丸（BUY NOW 那种），次按钮必须是玻璃胶囊。
**主色绝不映射涨跌。** `colorSuccess` / `colorError` 继续保持 antd 原生语义。

### 2.6 内井、分割线与浅底（玻璃之内的扁材料）

玻璃卡**里面**不再模糊，用这几个实色/半透明 token 分层：

| token | 值 | 用途 |
| --- | --- | --- |
| `well` | `rgba(255, 255, 255, 0.06)` | 内井：表头、输入框填充、列表行 hover、侧栏选中底、签到条 |
| `card` | `rgba(255, 255, 255, 0.06)` | 与 `well` 同值。保留键名只为兼容既有 `bg-card` 消费方，新代码一律写 `well` |
| `border` | `rgba(255, 255, 255, 0.16)` | 分割线、输入框描边、表格行线 |
| `elevated` | `rgba(18, 14, 32, 0.92)` | **不透明浮面**：Tooltip / Popover / G2 tooltip / 降级玻璃。这些面积小、生命期短、常压在图表或文字上，模糊反而看不清 |
| `upBg` / `downBg` / `pendingBg` | 对应语义色 16% 透明 | 涨跌/待办胶囊浅底，日历格底 |
| 遮罩 | `rgba(7, 6, 12, 0.55)` | Modal / Drawer mask（antd `colorBgMask`） |

`well` 与 `border` 是纯白透明度，压在任何雾色上都成立——这就是为什么内井不需要按雾色调色。

---

## 3. 层级（谁在上、谁在下）

从底到顶，不许跳级、不许玻璃叠玻璃超过两层。

```
0  bg #100E1C
1  色雾三团（全站一份，pointer-events: none）
2  内容玻璃卡（.fp-glass）
3  导航铬：桌面侧栏 / 移动端胶囊 Tab / 顶栏 / 页底操作条（.fp-glass，一律不加 specular）
4  浮层：Drawer / Modal / Dropdown / Select 下拉（.fp-glass，遮罩 rgba(7,6,12,.55)）
4' 小浮面：Tooltip / Popover / G2 tooltip（elevated 实色，不模糊，见 §2.6）
```

antd 浮层挂在 portal 里，tsx 拿不到它的根节点，`.fp-glass` 材料由 `liquid-glass.css` 直接写在
`.ant-modal-content` / `.ant-drawer-content` / `.ant-dropdown-menu` / `.ant-select-dropdown` 上——
这是**唯一**允许在手写 CSS 里打 antd 内部类给玻璃的地方，tsx 里不准 `classNames={{ content: "fp-glass" }}`
之类各写一套。

**铁律：玻璃下面必须有东西可透。** 白玻璃压白底 = 塑料。色雾是最低衬底；图表、壁纸、持仓行从导航玻璃底下穿过去才算「看得见」。

禁止：

- 玻璃卡里再套一块同等模糊的玻璃卡（最多：外卡玻璃 + 内井 `rgba(255,255,255,.06)` 实色，内井不模糊）
- 给 Table / Form / 长列表的每一行单独上 `backdrop-filter`（性能自杀）
- SVG 折射滤镜（`feDisplacementMap` 等）——低端安卓和 workerd SSR 都会哭。本期用 blur + 高光脊 + 彩虹描边冒充，不引入滤镜图元

---

## 4. 用在哪 / 不用在哪

### 必须是玻璃

- 桌面侧栏轨
- 移动端底部胶囊 Tab、移动端顶部品牌胶囊
- 顶栏（若桌面保留顶区品牌条）
- 页底固定操作条（持仓详情 / 基金详情的买卖条）
- SectionCard / 分组列表壳
- 主次按钮（主 = 渐变实色药丸或玻璃药丸，次 = 玻璃胶囊）
- Modal / Drawer 面板、Dropdown / Select 下拉
- 登录右表单卡、首页 hero 内嵌卡
- 空态容器（指它所在的那张卡；空态自己不再单独起一层玻璃）

**同一张卡内的并列小块不各自上玻璃**：首页 4 张卖点卡、平台数据 6 格、总览四格——
这类「一卡多格」用**一张**玻璃壳 + 内井（`well`）分格。4 张卖点卡各自玻璃会把首页
推到 10+ 个模糊节点，直接撞破 §6 的预算。

### 必须是扁的（实色或透明，不模糊）

- 表格单元格、表头（表头用 `well` 井，不投影）
- 输入框内部（边框可以是玻璃描边，填充 `well` 不模糊）
- 图表画布（G2 仍吃 `chart-theme.ts`，不给 canvas 套 backdrop-filter）；图表骨架屏的
  闪光渐变改白色透明度（浅色那套 `rgba(0,0,0,.06)` 在暗底上是隐形的）
- Tooltip / Popover / G2 tooltip（`elevated` 实色）
- admin 密集表格
- 代码/数字等宽列
- 列表行、涨跌胶囊、状态 Tag（Tag 底用 antd 暗色算法派生，不手涂）

### 明确禁写

| 禁 | 为什么 |
| --- | --- |
| 彩虹描边出现在列表每一行 | 描边是铬的特权，行级会闪成圣诞树 |
| 色雾按页复制、每页颜色不同 | 身份靠「全站同一份雾」 |
| 第四团色雾 / 新的强调色 | 紫粉青已经是三原色，涨跌另算 |
| 浅色默认肤 | 本期身份是暗底；浅色是二期 iOS 切换的事 |
| `border-solid` 单边补 style | 老坑，四边 3px 隐形框 |
| 字面量色值（`text-[#xxx]`） | 一律主题类；色雾/描边的 rgba 只写在本文件对应的 CSS 类里 |

---

## 5. 动效

| token | 值 |
| --- | --- |
| `--fp-duration-fast` | 150ms |
| `--fp-duration-base` | 240ms |
| `--fp-duration-slow` | 360ms |
| `--fp-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| 色雾循环 | 14s ease-in-out infinite |
| 镜面高光 | 4.8s ease-in-out infinite |

允许：色雾漂移、门面高光扫过、卡片 hover 抬 2px（仅 `md:` 以上，触屏不加位移）、进场 `fade-up`、总资产 count-up（已有）。

禁止：路由切换转场、数字闪烁、主按钮 scale（会挤邻居）、全站每张卡都扫高光。

`prefers-reduced-motion: reduce`：色雾冻住、高光动画关、fade-up / count-up / hover 位移关。模糊和描边保留。

---

## 6. 性能与降级

`backdrop-filter` 在低端安卓上贵。规则：

1. **同一视口最多 8 个** 带 `backdrop-filter` 的节点。侧栏 1 + 可见卡片 ≤ 5 + Tab 1 + 浮层 1。长列表虚拟化或扁着画，不要给每行上滤镜。

   各页预算（施工时对着数，超了就把并列小块合成一卡）：

   | 页 | 壳（侧栏或顶+底胶囊） | 内容玻璃卡 | 合计 |
   | --- | --- | --- | --- |
   | `/` | 1–2 | hero 内嵌卡 1 + 示范盘 1 + 平台数据 1 + 排行榜引流 1 + 卖点 1 + 底 CTA 1 | ≤ 8 |
   | `/me` | 1–2 | 总览 1 + 签到 1（窄屏并入总览）+ 持仓 1 + tabs 1（+ 抽屉 1） | ≤ 7 |
   | `/master` | 1–2 | 总览 1 + 走势 1 + 日历 1 + tabs 1 | ≤ 6 |
   | `/funds/:code` | 1–2 + 操作条 1 | 头卡 1 + 图 1 + 数据卡 ≤ 3 | ≤ 8 |
   | `/admin*` | 1–2 | 统计 1 + 表 1 | ≤ 4 |

2. 侦测到 `backdrop-filter` 无效（老 WebView）时，`.fp-glass` 退化成 `background: var(--fp-elevated)`，描边保留，模糊去掉。用 `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` 写在 `liquid-glass.css` 同文件里，不要 JS 探测、不要第二个类名。
3. 图表、canvas、大量数字滚动的区域，背后不要再叠一层模糊卡。
4. `backdrop-filter` 压在**动态**背景（色雾）上意味着每帧重采样。这就是预算 8 的来源：静态背景可以放宽，动态背景不行。

---

## 7. 与现有基建的关系

- **唯一色值出处仍是 `app/theme.ts`。** 本文件的 hex 是规范，落地时抄进 `COLOR`，uno 映射自动跟进。不准在组件里写第二份。
- Uno 工具类优先；`.fp-glass` / `.fp-glass-specular` / 色雾层 是少数必须手写的 CSS，放 `app/styles/liquid-glass.css`，在 `root.tsx` 里排在 `uno.gen.css` 之后、`responsive.css` 之前。
- 不启用 `presetAttributify`，不写自定义提取器，`preflights.reset: false` 保持。
- antd 切 **`theme.darkAlgorithm`**（root.tsx 引；`theme.ts` 仍零 import）。默认算法在暗底上派生的是白容器、浅灰边、深字——每个组件都要手改，改不完。暗色算法把 Tag / Alert / Table / Segmented / Dropdown 的中性色一次派生对，`ANTD_TOKEN` 只钉品牌与材料：
  - seed：`colorPrimary` `colorInfo` = `primary`；`colorBgLayout` = `bg`；`colorBgBase` = `bg`（暗色算法从它派生全部中性面）；`colorTextBase` = `textPrimary`；`borderRadius` 12；`controlHeight` 36
  - 材料：`colorBgContainer` = `well`（输入框 / Segmented / Table 表体填充）；`colorBgElevated` = `elevated`（Tooltip / Popover / Dropdown 底，Dropdown 与 Modal 再由 CSS 盖成玻璃）；`colorBorder` / `colorBorderSecondary` / `colorSplit` = `border`；`colorBgMask` = 遮罩
  - Card：`colorBgContainer: "transparent"`（玻璃渐变要透出来）、`borderRadiusLG: 22`
  - `colorSuccess` / `colorError` **仍不写**，涨跌不映射
  - smoke 测试钉：`colorPrimary === COLOR.primary`、`colorSuccess`/`colorError` 未定义、`Card.colorBgContainer === "transparent"`
- Space Grotesk 继续只覆盖数字。中文系统栈。不引新字体。
- Logo 图形语言可留（净值曲线），填充改吃新渐变。favicon 同步。

---

## 8. 验收（材料层）

1. 任意内页截图，都能看见同一份紫粉青色雾从卡片底下透出来。
2. grep 组件源码，`backdrop-filter` / `backdrop-blur-*` 只出现在 `liquid-glass.css`（和降级块），不出现在 tsx——由 `tests/domain/liquid-glass-guard.test.ts` 钉死（扫 `app/**/*.tsx`），不靠人眼。
3. 一张持仓卡里没有第二层 `backdrop-filter`。
4. `prefers-reduced-motion` 下色雾静止、高光不跑，页面仍是暗底玻璃，不是突然变扁。
5. 390 宽：胶囊 Tab 压在内容上，内容从玻璃里透出来；桌面 ≥1080：侧栏轨同理。
6. 每页视口内带 `backdrop-filter` 的节点数 ≤ 8（§6 预算表逐页数）。
7. Tab 键走一遍侧栏 / 胶囊 / 操作条，每一站都有可见的 focus 环。
8. `pnpm verify` 全绿；金融计算零改动。

---

## 9. 谁可以改这份文件

改材料（色、模糊半径、描边、层级、禁令）= 改宪法，必须先改本文件再动代码。
改某页怎么排、某按钮文案、导航有几项 = 改施工 spec，不必动本文件。
发现本文件和施工 spec 打架，以本文件为准。
