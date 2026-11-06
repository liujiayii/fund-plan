# 液态玻璃设计宪法（全站 UI 硬约束）

> 状态：2026-11-05 双主题修订。正式保留 **A 瓷白钴蓝（ceramic）** 与
> **B 墨蓝香槟（graphite）**，C 候选退役。默认跟随系统，用户可明确选择浅色或深色。
> 本次按已确认原型调整材料：A 内容面收掉硬亮边与浮雕，导航保留清透层次；
> B 保留烟晶玻璃与香槟高光。旧冰川单主题、紫色粒子背景与「禁止浅色」约定作废。
> 本文件进 git；候选原型与实施计划留在本地 `.superpowers/`。

本文约束材料、层级与性能。页面布局、交易流程与金融计算不由主题改动。

## 1. 身份与阅读优先级

| 主题 | 内容面 | 导航与弹层 | 背景 |
| --- | --- | --- | --- |
| A · 瓷白钴蓝 | 轻瓷面，高不透明底、低对比细边、柔影，无内浮雕与扫光 | 更清透的玻璃，借背景与滚动内容表达悬浮层次 | 冷白底、低浓度蓝色柔光与静态光带 |
| B · 墨蓝香槟 | 半透明烟晶，4–6px 轻模糊、细边与克制投影 | 烟晶导航，边缘少量香槟高光 | 墨蓝底、深海蓝光带与微弱暖反光 |

A 更接近内容与导航分层的 Liquid Glass：金额、持仓与表格先保证清楚，光学效果集中在导航。
B 沿用已确认原型的沉静玻璃感。两者共用布局、语义 token 与一份材料 CSS，不按主题复制页面。

国内涨跌语义保持涨红跌绿；品牌、选中、在途与涨跌各有独立 token。
主色不映射 antd 的 `colorSuccess` / `colorError`。

## 2. 材料层

全站光学材料只定义在 `app/styles/liquid-glass.css`。组件只挂 `.fp-glass`；
导航或弹层需要更清透时使用已有角色类或 `.fp-glass-chrome` 修饰。
主题差异只来自 `app/theme.ts` 的 palette，不在页面各写透明度、描边或模糊。

### 2.1 背景舞台

`BackdropStage` 在根布局只挂一份：固定满屏、`z-index: 0`、`aria-hidden`、
不接指针。壳层 `.fp-shell` 在其上；每页不得重复创建。

舞台由 **CSS 轻网格、静态柔光、SVG 光带与客户端粒子** 构成：

| token | 用途 |
| --- | --- |
| `bg` | 页面底 |
| `backdropGrid` | 68px 网格线；遮罩控制可见范围 |
| `backdropGlow` / `backdropGlowSecondary` | 两团低浓度径向柔光 |
| `ribbonStart` / `ribbonMiddle` / `ribbonEnd` | 光带渐变 |
| `ribbonEdge` / `ribbonShadow` | 光带细边与背面 |
| `particleA` / `particleB` / `particleC` | A 钴蓝/冷青、B 香槟/冰蓝粒子；主色同时供连线与悬停抓线 |

静态层颜色来自 CSS 变量；canvas 必须使用 `THEME_COLORS` 的实际色值，不能传入 `COLOR` 的变量引用。
SSR 只输出光带与空粒子容器，粒子引擎在客户端懒加载。保留 `tsparticles` 与
`tsparticles-engine` **精确 2.12.0**；升级前必须验证画布有实际像素，旧站 v3 曾无报错空画布。
粒子缓慢漂移、连线、悬停抓线与点击补粒子，交互监听在 window，装饰层不拦页面操作。
桌面 60、手机 30 的基础数量按视口密度调节，切后台自动暂停。`?noparticles=1` 只关闭粒子。
动态监听减少动态偏好：启用时立即撤下画布，恢复时重新创建。切主题只更新背景，页面不重挂。
异步加载串行处理最新主题；每轮独立宿主/id，取消立即移除宿主，返回后只销毁自己的容器，
不能全局销毁引擎中的所有实例。加载期间暂停播放，确认仍有效后才启动。
软边用径向渐变，**禁止全屏 `filter: blur()`** 与 SVG 折射滤镜。

### 2.2 内容面（`.fp-glass`）

| token | 材料属性 |
| --- | --- |
| `glassBase` / `glassTop` / `glassBottom` | 稳定底衬与极轻渐变 |
| `glassBorder` | 1px 低对比基础边 |
| `glassEdgeStart` / `glassEdgeMiddle` / `glassEdgeEnd` | 伪元素边缘渐变 |
| `glassRimOpacity` | 边缘渐变浓度，A 为 0 |
| `glassShadow` / `glassInsetShadow` | 完整 CSS 阴影值；A 内阴影用透明零阴影 |
| `glassBlur` | A 为 0px，B 为 4–6px |

A 的内容面明确关闭采样滤镜；导航与弹层由下一节重新启用自己的材料参数。
首屏没有主题属性时，以系统媒体查询同步选择材料行为；无 JS 的浅色也不扫光、不辉光。
B 保留轻模糊，不能恢复旧版整卡强白色内高光或粗浮雕。边缘渐变只是细节，不能比内容醒目。

基础边、底衬与阴影保留 `!important`，因为 antd 运行时样式可能晚于 CSS 文件插入，
其 `background` 简写会冲掉材料渐变。圆角、定位与尺寸不由 `.fp-glass` 写死。

消费方必须有定位上下文（`relative` / `sticky` / `fixed`）；描边伪元素不接指针。
常用角色圆角保持：卡片与弹窗 22px、侧栏 24px、下拉与图版 12px、
移动底抽屉顶角 22px、胶囊导航由壳布局定义。

### 2.3 导航、弹层与镜面高光

导航类 `.fp-sidebar` / `.fp-brandbar` / `.fp-tabbar` / `.fp-bottom-bar`
在同一材料层切换到 `chromeBase`、`chromeBlur`、`chromeShadow`、
`chromeBorder`、`chromeRimOpacity`。它们不复制另一份材料实现，也不扫光。

Modal、Drawer、Select 通过 `app/antd-popup-glass.ts` 的 **POPUP_GLASS semantic classNames**
把 `fp-glass fp-glass-chrome` 挂到官方面板节点。不追这些组件的内部面板类名。
Dropdown 缺少 popup 级 semantic 通道，保留 `.ant-dropdown .ant-dropdown-menu` 这一例外，
并消费相同 chrome token。Drawer placement 只负责圆角与贴边形状。

`.fp-glass-specular` 保留给总资产卡、登录门面、首页 hero：
A 不生成扫光；B 为低浓度、16 秒一轮的柔光。列表行、表格、表单、admin、
导航与抽屉内部禁止增加扫光。减弱动态时关闭，保留静态材料。

### 2.4 文字、数字与键盘

`textPrimary` / `textSecondary` / `textTertiary` / `textPlaceholder`
分别服务正文、次要信息、标签坐标、占位禁用；不能因切换主题改变语义。
`neutral` 表示零盈亏与无数据，`pending` 表示在途，均不借用涨跌色。

金额继续使用 Space Grotesk 与等宽数字；中文继续用系统字体。
数字禁止渐变填字，禁止所有金额铺外发光。既有总资产、当日涨跌强调位可保留极弱辉光，
A 关闭这类文字辉光，保证浅色阅读清楚。

antd 的说明、标签与 `Typography type="secondary"` 使用 `textSecondary`，
信息文字不能退成占位色。两套主题都要检查正文、次要文字、收益数字与坐标轴对比度。

手写导航与操作条必须保留 `:focus-visible`：主色 2px 轮廓、适当偏移。
不得用材料边缘替代键盘焦点反馈。

### 2.5 品牌与金融语义

`primary` / `primaryTo` / `primaryBg` 负责链接、选中、主图表序列与 CTA；
`onPrimary` 负责主色上的文字与图标，两套主题各自定义，不能写死白字或深字。
主 CTA 可以使用品牌实色渐变，次按钮使用内井与边框，不新增独立模糊节点。

涨、跌、在途分别使用 `up/down/pending` 及对应 `*Bg` 浅底。
antd 成功、失败继续保持组件自身语义。

### 2.6 内井、图版与小浮面

| token / 类 | 用途 |
| --- | --- |
| `well` | 一卡多格、表头、输入填充、行 hover 等内井 |
| `card` | 兼容既有内容面消费方；新内部小块优先用 `well` |
| `border` | 分割线、输入描边、表格行线 |
| `elevated` | Tooltip / Popover / G2 tooltip 与无滤镜降级的稳定底 |
| `mask` | Modal / Drawer 遮罩 |
| `.fp-plate` | 用 `plate`、`plateBorder`、`plateHighlight` 组成的扁图版 |

玻璃卡内部不再叠模糊。图版只装一整块理念图，不装表格、表单或卡片壳；
它不模糊、不加外投影，因此不计入玻璃预算。每页只用于同一类内容，
例如 `/plan` 的三张理念图。图版内部动效仍在 `motion.css`。

## 3. 层级

从底到顶：

1. `bg` 与唯一背景舞台（静态衬底和客户端粒子）。
2. 内容面：A 轻瓷面、B 烟晶卡；内部用内井或扁图版。
3. 导航：桌面侧栏、移动品牌胶囊、底部 Tab、固定操作条。
4. 浮层：Modal / Drawer / Dropdown / Select；小型 tooltip 用 `elevated`。

同一位置不叠超过两层玻璃。内容滚过导航时可以形成透射，但不能让背景纹理抢过金额。
任务页已有操作条时继续沿用隐藏底部 Tab 的壳逻辑，不增加第三层固定导航。

## 4. 用在哪与禁令

浮面继续挂 `.fp-glass`：SectionCard、分组壳、导航、固定操作条、登录容器、
首页 hero 与官方弹层。同一张卡里的并列小块用内井，不能每格单独起玻璃。

以下保持扁平：表格行与单元格、表头、表单内部、图表 canvas、代码与数字列、
长列表行、涨跌胶囊、状态 Tag、Tooltip / Popover / G2 tooltip。

禁止：

- 组件 TS/TSX 中出现 `backdrop-filter` / `backdrop-blur-*`，包括注释里的误用示例。
- 除 `liquid-glass.css` 外任何手写 CSS 定义光学采样材料。
- 每行描彩边、每卡扫光、页面各造一套背景或新增强调色。
- 除唯一舞台以外重复创建背景粒子；指针跟随反光、SVG 位移滤镜与全屏高斯软化。
- 裸色与裸阴影散入材料 CSS；颜色和阴影必须来自 `var(--fp-*)`。
- 用 `border-solid` 为单边补 style；应只补对应边的 style。
- 将 C 候选或旧单主题的固定颜色重新带回正式主题。

## 5. 动效

网格、柔光与光带保持静态；粒子只允许低速漂移及既有抓线/补粒子交互。
B 门面高光可运行，A 关闭；导航始终不扫光。
既有 `fade-up`、count-up、桌面 hover 轻抬与理念图编排保留原有职责，
禁止路由转场、数字闪烁、主按钮 scale、整页连续光效。

图版编排保持四条约束：进入视口只播一次；SSR 输出终态；
减少动态时直接终态；仅动 `opacity`、`transform`、`stroke-dashoffset`。
悬停微动使用 240ms 的内层缩放与 `stroke-opacity`，不与入场动画抢同一节点属性。

工具类动效在 UnoCSS animation theme，图版动效在 `motion.css`；
全站减动效关断在 `responsive.css`，材料扫光关断在 `liquid-glass.css`。
`prefers-reduced-motion: reduce` 下撤下粒子，仍保留静态背景、描边与可读内容。

## 6. 性能与降级

- 每个视口最多 **8 个**光学玻璃节点；A 的内容面已经停用采样，
  仍不能借此给列表每行增加材料。B 按侧栏/顶栏、可见卡、Tab、浮层合计预算。
- 首页 ≤ 8、`/me` ≤ 7、`/master` ≤ 6、基金详情 ≤ 8、后台 ≤ 4。
  一卡多格合并外壳，玻璃卡内部不叠玻璃。
- 背景的固定 SVG 与 CSS 渐变不使用全屏滤镜；粒子 canvas 全站最多一份，
  手机减少数量、失焦暂停、减少动态时撤下。引擎加载/渲染失败静默降级到静态衬底。
- 无 `backdrop-filter` 支持时，`.fp-glass` 与 Dropdown 统一退成
  `background: var(--fp-elevated)`，保持描边与内容可读，不用 JS 探测。
- 降级使用同文件的 `@supports not ((backdrop-filter: blur(1px)) or
  (-webkit-backdrop-filter: blur(1px)))`，必须覆盖导航修饰后的材料。

## 7. 与现有基建的关系

- 唯一实际色值出处为 `app/theme.ts` 的 `THEME_COLORS.ceramic/graphite`。
  `COLOR` 供普通 DOM/SVG 引用语义 CSS 变量；UnoCSS 从 palette 键输出 kebab-case
  `--fp-*` 变量。运行时主题、antd 算法与图表实际色板由主题基础设施统一切换。
- HTML 主题属性为 `data-theme="ceramic|graphite"`；默认跟随系统，显式偏好持久化。
  A 使用 antd 默认算法，B 使用暗色算法，不能把 CSS 变量字符串交给颜色派生算法。
- Card 保持透明容器背景与 22px 圆角，由材料 CSS 提供面；输入、表格等使用内井。
- UnoCSS 工具类优先，复杂材料与伪元素留在本文件对应的 CSS。
  `preflights.reset: false`、禁 attributify、不写自定义提取器等现有纪律不变。
- 样式顺序保持 reset → UnoCSS → 材料/背景 → podium/motion → responsive。
  `responsive.css` 在最后，确保减动效与尺寸覆盖有效。
- 字体、数字精度、数据库与金融计算不因主题变化而调整。

## 8. 验收（材料层）

1. A 内容卡无硬白亮边、无内浮雕、无扫光；导航和内容层次清楚。
2. B 保留烟晶、细边与低浓度香槟反光，收益文字、坐标轴与表格可读。
3. 全站只有一份背景；粒子有实际像素、主题三色正确，抓线/补粒子不阻塞页面交互。
   快速切主题、加载中切减少动态与卸载不残留画布，不误销毁新实例。
4. 守卫测试保证材料独占 CSS、全部主题变量存在、semantic 弹层通道与图版约束。
5. 390px 与 ≥1080px 检查导航、操作条、Modal/Drawer/Select，内容和交互不被遮挡。
6. 减弱动态时扫光关闭、粒子撤下，恢复后可重画；`?noparticles=1` 保留静态衬底。
   无滤镜时底衬与文字仍清楚；玻璃节点预算未超。
7. 键盘走遍主题入口、导航、弹层与操作条，焦点清晰。
8. `pnpm verify` 与必要的真实运行时检查通过，金融计算零改动。

## 9. 修改纪律

改变材料、主题身份、层级或禁令时，先修订本文件再调整代码。
纯页面编排与文案调整记入各自施工记录，不在这里堆砌历史。
若文件与旧本地施工计划冲突，以这份当前约定为准。
