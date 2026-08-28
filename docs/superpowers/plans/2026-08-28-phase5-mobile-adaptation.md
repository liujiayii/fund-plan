# 期五 · 移动端适配 实施计划

> ## 状态：已施工 · 2026-08-28
>
> 实现区间 `80850fb..8cb7add`（11 个 Task commit + 终审修正波 `8cb7add`）
>
> - **下方复选框全部未勾，但工作已完成。** 本计划按 commit 跟踪进度，不靠勾选框。
>   别把「未勾」读成「未做」，勿照此重新施工。
> - 逐 Task 台账与终审记录在 `.superpowers/sdd/2026-08-28-phase5-mobile-adaptation/`（git-ignored）。
> - ⏳ **未完：`browser-checklist.md` 的人工验收尚未走过**（三档视口 320/375/390 + 桌面回归对照），
>   这是本期唯一剩下的活，勾选权在主人。
> - ⚠️ 施工中有三处对计划文本的必要修正（均有台账裁定）：Task 5 的 CSS 需 `!important` 压 inline、
>   Task 11 选择器收窄为 `> div:last-child`、日历窄屏值从 inline 下沉 CSS（终审修正波）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单一断点 768px 下让全站在 320~375px 视口不溢出、能用、体面；桌面观感零回归（唯一豁免：SellPanel 表移出 Alert，属既有缺陷两端同修）。

**Architecture:** 纯 CSS 媒体查询承载全部窄屏样式（新建手写 `app/styles/responsive.css`，import 排在 `uno.gen.css` 之后），结构必须不同的三处走双渲染 + `.mobile-only`/`.desktop-only` 显隐；导航高亮逻辑抽成 `app/domain/nav.ts` 纯函数（本期唯一 domain 新增，顶栏底栏共用防漂移）。

**Tech Stack:** React Router 8 framework mode + antd v6 + UnoCSS CLI 预生成（presetWind4）+ Vitest（node 领域层）。

**Spec:** `docs/superpowers/specs/2026-08-28-phase5-mobile-adaptation-design.md`

## Global Constraints

- **零新增依赖。** 不装 `antd-mobile`、不装 e2e 框架（spec §12）。
- **主断点唯一：`max-width: 767px`**（antd `md`=768 以下为移动端，spec §4.3）。所有窄屏 CSS 写进 `responsive.css`，**不许在组件里散写 `@media`**（spec §4.4）。
- **桌面零回归**（spec §1.3）：`md` 以上观感不得退化。唯一豁免是 Task 7 的 SellPanel 表移出 Alert。
- **包管理器必须用 pnpm**；测试分两套配置，跑单文件**不加 `--`**（CLAUDE.md）。
- **一个 Task 一个 commit**；code review 修正用 `--amend` 并回该 Task 的 commit（CLAUDE.md）。
- 精度铁律不涉及（本期不动任何金额计算）；`FundListItem` 等组件改动**只动布局，不动信息**——期一卡片化踩过「降级丢字段」的坑，降级视图的每个字段都要在（spec §11）。
- 改了 class 后样式没生效，先跑 `pnpm uno:build`（CLAUDE.md）；**但本期全部样式走 `responsive.css` 手写 CSS，不依赖 uno 生成**。
- `app/uno.gen.css` 是产物**不要手改**；`theme.ts` 刻意零 import（node 单测要引它，别往里加 antd）。

---

### Task 1: 地基 —— 断点对齐 + responsive.css 建档 + Content padding

**Files:**
- Modify: `uno.config.ts:61-68`（theme 块）
- Create: `app/styles/responsive.css`
- Modify: `app/root.tsx:24-25`（import 区）、`app/root.tsx:185-191`（Content）

**Interfaces:**
- Consumes: 无（第一个 Task）
- Produces: `responsive.css` 及其中三个全局类名——`.fp-mobile`（`@media (max-width:767px)` 内才显示）、`.fp-desktop`（窄屏隐藏）、`.fp-h-scroll`（横向滚动容器）——Task 4/5/6/7/9/10 依赖这些名字。命名统一带 `fp-` 前缀，避免与 antd 类撞车。

- [ ] **Step 1: `uno.config.ts` 断点对齐 antd**

`theme:` 块（当前只有 `colors`）改为：

```ts
  theme: {
    colors: {
      // 同上：唯一出处是 app/theme.ts，这里不再复制字面量
      primary: COLOR.primary,
      rise: COLOR.up,
      fall: COLOR.down,
    },
    /**
     * 断点显式对齐 antd 栅格（responsiveObserver：xs 480 / sm 576 / md 768 /
     * lg 992 / xl 1200 / xxl 1600）。presetWind4 默认走 Tailwind v4 的
     * sm 640 / md 768 / lg 1024，与 antd 只有 md 撞对——混用 Col sm={12}
     * （576）与 sm:xxx 类（640）会在 576~640px 出现两套断点错位跳变。
     *
     * ⚠️ 键名是单数 breakpoint（Wind4 对齐 Tailwind v4 --breakpoint-* 变量），
     * 写复数 breakpoints 会静默无效。本项目当前不使用断点变体类
     * （媒体查询全在手写 responsive.css），此项是防御性对齐：
     * 挡住将来有人顺手写 md:p-3 时与 antd 栅格错位。
     */
    breakpoint: {
      xs: "480px",
      sm: "576px",
      md: "768px",
      lg: "992px",
      xl: "1200px",
      xxl: "1600px",
    },
  },
```

- [ ] **Step 2: 跑 `pnpm uno:build` 确认产物正常**

Run: `pnpm uno:build`
Expected: 生成 `app/uno.gen.css` 无报错（产物可能无变化——没用到断点类，正常）。

- [ ] **Step 3: 新建 `app/styles/responsive.css`**

```css
/**
 * 期五 · 移动端适配的唯一媒体查询出处（spec §4.4）。
 *
 * ⚠️ 全部规则包在 max-width: 767px 里（antd md=768 以下为移动端），
 * 桌面零回归是本期硬门槛。**不要在组件里散写 @media** ——
 * 「窄屏长什么样」只认这一个文件。
 *
 * 为什么是手写 CSS 文件而不是 UnoCSS 断点变体类：
 *  - uno.gen.css 是 pnpm uno:build 的纯产物，手改必被覆盖；
 *  - preflights.reset=false 意味着 UnoCSS 不产出任何全局样式；
 *  - uno.config.ts 的自定义 extractor 只认 className="静态字符串"，
 *    条件拼接的 className 提取不到（spec §4.4）。
 *
 * import 顺序（root.tsx）：antd reset → uno.gen.css → 本文件。
 * 排最后才能覆盖工具类与 antd 组件类。
 */

/* ══════════ 1. 全局基线（spec §5）══════════ */

@media (max-width: 767px) {
  /* Content padding 24→12：所有溢出的放大器（spec §5.1）。
     底部 56px 给 TabBar + 安全区 + 16px 呼吸（Task 4 落 TabBar 后生效） */
  .fp-content {
    padding: 12px 12px calc(56px + env(safe-area-inset-bottom) + 16px) !important;
  }

  /* Card body 24→16（spec §5.2）。全局覆盖 .ant-card-body 而非改
     SectionCard 的 props —— SectionCard 刻意不透传 style/styles，
     那个封装不开口子；token 又无法只按视口生效。
     ⚠️ !important：antd cssinjs 运行时注入的优先级更高，不加盖不住 */
  .ant-card-body {
    padding: 16px !important;
  }

  /* ══════════ 2. 显隐工具类（spec §7.1）══════════ */

  .fp-desktop {
    display: none !important;
  }

  /* ══════════ 3. 通用滚动容器 ═══════════ */

  /* Segmented / Pagination 等不换行不滚动的组件套这层（spec §9） */
  .fp-h-scroll {
    overflow-x: auto;
    /* 隐藏滚动条但保留滚动能力；Firefox 走 scrollbar-width */
    scrollbar-width: none;
  }
  .fp-h-scroll::-webkit-scrollbar {
    display: none;
  }
}

/* 767px 以下隐藏、以上恢复 —— 用属性选择器把 specificity 抬过
   UnoCSS/antd 的 display 工具类（配合 .fp-desktop 的 !important 成对使用） */
@media (min-width: 768px) {
  .fp-mobile {
    display: none;
  }
}
```

- [ ] **Step 4: `root.tsx` 接入 CSS 与 Content 类名**

import 区（`import "./uno.gen.css";` 之后）加：

```ts
// 期五移动端适配：唯一的媒体查询出处，必须排在 uno.gen.css 之后
// 才能覆盖工具类与 antd 组件类（顺序理由见该文件头注释）
import "./styles/responsive.css";
```

Content 改为：

```tsx
        <Content
          className="fp-content"
          style={{
            padding: "24px 24px 48px",
            maxWidth: 1120,
            margin: "0 auto",
            width: "100%",
          }}
        >
```

> `style` 留着当桌面态，窄屏由 `.fp-content` 的 `!important` 覆盖——**零 JS**。

- [ ] **Step 5: 验证**

Run: `pnpm verify`
Expected: lint + typecheck + 领域测试全绿（CSS 不进测试，跑通即证没弄坏链路）。

Run: `pnpm dev` 后浏览器 DevTools 切 iPhone SE (375px)：
- Content 左右 padding 变 12、Card body 变 16
- 桌面 (≥768px) 观感与改动前一致

- [ ] **Step 6: Commit**

```bash
git add uno.config.ts app/styles/responsive.css app/root.tsx app/uno.gen.css
git commit -m "feat(mobile): 响应式地基——断点对齐 antd + responsive.css + 全局 padding 基线"
```

---

### Task 2: `nav.ts` 纯函数 + TDD 单测（本期唯一 domain 新增）

**Files:**
- Create: `app/domain/nav.ts`
- Test: `tests/domain/nav.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `resolveSelectedKey(pathname: string, items: readonly { key: string }[]): string` 与 `NAV_ITEMS` 常量（含 5 项：`/`、`/master`、`/funds`、`/me/watchlist`、`/me`，从 `root.tsx` 迁来）。Task 3（顶栏）与 Task 4（底栏）都 import 这两个。

- [ ] **Step 1: 写失败测试**

```ts
// tests/domain/nav.test.ts
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";

/**
 * 导航高亮 —— 顶栏 Menu 与移动端底部 TabBar 共用（spec §6.4）。
 *
 * 顺序陷阱是这里唯一要钉死的东西：NAV_ITEMS 里 /me/watchlist 必须排在
 * /me 之前，startsWith 会先命中前者。这个测试存在的意义就是
 * 「以后谁调顺序谁红」，而不是指望读代码的人记得那条注释。
 */
describe("resolveSelectedKey", () => {
  it("根路径命中「首页」", () => {
    expect(resolveSelectedKey("/", NAV_ITEMS)).toBe("/");
  });

  it("非根路径的精确前缀命中", () => {
    expect(resolveSelectedKey("/funds", NAV_ITEMS)).toBe("/funds");
    expect(resolveSelectedKey("/funds/000001", NAV_ITEMS)).toBe("/funds");
    expect(resolveSelectedKey("/master", NAV_ITEMS)).toBe("/master");
  });

  it("深层路径命中最近的导航前缀", () => {
    expect(resolveSelectedKey("/me/orders", NAV_ITEMS)).toBe("/me");
    expect(resolveSelectedKey("/me/holdings/000001", NAV_ITEMS)).toBe("/me");
  });

  it("自选页高亮「自选」而非「我的」—— 顺序陷阱", () => {
    // /me/watchlist 同时是 /me/watchlist 与 /me 的前缀，
    // startsWith 按数组顺序取首个命中，所以 watchlist 必须排在 me 前
    expect(resolveSelectedKey("/me/watchlist", NAV_ITEMS)).toBe("/me/watchlist");
  });

  it("NAV_ITEMS 里 /me/watchlist 排在 /me 之前 —— 调换顺序这个断言就红", () => {
    const watchlistIdx = NAV_ITEMS.findIndex(i => i.key === "/me/watchlist");
    const meIdx = NAV_ITEMS.findIndex(i => i.key === "/me");
    expect(watchlistIdx).toBeGreaterThan(-1);
    expect(meIdx).toBeGreaterThan(-1);
    expect(watchlistIdx).toBeLessThan(meIdx);
  });

  it("不命中任何导航项时返回空串（不高亮）", () => {
    expect(resolveSelectedKey("/login", NAV_ITEMS)).toBe("");
    expect(resolveSelectedKey("/register", NAV_ITEMS)).toBe("");
    expect(resolveSelectedKey("/logout", NAV_ITEMS)).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/domain/nav.test.ts`
Expected: FAIL，报 `Cannot find module "~/domain/nav"` 或等价的模块不存在错误。

- [ ] **Step 3: 最小实现**

```ts
// app/domain/nav.ts
/**
 * 导航高亮 —— 顶栏 Menu 与移动端底部 TabBar 共用的纯函数（spec §6.4）。
 *
 * 为什么放 domain：两处消费同一份逻辑，逐字复制会重演
 * PortfolioView/me._index 那次「两份独立漂移」（期十三收掉的坑）。
 * 抽成纯函数才能 node 单测 + 把顺序陷阱钉进测试。
 *
 * ⚠️ NAV_ITEMS 的顺序是接口的一部分：/me/watchlist 必须排在 /me 之前 ——
 * startsWith 按数组顺序取首个命中，调换会让自选页高亮成「我的」。
 * tests/domain/nav.test.ts 钉着这条，谁调谁红。
 */

export interface NavItem {
  /** 路由前缀，如 /me */
  key: string;
  /** 展示文案 */
  label: string;
}

/** 一级导航项。⚠️ 顺序敏感，见文件头注释 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "/", label: "首页" },
  { key: "/master", label: "主理人的盘" },
  { key: "/funds", label: "基金" },
  { key: "/me/watchlist", label: "自选" },
  { key: "/me", label: "我的" },
];

/**
 * 由 pathname 解析当前高亮的导航 key。
 * 规则：非根项按 startsWith 取数组顺序首个命中；全是前缀不命中时，
 * 根路径("/") 命中「首页」，否则返回空串（不高亮）。
 */
export function resolveSelectedKey(
  pathname: string,
  items: readonly NavItem[],
): string {
  return (
    items
      .filter(i => i.key !== "/" && pathname.startsWith(i.key))
      .map(i => i.key)
      .at(0) ?? (pathname === "/" ? "/" : "")
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/domain/nav.test.ts`
Expected: PASS（7 个用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add app/domain/nav.ts tests/domain/nav.test.ts
git commit -m "feat(mobile): nav.ts 导航高亮纯函数 + 顺序陷阱单测（顶栏/底栏共用）"
```

---

### Task 3: 顶栏窄屏退化 + 消费 nav.ts

**Files:**
- Modify: `app/root.tsx:40-49`（NAV_ITEMS 定义改 import）、`:81-84`（selectedKey）、`:101-133`（Header 区）

**Interfaces:**
- Consumes: `NAV_ITEMS`、`resolveSelectedKey`（Task 2）；`.fp-desktop`（Task 1，隐藏 Menu 用）
- Produces: 无（MobileTabBar 是 Task 4 的事，本 Task 顶栏只做窄屏退化）

- [ ] **Step 1: 改 root.tsx 用 nav.ts**

删掉本地 `NAV_ITEMS` 常量与 `selectedKey` 计算，改为：

```ts
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";
```

（放在 `import { getAppContext } from "~/services/context";` 附近。）

组件内：

```tsx
  // 高亮当前所在的一级导航（顶栏与底部 TabBar 共用同一份纯函数）
  const selectedKey = resolveSelectedKey(location.pathname, NAV_ITEMS);
```

- [ ] **Step 2: Menu 包 `.fp-desktop`**

把 `<Menu …>` 整块包进 `<div className="fp-desktop" style={{ flex: 1, minWidth: 0 }}>…</div>`，Menu 自身的 `style` 去掉 `flex: 1`（挪到包裹层），保留 `minWidth: 0` 与 `borderBottom: "none"`：

```tsx
          {/* 桌面顶栏导航。窄屏整体隐藏（display:none），职责移交底部 TabBar ——
              用 CSS 隐藏而非条件渲染：条件渲染需要 JS 断点，SSR 下必闪一帧（spec §6.2）。
              隐藏的 DOM 还在，代价是几个 <li>，可接受 */}
          <div className="fp-desktop" style={{ flex: 1, minWidth: 0 }}>
            <Menu
              mode="horizontal"
              selectedKeys={selectedKey ? [selectedKey] : []}
              items={NAV_ITEMS.map(i => ({
                key: i.key,
                label: <a href={i.key}>{i.label}</a>,
              }))}
              style={{ minWidth: 0, borderBottom: "none" }}
            />
          </div>
```

- [ ] **Step 3: logo 缩小**

logo `<a>` 的 `fontSize: 18` 改成 `fontSize: "clamp(16px, 4vw, 18px)"`——窄屏 16、桌面 18，纯 CSS 无 JS。

- [ ] **Step 4: 验证**

Run: `pnpm verify`
Expected: 全绿。

浏览器 375px：顶栏只剩 logo + 登录态，无横向滚动条；768px 以上：Menu 回归原样。

- [ ] **Step 5: Commit**

```bash
git add app/root.tsx
git commit -m "feat(mobile): 顶栏窄屏退化——Menu 移交底栏、logo clamp 缩字"
```

---

### Task 4: MobileTabBar 组件 + 挂载

**Files:**
- Create: `app/components/MobileTabBar.tsx`
- Modify: `app/root.tsx`（`</Content>` 之后挂载）
- Modify: `app/styles/responsive.css`（追加 TabBar 样式块）

**Interfaces:**
- Consumes: `NAV_ITEMS`、`resolveSelectedKey`（Task 2）；`.fp-mobile`（Task 1）
- Produces: `<MobileTabBar />` 无 props（内部读 location）。图标：`HomeOutlined`、`FundOutlined`、`StarOutlined`、`UserOutlined`（均来自已装的 `@ant-design/icons`）。

- [ ] **Step 1: 追加 TabBar 样式到 `responsive.css`**

在文件末尾（`min-width: 768px` 块**之前**或之后均可，但注释要挨着）追加：

```css
/* ══════════ 4. 底部 TabBar（spec §6）══════════ */

/* 窄屏常驻、768px+ 由 .fp-mobile 隐藏（规则在本文件末尾） */
.fp-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  background: #fff; /* = COLOR.card，但不引 JS，手写同值；改主题时两处同改 */
  border-top: 1px solid #eef0f4; /* = COLOR.border */
  /* iPhone 底部安全区：没这行最后一格标签被系统横条压住 */
  padding-bottom: env(safe-area-inset-bottom);
}

.fp-tabbar-item {
  /* 4 项均分：320px ÷ 4 = 80px/格（spec §6.1 的数字依据） */
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 0 4px;
  min-height: 48px; /* 触控区 ≥44px（WCAG）：图标 22 + gap 2 + 标签 14 + padding */
  color: #8a9099; /* = COLOR.textSecondary */
  text-decoration: none;
  font-size: 12px;
  line-height: 1;
}

.fp-tabbar-item.active {
  color: #1677ff; /* = COLOR.primary */
  font-weight: 500;
}

.fp-tabbar-item .anticon {
  font-size: 22px;
}
```

> ⚠️ 色值手写字面量的理由：CSS 文件 import 不进 JS 模块图，引 `COLOR` 只能靠构建期工具（postcss-import + JS 变量），为一个文件引构建链不值。**代价写进注释：改 `theme.ts` 的色值时这 4 处要同改。**

- [ ] **Step 2: 写 `MobileTabBar.tsx`**

```tsx
import {
  FundOutlined,
  HomeOutlined,
  StarOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { NAV_ITEMS, resolveSelectedKey } from "~/domain/nav";

/**
 * 移动端底部导航栏（spec §6）。
 *
 * ⚠️ 只放 4 项：首页/基金/自选/我的。「主理人的盘」不进底栏 ——
 * 首页已有它的引流卡片入口，320px÷5=64px/格会挤到贴边（spec §6.1）。
 * NAV_ITEMS 里的 master 项由 TABS 显式挑选，顶栏仍消费完整 NAV_ITEMS。
 *
 * 手写 <nav> 而非 antd 组件：TabBar 只需要 4 个链接 + active 态，
 * antd 没有对应组件（TabBar/BottomNavigation 都不在 antd 里），
 * 这正是「零新增依赖」约束下的自然解（spec §12）。
 */
const TABS: { key: string; label: string; icon: ReactNode }[] = [
  { key: "/", label: "首页", icon: <HomeOutlined /> },
  { key: "/funds", label: "基金", icon: <FundOutlined /> },
  { key: "/me/watchlist", label: "自选", icon: <StarOutlined /> },
  { key: "/me", label: "我的", icon: <UserOutlined /> },
];

export function MobileTabBar() {
  const location = useLocation();
  const selectedKey = resolveSelectedKey(location.pathname, NAV_ITEMS);

  return (
    <nav className="fp-tabbar fp-mobile" aria-label="主导航">
      {TABS.map(t => (
        <a
          key={t.key}
          href={t.key}
          className={`fp-tabbar-item${selectedKey === t.key ? " active" : ""}`}
          aria-current={selectedKey === t.key ? "page" : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: root.tsx 挂载**

`</Content>` 之后、`<DefaultFooter …>` 之前插入：

```tsx
        {/* 移动端底部导航（768px 以下显示）。放 Content 外保证 fixed 定位不受内容影响 */}
        <MobileTabBar />
```

import 区加 `import { MobileTabBar } from "~/components/MobileTabBar";`。

- [ ] **Step 4: 验证**

Run: `pnpm verify`
Expected: 全绿。

浏览器 375px：底栏 4 格常驻、当前页高亮蓝、点按可跳转、内容不被遮挡（Task 1 的 padding-bottom 已让位）；`/me/watchlist` 高亮「自选」不是「我的」。768px+：底栏消失，Menu 回归。

- [ ] **Step 5: Commit**

```bash
git add app/components/MobileTabBar.tsx app/root.tsx app/styles/responsive.css
git commit -m "feat(mobile): 底部 TabBar 4 项——手写 nav + 安全区 + 高亮共用 nav.ts"
```

---

### Task 5: FundListItem 窄屏两段式 + OrderList 副值可折

**Files:**
- Modify: `app/components/ui/FundListItem.tsx:58-107`
- Modify: `app/components/OrderList.tsx:100-116`（secondary 副值）
- Modify: `app/styles/responsive.css`（追加行内样式覆盖块）

**Interfaces:**
- Consumes: 无新接口
- Produces: FundListItem 的 DOM 结构新增 `fp-fli` 根类名 + `fp-fli-main`/`fp-fli-side` 两个子类名（Task 10 的 me.watchlist 无需感知——actions 仍走原 props；窄屏布局全在 CSS）。

- [ ] **Step 1: FundListItem 加结构类名，去掉 nowrap**

根 div 加 `className="fp-fli"`；左侧块加 `className="fp-fli-main"`；右侧数值块加 `className="fp-fli-side"`。**去掉 `:97` 的 `whiteSpace: "nowrap"`**（OrderList 长串顶穿整页的根因，spec §8）：

```tsx
      {/* 右侧：主副数值。桌面仍不折行（金额断行难看），窄屏由
          responsive.css 的 .fp-fli-side 改竖排并允许收缩 */}
      {(primary !== undefined || secondary !== undefined) && (
        <div className="fp-fli-side" style={{ textAlign: "right" }}>
          {primary !== undefined && <div>{primary}</div>}
          {secondary !== undefined && <div style={{ marginTop: 2 }}>{secondary}</div>}
        </div>
      )}
```

- [ ] **Step 2: responsive.css 追加两段式布局**

```css
/* ══════════ 5. FundListItem 窄屏两段式（spec §8）══════════ */

@media (max-width: 767px) {
  /* 名称占第一行（不再被右侧 nowrap 挤到 50px），数值+操作第二行 */
  .fp-fli {
    flex-wrap: wrap;
    gap: 8px;
    /* 两段各自独占一行：main 撑满换行，side 随后另起一行右对齐 */
  }
  .fp-fli-main {
    flex: 1 1 100%;
    min-width: 0;
  }
  .fp-fli-side {
    /* 允许收缩：OrderList 的长副值（380px）能折行而不是顶穿页面 */
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
}
```

- [ ] **Step 3: OrderList 副值去掉隐式 nowrap 依赖**

`OrderList.tsx:103` 的 secondary span 已无 nowrap 容器（Step 1 去掉了），但长串里 ` · ` 分隔的文本在窄屏靠 `overflow-wrap: anywhere` 才能断。**不需要改 OrderList 代码**——只确认 Step 1/2 生效后，375px 下 `/master` 交易记录 tab 与 `/me/holdings/:code` 该基金交易不再出现整页横向滚动条。

若验证时发现 Tag 行（note 里的 `<span>{placeDate} 下单 · 确认日 {confirmDate}</span>`）仍溢出：给 note 的 span 加 `style={{ overflowWrap: "anywhere" }}`。

- [ ] **Step 4: 验证（5 个消费页都要看）**

Run: `pnpm verify`
Expected: 全绿。

浏览器 375px 逐页检查（spec §11 的高风险项）：
- `/me/holdings`：名称一行、市值+盈亏第二行
- `/me/orders`、`/master` 交易记录 tab：长成交明细串**折行**显示、无横滚
- `/me/dca`：金额到 4 位数也不溢出
- `/funds`：列表正常
- `/me/watchlist`：名称不再被挤成 3 字一行
- 768px+：五页观感与改动前一致（nowrap 由 `whiteSpace` inline 保留？——否，Step 1 删了 inline nowrap，**桌面也失去 nowrap**。用 `@media (min-width:768px){ .fp-fli-side{ white-space: nowrap } }` 补回，见 Step 2 补丁）

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/FundListItem.tsx app/components/OrderList.tsx app/styles/responsive.css
git commit -m "feat(mobile): FundListItem 窄屏两段式 + OrderList 长副值可折行"
```

---

### Task 6: 三页共用的 PortfolioSummary 窄屏栅格

**Files:**
- Modify: `app/components/PortfolioView.tsx:39-81`（Row/Col）

**Interfaces:**
- Consumes: antd `Row`/`Col` 的 `xs` prop
- Produces: 无（纯布局调整，props 不变）

- [ ] **Step 1: Col 断点改 24**

`PortfolioSummary` 的 Row 改：

```tsx
    <Row gutter={[24, 16]}>
      <Col xs={24} sm={12} md={6}>
        <StatBig label="总资产" value={fmtYuan(summary.totalAssetCents)} suffix="元" />
      </Col>
      <Col xs={24} sm={12} md={6}>
        <StatBig label="持仓市值" value={fmtYuan(summary.marketValueCents)} suffix="元" size={24} />
      </Col>
      {showCash && (
        <Col xs={24} sm={12} md={6}>
          <StatBig label="可用现金" value={fmtYuan(summary.cashCents)} suffix="元" size={24} />
        </Col>
      )}
      <Col xs={24} sm={12} md={6}>
        <StatBig
          label="浮动盈亏"
          value={`${summary.totalPnlCents > 0 ? "+" : ""}${fmtYuan(summary.totalPnlCents)}`}
          suffix="元"
          size={24}
          color={pnlColor(summary.totalPnlCents)}
          extra={(
            <>
              收益率
              {" "}
              <PnlText rate={summary.totalPnlRate} size={12} />
            </>
          )}
        />
      </Col>
    </Row>
```

> `sm={12}`（576~767px）给平板竖屏留两列——比全降一列省高度；`md` 及以上与现状（`xs={12} md={6}` 的桌面效果）完全一致。

- [ ] **Step 2: StatBig 数值行可收缩**

`app/components/ui/StatBig.tsx:44-51` 数值行 div 加 `minWidth: 0`，值 span 加 `overflowWrap: "break-word"`：

```tsx
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: size,
            fontFamily: NUM_FONT,
            fontWeight: 500,
            lineHeight: 1.2,
            color: color ?? COLOR.textPrimary,
            overflowWrap: "break-word",
          }}
        >
          {value}
        </span>
```

> 这是 spec §9 第一行的改动：值 span 无 overflow 时 `min-width:auto` 会撑破 24 列的 Col（Col 内容宽已足够，但 320px 下「128,450.66」仍可能压线，防御性补上）。

- [ ] **Step 3: 验证**

Run: `pnpm verify` → 全绿。

浏览器 375px：`/`、`/me`、`/master` 三页的总览区一列一个、不再「一列 209px 右侧空 94px」；768px+：四格并排与改动前一致。

- [ ] **Step 4: Commit**

```bash
git add app/components/PortfolioView.tsx app/components/ui/StatBig.tsx
git commit -m "feat(mobile): 组合总览窄屏一列 + StatBig 数值可收缩"
```

---

### Task 7: SellPanel 表移出 Alert + 双渲染降级

**Files:**
- Modify: `app/components/SellPanel.tsx:126-241`（Slider 换快捷按钮、表移出 Alert、窄屏卡片化）

**Interfaces:**
- Consumes: `.fp-mobile` / `.fp-desktop`（Task 1）；`DataRow`（既有）；`fmtYuan`/`sharesToDisplay`/`rateToPercent`（既有）
- Produces: SellPanel props 不变。FIFO 试算表在两个视图中都渲染 `estimate.lotResults`，字段：批次份额 / 持有天数 / 费率 / 赎回费——**四个字段一个都不能少**（spec §11 降级不丢字段）。

- [ ] **Step 1: Slider 换快捷按钮（照 BuyPanel 的正确形态）**

替换 `:125-135` 的 Slider 块：

```tsx
      {availableSharesScaled > 0 && (
        <Space wrap style={{ marginBottom: 16 }}>
          {/* 快捷份额按钮。取代 Slider：279px 宽上 100 档 = 2.8px/档，
              手指无法定位（spec §9）；BuyPanel 的快捷金额就是这个形态 */}
          {[0.25, 0.5, 0.75, 1].map(r => (
            <Button
              key={r}
              size="small"
              onClick={() =>
                setSharesInput((availableSharesScaled * r / SHARE_SCALE).toFixed(4))}
            >
              {r === 1 ? "全部" : `${r * 100}%`}
            </Button>
          ))}
        </Space>
      )}
```

> `Space` 从 antd import（检查文件头 import 列表，缺就补）。注意 `availableSharesScaled * r / SHARE_SCALE` 的运算顺序——整数乘浮点再除，**这串是 UI 展示值（输入框内容），不进金额运算**，精度铁律不适用；真正提交时仍走 `sharesInput → Math.round(n * SHARE_SCALE)` 既有链路。

- [ ] **Step 2: FIFO 表移出 Alert，桌面包 `.fp-desktop`**

`:146-241` 的 `{estimate && (<Alert …>…)}` 整块改为（保持全部四行汇总文本与文案不变，仅换容器）：

```tsx
      {/* FIFO 逐批费用明细。⚠️ 曾经整块塞在 Alert 的 description 里 ——
          Alert 自带 padding 20/24 + showIcon，任何宽度下都在挤压这张表，
          这是既有缺陷，两端一起修（spec §1.3 唯一豁免的桌面变更） */}
      {estimate && (
        <div style={{ marginBottom: 16 }}>
          <Text strong>赎回费用预估（先进先出，逐批计费）</Text>

          {/* 桌面视图：原 4 列 Table 原样保留 */}
          <div className="fp-desktop">
            <Table …原样保留 :154-186 的 Table，style 改 marginBottom: 12 → 0… />
          </div>

          {/* 窄屏视图：同一数据源降级成 DataRow 行，字段不缺（spec §11） */}
          <div className="fp-mobile">
            {estimate.lotResults.map((lot, i) => (
              <div key={lot.lotId} style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>第 {i + 1} 批</Text>
                <DataRow label="批次份额" value={`${sharesToDisplay(lot.consumedSharesScaled)} 份`} mono />
                <DataRow label="持有天数" value={`${lot.holdDays} 天`} mono />
                <DataRow label="费率" value={rateToPercent(lot.rate)} mono />
                <DataRow label="赎回费" value={`${fmtYuan(lot.feeCents)} 元`} mono last />
              </div>
            ))}
          </div>

          <div>
            赎回总额：
            <Text strong>{fmtYuan(estimate.totalGrossCents)} 元</Text>
          </div>
          {/* …赎回费合计 / 预计到账 / 已实现盈亏 / 尾注 Paragraph 原样搬过来，文案一字不改… */}
        </div>
      )}
```

> 实施时把原 Alert description 内的四行汇总 + Paragraph **逐字搬入**新容器（含「刻意不标红」注释块）；`lot.lotId`、`lot.consumedSharesScaled`、`lot.holdDays`、`lot.rate`、`lot.feeCents` 均为 `calcRedeem` 返回的 `lotResults` 既有字段。

- [ ] **Step 3: 验证**

Run: `pnpm verify` → 全绿。

浏览器：
- 375px `/me/holdings/:code` 卖出面板：输份额后试算区是 DataRow 卡片、四字段齐全、无横滚；快捷按钮 25/50/75/全部 可用
- **768px+：Table 版展示，且不再被 Alert 的 padding 挤压（这是有意变更，spec §1.3 豁免）**

- [ ] **Step 4: Commit**

```bash
git add app/components/SellPanel.tsx
git commit -m "feat(mobile): 卖出面板——表移出 Alert 两端同修 + 窄屏 DataRow 降级 + 快捷份额"
```

---

### Task 8: 份额批次表与重仓股表降级

**Files:**
- Modify: `app/routes/me.holdings.$code.tsx:112-117`（Space 加 wrap）、`:134-179`（批次表双渲染）
- Modify: `app/routes/funds.$code.tsx:302-323`（重仓股表双渲染）

**Interfaces:**
- Consumes: `.fp-mobile`/`.fp-desktop`（Task 1）；`DataRow`、`countDays`、`findRedeemRate`、`rateToPercent`、`sharesToDisplay`、`fmtYuan`（既有）
- Produces: 无

- [ ] **Step 1: `me.holdings.$code.tsx:112` Space 加 wrap**

```tsx
      <Space align="baseline" wrap>
        <Title level={3} style={{ margin: 0 }}>{d.fundName}</Title>
        <Text type="secondary">{d.fundCode}</Text>
        {d.fundType && <Tag>{d.fundType}</Tag>}
        <Button size="small" href="/me/holdings">← 返回持仓</Button>
      </Space>
```

- [ ] **Step 2: 份额批次表双渲染**

`:140-173` 的 Table 包 `.fp-desktop`，后随 `.fp-mobile` 卡片版（五个字段一个不少）：

```tsx
              <>
                <div className="fp-desktop">
                  <Table …原样保留… />
                </div>
                {/* 窄屏：批次降级成 DataRow。它是 FIFO 阶梯费率可见性的载体
                    （share_lot 存在的唯一理由），不能只横滚（spec §7） */}
                <div className="fp-mobile">
                  {d.lots.map((l, i) => (
                    <div key={l.id} style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 13 }}>第 {i + 1} 批 · {l.confirmDate}</Text>
                      <DataRow label="份额" value={`${sharesToDisplay(l.sharesScaled)} 份`} mono />
                      <DataRow label="成本" value={`${fmtYuan(l.costCents)} 元`} mono />
                      <DataRow label="持有天数" value={`${countDays(l.confirmDate, today)} 天`} mono />
                      <DataRow
                        label="当前费率档"
                        value={rateToPercent(findRedeemRate(d.tiers, countDays(l.confirmDate, today)))}
                        mono
                        last
                      />
                    </div>
                  ))}
                </div>
              </>
```

- [ ] **Step 3: 重仓股表降级（funds.$code.tsx）**

`:302-323` 同法：Table 包 `.fp-desktop`，`.fp-mobile` 用 DataRow 五字段（代码 / 简称 / 占净值比 / 行业 / 增减持）：

```tsx
        <SectionCard title="重仓股（前 10）">
          <div className="fp-desktop">
            <Table …原样保留… />
          </div>
          <div className="fp-mobile">
            {loaderData.position.slice(0, 10).map((p, i) => (
              <div key={p.code} style={{ marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>{p.name}（{p.code}）</Text>
                <DataRow label="占净值比" value={rateToPercent(p.ratio)} mono />
                <DataRow label="行业" value={p.industry} />
                <DataRow label="增减持" value={p.changeType} last />
              </div>
            ))}
          </div>
        </SectionCard>
```

- [ ] **Step 4: 验证**

Run: `pnpm verify` → 全绿。

375px：`/me/holdings/:code` 批次卡片五字段、基金名不折成 4 行；`/funds/:code` 重仓股 DataRow、无横滚。768px+：两处 Table 原样。

- [ ] **Step 5: Commit**

```bash
git add app/routes/me.holdings.\$code.tsx app/routes/funds.\$code.tsx
git commit -m "feat(mobile): 份额批次与重仓股表双渲染降级 + 标题行 wrap"
```

---

### Task 9: 一行级机械修正（Pagination / Segmented / Tabs label）

**Files:**
- Modify: `app/routes/me.orders.tsx:62-70`
- Modify: `app/routes/master.tsx:100-113`（Tabs label 去计数）、`:131-139`、`:159-167`（两个 Pagination）
- Modify: `app/components/ui/PeriodTabs.tsx:21-30`（外层滚动容器）
- Modify: `app/routes/funds._index.tsx:117-134`（Segmented 移出 extra）

**Interfaces:**
- Consumes: `.fp-h-scroll`（Task 1）
- Produces: 无

- [ ] **Step 1: 三个 Pagination 传 `responsive` + 包滚动容器**

`me.orders.tsx`：

```tsx
                {orders.length > PAGE_SIZE && (
                  <div className="fp-h-scroll" style={{ marginTop: 16 }}>
                    <Pagination
                      align="end"
                      responsive
                      current={page}
                      pageSize={PAGE_SIZE}
                      total={orders.length}
                      showSizeChanger={false}
                      onChange={setPage}
                    />
                  </div>
                )}
```

`master.tsx` 两处同法（`orderPage`/`setOrderPage` 与 `txPage`/`setTxPage`），去掉原 `style={{ marginTop: 16 }}`（挪到包裹 div）。

> ⚠️ `responsive` 必须显式传：antd 的自动缩小是 `xs && !size && responsive` 三条件与，不传就不生效（spec §9，从 Pagination 源码核过）。

- [ ] **Step 2: master Tabs label 去计数**

```tsx
              label: `持仓`,
```
```tsx
              label: `定投计划`,
```
```tsx
              label: `交易记录`,
```
```tsx
              label: `资金流水`,
```

（四项改短 label；计数信息在卡片内首行有 EmptyState/列表承载，不丢。）

- [ ] **Step 3: PeriodTabs 套滚动容器**

```tsx
export function PeriodTabs({ options, value, onChange, size = "small" }: PeriodTabsProps) {
  return (
    <div className="fp-h-scroll">
      <Segmented
        size={size}
        value={value}
        onChange={v => onChange(String(v))}
        options={options.map(o => ({ label: o.label, value: o.key }))}
      />
    </div>
  );
}
```

> 桌面无副作用：`fp-h-scroll` 只在 `@media (max-width:767px)` 里生效。

- [ ] **Step 4: funds._index 的两个 Segmented 移出 extra**

SectionCard 不传 `extra`，两个 Segmented 挪进卡内第一行、外套滚动容器：

```tsx
      <SectionCard title="基金排行榜">
        {/* 筛选器放卡内首行而非 Card extra —— Card 标题行是不换行的 flex，
            两个 Segmented 合计约 454px 必然顶穿（spec §9） */}
        <div
          className="fp-h-scroll"
          style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}
        >
          <Segmented
            size="small"
            value={type}
            onChange={v => onTabChange(String(v), "type")}
            options={FUND_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
          />
          <Segmented
            size="small"
            value={period}
            onChange={v => onTabChange(String(v), "period")}
            options={RANK_PERIOD_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
          />
        </div>
        {rank.length === 0
          ? …原样…
```

> 这是**桌面观感有意变更**（筛选器从右上 extra 挪到卡内首行）—— 768px+ 下 extra 空间足够，本可不挪。为守住「桌面零回归」红线，实施时**保留 extra 里的 Segmented 包 `.fp-desktop`，卡内首行放同一对 Segmented 包 `.fp-mobile`**（双渲染，两组件受控同源 state，无逻辑分叉）。上面代码块是卡内那份；extra 那份照旧不动只加包裹类名。

- [ ] **Step 5: 验证**

Run: `pnpm verify` → 全绿。

375px：`/me/orders`（造 200+ 单或临时把 PAGE_SIZE 看 2）翻页器不溢出；`/master` 四个 Tab label 齐全可点；图表周期条可横滑；`/funds` 两个筛选器可见可用。768px+：`/funds` 筛选器仍在 extra（fp-desktop 那份）、其余无变化。

- [ ] **Step 6: Commit**

```bash
git add app/routes/me.orders.tsx app/routes/master.tsx app/components/ui/PeriodTabs.tsx app/routes/funds._index.tsx
git commit -m "feat(mobile): Pagination responsive + Segmented 滚动容器 + master Tabs 短 label"
```

---

### Task 10: 页面级杂项（Space size=48 降档 / dca actions / watchlist actions / maxWidth 显式化）

**Files:**
- Modify: `app/routes/funds.$code.tsx:186-211`、`app/routes/me.holdings.tsx:49-74`、`app/routes/me.holdings.$code.tsx:124-130`、`app/routes/me.dca.tsx:168-177`（4 处 `Space size={48} wrap`）
- Modify: `app/routes/me.dca.tsx:200-231`（actions）
- Modify: `app/routes/me.watchlist.tsx:99-112`（actions）
- Modify: `app/routes/login.tsx:64`、`app/routes/register.tsx:56`、`app/routes/me.settings.tsx:161`

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 4 处 `Space size={48} wrap` → `size={[16, 16]}`**

四处的 `<Space size={48} wrap>` 全部替换为 `<Space size={[16, 16]} wrap>`（funds.$code 有一处带 `style={{ marginTop: 8 }}`，保留该 style）。

> 这是**两端同改**：48px 横向 gap 在桌面也是「一行放不下折行后 rowGap 同 48」的元凶（spec §9：5 个数字占 535px 高）。降到 [16,16] 桌面多数情况仍一行放下（1120px 内容宽），窄屏折行间距合理。**不属于桌面回归**——视觉间距变化是修正既有缺陷，与 SellPanel 同类。若 review 时认为桌面间距变化不可接受，改回 `size={[48, 16]}`（横 48 竖 16）即可，两值都在这一处。

- [ ] **Step 2: me.dca 的 actions 改 Dropdown「···」**

`:200-231` 的 `renderActions` 改：

```tsx
                renderActions={p => (
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: "toggle",
                          label: p.status === "active" ? "暂停" : "启用",
                        },
                        {
                          key: "delete",
                          label: "删除",
                          danger: true,
                        },
                      ],
                      onClick: ({ key }) => {
                        if (key === "toggle") {
                          fetcher.submit(
                            {
                              intent: "toggle",
                              id: String(p.id),
                              status: p.status === "active" ? "paused" : "active",
                            },
                            { method: "post" },
                          );
                        }
                        else if (key === "delete") {
                          Modal.confirm({
                            title: "确定删除这个定投计划？",
                            content: "已产生的订单和持仓不受影响。",
                            okText: "删除",
                            okButtonProps: { danger: true },
                            cancelText: "取消",
                            onOk: () =>
                              fetcher.submit(
                                { intent: "delete", id: String(p.id) },
                                { method: "post" },
                              ),
                          });
                        }
                      },
                    }}
                  >
                    <Button size="small">···</Button>
                  </Dropdown>
                )}
```

> import 区补 `Dropdown`（antd）与 `Modal`（antd）。Popconfirm 不再需要——删除确认移进 Dropdown 菜单的 Modal.confirm（点两步进删除，比行内两个按钮省 120px 宽）。**桌面也用同一形态**：行内「暂停/删除」按钮在列表行宽裕时观感更好，但为避免双渲染两套交互，统一 Dropdown（一处实现，窄屏桌面同款，桌面可接受性高）。

- [ ] **Step 3: me.watchlist 的 actions 合一**

`:99-112` 的两个按钮合并为一个「···」Dropdown（同 Step 2 模式）：

```tsx
                  actions={(
                    <Dropdown
                      menu={{
                        items: [
                          { key: "view", label: "查看" },
                          { key: "remove", label: "取消自选", danger: true },
                        ],
                        onClick: ({ key }) => {
                          if (key === "view") {
                            window.location.href = `/funds/${it.fundCode}`;
                          }
                          else if (key === "remove") {
                            fetcher.submit(
                              { intent: "remove", fundCode: it.fundCode },
                              { method: "post" },
                            );
                          }
                        },
                      }}
                    >
                      <Button size="small">···</Button>
                    </Dropdown>
                  )}
```

> 「查看」原来是大 `<a>` 语义跳转；Dropdown 里用 `window.location.href`（无 router 依赖、SSR 安全）。若 review 偏好保持链接语义，可换 `<Button size="small" href={...}>查看</Button>` + 只收「取消自选」进 Dropdown —— 实施者按 375px 实测哪个放得下选哪个，**「查看」保链接形态优先**。

- [ ] **Step 4: 3 处 maxWidth 显式化**

`login.tsx:64` / `register.tsx:56`：

```tsx
    <div style={{ maxWidth: "min(420px, 100%)", margin: "48px auto" }}>
```

`me.settings.tsx:161`：

```tsx
        <fetcher.Form method="post" style={{ maxWidth: "min(420px, 100%)" }}>
```

> 把「外层 padding 恰好小于 420」的隐式兜底显式化——Content padding 改 12 后实际内容宽 351px 仍小于 420，行为不变，但不再依赖巧合（spec §9）。

- [ ] **Step 5: 验证**

Run: `pnpm verify` → 全绿。

375px：`/me/dca` 每行 actions 是「···」、暂停/删除可用；`/me/watchlist` 同；`/login` 表单居中不溢出。768px+：四页 Space 间距 16、actions 为 Dropdown（观感变化属 Step 1/2 注明的有意变更）。

- [ ] **Step 6: Commit**

```bash
git add app/routes/funds.\$code.tsx app/routes/me.holdings.tsx app/routes/me.holdings.\$code.tsx app/routes/me.dca.tsx app/routes/me.watchlist.tsx app/routes/login.tsx app/routes/register.tsx app/routes/me.settings.tsx
git commit -m "feat(mobile): 统计行间距降档 + 行操作收进 Dropdown + maxWidth 显式化"
```

---

### Task 11: 图表高度与日历格子 + TxList gap

**Files:**
- Create: `app/components/ui/chart.ts`（CHART_HEIGHT 常量）
- Modify: `app/components/AssetTrendChart.tsx:37-51`（骨架）、`:93-99`（config.height）
- Modify: `app/components/NavChart.tsx:48-62`（骨架）、`:133-149`（config.height + labelAutoRotate）
- Modify: `app/components/ProfitCalendar.tsx:143-149`（grid）、`:188-199`（格子）、`:212-229`（数字）
- Modify: `app/components/TxList.tsx:51`（gap）
- Modify: `app/styles/responsive.css`（图表容器与日历窄屏块）

**Interfaces:**
- Consumes: 无
- Produces: `CHART_HEIGHT`（`app/components/ui/chart.ts` 导出的常量 `= 320`），AssetTrendChart / NavChart 两处骨架 + 两处 config 共 4 处消费。**骨架是 inline style，无法用 CSS 类覆盖高度**（`useIsClient` 分支渲染的是同一 div，不是类组件），所以高度窄屏化靠「容器 div 包 `.fp-chart-box` + CSS 设高 + 骨架高度继承」——见 Step 2。

- [ ] **Step 1: 建 `chart.ts` 常量**

```ts
// app/components/ui/chart.ts
/** 图表统一高度。4 处硬编码 320（两图表 config + 两骨架）的唯一定义点 */
export const CHART_HEIGHT = 320;
```

- [ ] **Step 2: 两图表容器包 `.fp-chart-box`，高度走 CSS**

`AssetTrendChart.tsx` 与 `NavChart.tsx`：

- 骨架 div 的 `height: 320` 改 `height: CHART_HEIGHT`（import 常量）
- config 的 `height: 320` 改 `height: CHART_HEIGHT`
- 返回结构最外层包 `<div className="fp-chart-box">…</div>`（包住 PeriodTabs + 图区）
- NavChart 的 `axis.x.labelAutoRotate: false` 改 `labelAutoRotate: true`（放开旋转，窄屏 X 轴标签斜排可读，桌面无碍——G2 按宽度自适应决定是否旋转）

responsive.css 追加：

```css
/* ══════════ 6. 图表高度窄屏降档（spec §9）══════════ */

@media (max-width: 767px) {
  /* 320px 高在 319px 内容宽下宽高比倒挂，曲线被竖向拉伸；降到 220 */
  .fp-chart-box {
    height: auto;
  }
  /* G2 的 autoFit 只管宽度；高度是 config 的 CHART_HEIGHT 传入值。
     窄屏用 CSS 变量注入：图表容器本身是 autoFit 的外层 div，
     通过压缩外层高度让 canvas 跟随（G2 autoFit 监听容器尺寸） */
  .fp-chart-box > div {
    height: 220px !important;
  }
}
```

> ⚠️ **实施者注意**：`.fp-chart-box > div` 直接压 G2 容器高度是「外层定高、autoFit 跟随」的常规做法，但 G2 的 DOM 层级以实际渲染为准（`@ant-design/charts` 的 Line 渲染出 `<div class="ant-chart">` 或直挂 canvas）。**验证时若高度没变**，改为给 `Line` 的 config 加 `height: undefined` 并依赖 autoFit + 外层定高，或最粗暴的兜底：`.fp-chart-box canvas { height: 220px !important }`。以 375px 实测为准，别按本注释照抄了事。

- [ ] **Step 3: ProfitCalendar 三处**

`gridTemplateColumns: "repeat(7, 1fr)"` → `"repeat(7, minmax(0, 1fr))"`（1fr 的 min-content 默认 auto 会被长数字撑爆列宽；minmax(0,1fr) 强制均分——**这是桌面也生效的修正**，桌面 7 列均分语义不变）。

格子 style（`:188-199`）`minHeight: 44` → `aspectRatio: "1 / 1"`、`minHeight: 36`；`padding: "4px 6px"` → `"2px 2px"`。

数字 div（`:213-229`）`fontSize: 11` → `10`，其余（ellipsis 等）不动。

responsive.css 追加：

```css
/* ══════════ 7. 收益日历窄屏字号（spec §9）══════════ */

@media (max-width: 767px) {
  .fp-cal-cell .fp-cal-pnl {
    font-size: 10px;
  }
}
```

（组件内数字 div 加 `className="fp-cal-pnl"`、格子 div 加 `className="fp-cal-cell"`——inline style 的 fontSize 10 已是窄屏值，这段 CSS 是冗余保险，实施时可按「inline 已够就不加类名」裁掉，别双轨。）

- [ ] **Step 4: TxList gap 16 → 8**

`:51` `gap: 16` → `gap: 8`（两端同改：行内 Tag+备注 与 右侧金额在 319px 内容宽下的挤压是既有缺陷，桌面 1120px 宽下 8px 间距观感无损——若 review 有异议改回「窄屏 CSS 覆盖」）。

- [ ] **Step 5: 验证**

Run: `pnpm verify` → 全绿。

375px：`/me` 资产走势高约 220 曲线不竖拉、周期条可滑；收益日历格子方形、金额「+1234」完整显示不截断；流水行不挤。768px+：图表高 320 原样、日历格子 44 高原样（aspect-ratio 在桌面同样生效但格子宽度更大、视觉无差）、流水 gap 8。

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/chart.ts app/components/AssetTrendChart.tsx app/components/NavChart.tsx app/components/ProfitCalendar.tsx app/components/TxList.tsx app/styles/responsive.css
git commit -m "feat(mobile): 图表高度窄屏降档 + 日历格子方形化 + 流水行距收紧"
```

---

### Task 12: 人工验收清单（browser-checklist）

**Files:**
- Create: `.superpowers/sdd/2026-08-28-phase5-mobile-adaptation/browser-checklist.md`

**Interfaces:**
- Consumes: Task 1–11 的全部交付
- Produces: 验收记录（人工勾选）

> 这一步**不是子代理的活**——浏览器验收只有人能做（期一的传统：browser-checklist 是整个阶段唯一必须人来的部分）。实施代理只负责把清单写出来。

- [ ] **Step 1: 写清单**

照期一 `.superpowers/sdd/2026-08-25-phase1-visual-foundation/browser-checklist.md` 的格式：每条写明「要看什么」和「看错了说明哪里坏了」。内容按本计划各 Task 的「验证」步骤汇总，必须覆盖：

- 前置：`pnpm dev` + 登录 + 造数据（期一清单里有造数据说明——撮合手动触发 curl 两条）
- **三档视口**：320 / 375 / 390px（320 只验「不溢出、能用」）
- A. 底部 TabBar：4 格、高亮正确（**含 /me/watchlist 高亮「自选」**）、安全区、点按跳转
- B. 顶栏：窄屏只留 logo+登录态；768px+ Menu 回归
- C. 全站无横向滚动条（逐页过：`/`、`/master`、`/funds`、`/funds/:code`、`/me`、`/me/holdings`、`/me/holdings/:code`、`/me/orders`、`/me/dca`、`/me/watchlist`、`/me/settings`、`/login`、`/register`）
- D. 三个降级表字段完整性（卖出试算 4 字段、批次 5 字段、重仓股 5 字段）
- E. FundListItem 5 消费页两段式
- F. PortfolioSummary 3 页
- G. 图表 220 高 + 周期条横滑；日历方形格 + 金额完整
- H. **桌面回归**：768px+ 逐页对照 git stash 前后（或开两个窗口 1280px），唯一允许的差异是 SellPanel 表不再被 Alert 挤、Space 间距 48→16、dca/watchlist actions 变 Dropdown、TxList gap 8
- I. `pnpm verify` + `pnpm test:workers` 全绿记录

- [ ] **Step 2: Commit**

```bash
git add .superpowers/sdd/2026-08-28-phase5-mobile-adaptation/browser-checklist.md
git commit -m "docs(mobile): 期五浏览器验收清单（三档视口 + 桌面回归对照）"
```

- [ ] **Step 3: 请主人验收**

清单写完即通知主人按清单人工验收 —— **这一步的勾选权在人，不在代理**。

---

## Self-Review 记录（写计划时自查过）

1. **Spec 覆盖**：§4.3→Task 1；§4.4→Task 1；§5→Task 1；§6.4→Task 2；§6.2→Task 3；§6.1/6.3→Task 4；§8→Task 5；§9 的 PortfolioView/StatBig→Task 6；§7 SellPanel→Task 7；§7 另两表→Task 8；§9 Pagination/Segmented/Tabs→Task 9；§9 Space48/dca/watchlist/maxWidth→Task 10；§9 图表/日历/TxList→Task 11；§11→Task 12。**无缺口。**
2. **占位符扫描**：Task 7 Step 2 里有一处「…赎回费合计 / 预计到账 / 已实现盈亏 / 尾注 Paragraph 原样搬过来」的省略——这是「保留原文案不动」的指令而非待填空，原文案在 SellPanel.tsx:187-237 逐字存在，实施者照搬即可。其余无 TBD/TODO。
3. **类型一致性**：`resolveSelectedKey(pathname: string, items: readonly NavItem[]): string` 在 Task 2 定义、Task 3/4 消费一致；`.fp-mobile`/`.fp-desktop`/`.fp-h-scroll`/`.fp-content` 类名 Task 1 定义、Task 4/5/7/8/9/10/11 消费一致；`CHART_HEIGHT` Task 11 内闭环。
