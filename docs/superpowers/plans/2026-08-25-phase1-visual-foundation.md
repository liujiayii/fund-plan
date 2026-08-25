# 期一 · 视觉地基 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主色从喜庆红换成支付宝蓝、让涨跌红绿有唯一出处，并把 10 处横向滚动的 `Table` 换成卡片列表 —— 功能一行不改，观感全面翻新。

**Architecture:** 新增 `app/theme.ts` 作为颜色唯一出处（零 import，可在 node 环境单测）；新增 `app/components/ui/` 作为零业务依赖的展示层；新增 4 个列表组件收敛 10 处重复的 `columns` 定义。自下而上：先立地基，再逐页替换，每页替换完即可独立验收。

**Tech Stack:** React Router 8（framework mode）、antd 6、UnoCSS（CLI 预生成）、TypeScript、Vitest（node 环境）

**Spec:** `docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md`

## Global Constraints

每个任务都隐含以下要求，不再逐条重复：

- **包管理器只用 pnpm**，绝不用 npm
- 代码风格：**双引号 + 分号 + 2 空格缩进**（`@antfu/eslint-config`）
- **代码要加合理的中文注释**
- `if` 单语句不写花括号，条件与语句分两行 —— 与现有代码一致，否则 `eslint --fix` 会产生无意义 diff：
  ```ts
  if (v > 0)
    return COLOR.up;
  ```
- 颜色一律从 `~/theme` 取，**任何文件不得再出现十六进制颜色字面量**（`root.tsx` 里 `rgba()` 的阴影值除外）
- UnoCSS **只写布局与间距**，颜色/圆角/阴影走 antd token 与 `COLOR`
- 期一**不碰** `app/domain/`、`app/services/`、`app/db/`、`workers/` —— 纯前端层
- 期一**不改任何 loader/action 逻辑**，只改组件渲染
- 每个任务结束跑 `pnpm typecheck && pnpm lint`，通过后 commit
- 改了 `className` 之后必须跑 `pnpm uno:build`（`app/uno.gen.css` **入库**，不要手改）
- 精度铁律不变：金额是整数「分」，展示一律走 `~/domain/money` 的 `centsToYuan` / `navToDisplay` / `sharesToDisplay` / `rateToPercent`，**绝不用 JS 浮点数算钱**

### 期一的「测试」是什么

期一交付的几乎全是展示组件，没有可断言的业务逻辑。**不为它们编造单元测试** ——
设计文档第 11 节已明确「UI 组件不写测试」。期一的验证靠三样：

1. `pnpm typecheck` —— 组件 props 与 `services` 类型是否对得上
2. `pnpm lint` —— 风格与常见错误
3. **人眼看页面**：`pnpm dev` 后逐页对照该任务的「视觉验收」清单

唯一的例外是 Task 1 的 `app/theme.ts`：它有真正值得断言的不变式
（主色不能和涨色撞、涨跌不能同色、`pnlColor` 三态正确），且它零 import
可以在 node 环境跑，所以补进现有的 `tests/smoke.test.ts`。

---

## File Structure

**新建**

| 文件 | 职责 |
| ---- | ---- |
| `app/theme.ts` | 颜色与字体的唯一出处 + antd token 配置对象。**零 import**，保证可在 node 测试环境导入 |
| `app/components/ui/StatBig.tsx` | 大数字展示，取代 antd `Statistic` |
| `app/components/ui/PnlText.tsx` | 涨跌数字，自动 +/− 号与红绿 |
| `app/components/ui/SectionCard.tsx` | 统一卡片外壳 |
| `app/components/ui/DataRow.tsx` | 左标签右值一行，取代 `Descriptions` |
| `app/components/ui/EmptyState.tsx` | 统一空态 |
| `app/components/ui/FundListItem.tsx` | 基金行骨架：左名称右数值最右操作 |
| `app/components/ui/PeriodTabs.tsx` | 时间范围切换 |
| `app/components/HoldingList.tsx` | 持仓列表，收敛 4 处 `<Table<HoldingView>>` |
| `app/components/OrderList.tsx` | 订单列表，收敛 3 处 `<Table<OrderView>>` |
| `app/components/DcaPlanList.tsx` | 定投计划列表，收敛 2 处 `<Table<DcaPlanView>>` |
| `app/components/TxList.tsx` | 资金流水列表，收敛 1 处 `<Table<TransactionView>>` |

**修改**

| 文件 | 改什么 |
| ---- | ---- |
| `uno.config.ts:48-63` | `shortcuts` 与 `theme.colors` 里的 3 处旧色值 |
| `tests/smoke.test.ts` | 追加 `theme` 的色彩不变式断言 |
| `app/root.tsx:70-131` | 主色、Header 白底、浅灰底、内容容器宽度 |
| `app/routes/me.settings.tsx` | `Descriptions` → `DataRow`；`Statistic` → `StatBig` |
| `app/routes/funds._index.tsx` | 搜索结果 `Table` → `FundListItem` |
| `app/components/PortfolioView.tsx` | `HoldingTableReadonly` → `HoldingList`；`pnlColor` 改为从 `~/theme` 导入 |
| `app/routes/me.orders.tsx` | 11 列 `Table` → `OrderList` |
| `app/routes/me.dca.tsx` | `Table` → `DcaPlanList` |
| `app/routes/me.holdings.tsx` | `Table` → `HoldingList`；删本地 `pnlColor` |
| `app/routes/me._index.tsx` | 两处 `Table` → `HoldingList` / `OrderList`；删本地 `pnlColor` |
| `app/routes/master.tsx` | 3 处 `Table` → `DcaPlanList` / `OrderList` / `TxList` |
| `app/routes/_index.tsx` | 消费新的 `HoldingList`；「最近操作」块降噪 |
| `app/routes/funds.$code.tsx` | `Statistic` → `StatBig`；`Descriptions` → `DataRow`；删内联色值 |
| `app/components/NavChart.tsx` | `Radio.Group` → `ui/PeriodTabs` |
| `app/components/BuyDrawer.tsx` | `Descriptions` → `DataRow` |
| `app/components/SellDrawer.tsx` | `Descriptions` → `DataRow`；2 处色值字面量 → `pnlColor` / `COLOR`；FIFO 明细表**保留 Table 结构** |

---

## Task 1: 主题层与全局布局

**Files:**
- Create: `app/theme.ts`
- Modify: `uno.config.ts:48-63`
- Modify: `app/root.tsx:1-131`
- Test: `tests/smoke.test.ts`（追加一个 describe 块）

**Interfaces:**
- Consumes: 无（这是最底层）
- Produces: 后续所有任务都从这里取色与字体
  - `COLOR: { primary, up, down, neutral, bg, card, border, textPrimary, textSecondary }`（全部 `string`）
  - `NUM_FONT: string`
  - `pnlColor(v: number): string`
  - `ANTD_TOKEN: { token: Record<string, unknown>; components: Record<string, unknown> }`

- [ ] **Step 1: 写 `app/theme.ts`**

⚠️ **这个文件必须零 import。** 它会被 node 环境的 `tests/smoke.test.ts` 导入，
一旦 `import { theme } from "antd"` 就会把整个 antd 拖进 node 测试进程。
`ANTD_TOKEN` 只是个普通对象，不需要 antd；`theme.defaultAlgorithm` 留在 `root.tsx` 里引。

```ts
/**
 * 全站视觉 token —— 颜色与数字字体的**唯一出处**。
 *
 * ⚠️ 本文件刻意零 import：它被 node 环境的单测导入，
 * 一旦引入 antd 就会把整个组件库拖进测试进程。
 * `ANTD_TOKEN` 只是普通对象，`theme.defaultAlgorithm` 请在 root.tsx 里引。
 *
 * 为什么主色是蓝而不是红：涨跌用红绿是国内习惯，如果主色也是红，
 * 按钮/标签/进度条就和「涨」撞成一片，用户分不清「这是操作」还是「这是赚钱」。
 * 支付宝的解法就是把主色让给品牌蓝，红绿只留给涨跌。
 */

export const COLOR = {
  /** 品牌 / 操作：按钮、链接、选中态、进度条 */
  primary: "#1677FF",
  /** 涨 / 收益为正 */
  up: "#F5222D",
  /** 跌 / 收益为负 */
  down: "#00A870",
  /** 平（0 或无数据） */
  neutral: "#8C8C8C",
  /** 页面底色 */
  bg: "#F5F7FA",
  /** 卡片底色 */
  card: "#FFFFFF",
  /** 分割线 */
  border: "#EEF0F4",
  textPrimary: "#1F2329",
  textSecondary: "#8A9099",
} as const;

/**
 * 数字用等宽字体栈，保证金额纵向对齐 ——
 * 比例字体下 "1" 比 "8" 窄，一列金额会参差不齐。
 */
export const NUM_FONT
  = "\"DIN Alternate\", \"SF Mono\", ui-monospace, Menlo, monospace";

/**
 * 涨红跌绿（国内习惯）。
 *
 * ⚠️ 与旧实现的区别：0 返回灰色而非 undefined。
 * 旧实现返回 undefined 让它继承正文色，导致「0 盈亏」看起来像正常文字，
 * 分不清是「不赚不亏」还是「这列不是盈亏」。
 */
export function pnlColor(v: number): string {
  if (v > 0)
    return COLOR.up;
  if (v < 0)
    return COLOR.down;
  return COLOR.neutral;
}

/**
 * antd ConfigProvider 的 theme 配置。
 *
 * ⚠️ 绝不要把 colorSuccess 映射成 COLOR.up、colorError 映射成 COLOR.down。
 * 那会反向污染所有非金融语义：错误 Alert 变绿、成功 Alert 变红、
 * <Tag color="success"> 变红。antd 的语义色保持原样（成功绿、错误红），
 * 涨跌只通过 COLOR.up / COLOR.down / pnlColor 表达，两套色系各管一摊。
 */
export const ANTD_TOKEN = {
  token: {
    colorPrimary: COLOR.primary,
    colorInfo: COLOR.primary,
    colorBgLayout: COLOR.bg,
    colorTextSecondary: COLOR.textSecondary,
    borderRadius: 8,
  },
  components: {
    // 卡片圆角比控件大一档，支付宝那套观感的关键
    Card: { borderRadiusLG: 12 },
    Layout: {
      headerBg: COLOR.card,
      bodyBg: COLOR.bg,
      footerBg: "transparent",
    },
    Menu: { itemBg: "transparent" },
  },
};
```

⚠️ `COLOR` 用 `as const`，但 `ANTD_TOKEN` **刻意不加** —— `as const` 会把嵌套属性
变成 `readonly`，而 antd 的 `ThemeConfig` 要求可变类型，展开进 `<ConfigProvider theme={...}>`
时会报类型错。

- [ ] **Step 2: 追加色彩不变式测试**

在 `tests/smoke.test.ts` 末尾（第 34 行的 `});` 之后）追加：

```ts
describe("视觉 token 不变式", () => {
  it("主色不能与涨色相同（否则按钮和「涨」撞色，是重构前最大的视觉问题）", () => {
    expect(COLOR.primary).not.toBe(COLOR.up);
  });

  it("涨色与跌色必须不同", () => {
    expect(COLOR.up).not.toBe(COLOR.down);
  });

  it("pnlColor 三态：正涨、负跌、零中性", () => {
    expect(pnlColor(1)).toBe(COLOR.up);
    expect(pnlColor(-1)).toBe(COLOR.down);
    expect(pnlColor(0)).toBe(COLOR.neutral);
  });

  it("antd 语义色未被涨跌色覆盖（否则错误提示会变绿、成功提示会变红）", () => {
    const token = ANTD_TOKEN.token as Record<string, unknown>;
    expect(token.colorSuccess).toBeUndefined();
    expect(token.colorError).toBeUndefined();
  });
});
```

同时把 import 加到文件顶部（第 7 行的 `} from "~/domain/config";` 之后）：

```ts
import { ANTD_TOKEN, COLOR, pnlColor } from "~/theme";
```

- [ ] **Step 3: 跑测试，确认失败**

```bash
pnpm test tests/smoke.test.ts
```

预期：4 条新测试全部报错 `Cannot find module '~/theme'`（若 Step 1 还没落盘）或全绿（若已落盘）。
**先跑一次确认它真的在跑你的新断言** —— 把 `COLOR.primary` 临时改成 `"#F5222D"`，
测试必须变红；改回来再跑，必须变绿。这一步是验证测试有效，不是形式主义。

- [ ] **Step 4: 改 `uno.config.ts` 的 3 处旧色值**

把第 48-63 行替换为：

```ts
  // 项目里常用的组合，抽成快捷方式
  shortcuts: {
    // 涨红跌绿（国内习惯）。⚠️ 色值必须与 app/theme.ts 的 COLOR 保持一致，
    // 但这里不能 import ——UnoCSS 配置在构建期独立求值，走不通 ~/ 别名。
    // 改色时两处都要改（app/theme.ts 是权威，这里是镜像）。
    "text-rise": "text-[#F5222D]",
    "text-fall": "text-[#00A870]",
    // 常用布局
    "flex-center": "flex items-center justify-center",
    "flex-between": "flex items-center justify-between",
  },
  theme: {
    colors: {
      // 与 app/theme.ts 的 COLOR 保持一致（镜像，见上方说明）
      primary: "#1677FF",
      rise: "#F5222D",
      fall: "#00A870",
    },
  },
```

- [ ] **Step 5: 改 `app/root.tsx`**

antd 的 import（第 2 行）**不用动** —— `theme` 已经在里面了，
`ANTD_TOKEN` 只是普通对象，不需要额外的 antd 引入。

在第 15 行 `import { getCurrentUser } from "~/services/guard";` 之后插入：

```tsx
import { ANTD_TOKEN, COLOR } from "~/theme";
```

把 `App()` 函数体里的 `return (...)`（第 70-130 行）整体替换为：

```tsx
  return (
    // antd 全局配置：中文语言包 + 视觉 token（见 app/theme.ts）
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: theme.defaultAlgorithm, ...ANTD_TOKEN }}
    >
      <AntLayout style={{ minHeight: "100vh" }}>
        {/* Header 由 antd 默认的深色改为白底 + 底部细线，
            这是「后台管理系统」与「消费级理财 App」观感的分水岭 */}
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            paddingInline: 24,
            background: COLOR.card,
            borderBottom: `1px solid ${COLOR.border}`,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <a
            href="/"
            style={{
              color: COLOR.primary,
              fontWeight: 700,
              fontSize: 18,
              whiteSpace: "nowrap",
            }}
          >
            模拟基金
          </a>
          <Menu
            mode="horizontal"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={NAV_ITEMS.map(i => ({
              key: i.key,
              label: <a href={i.key}>{i.label}</a>,
            }))}
            style={{ flex: 1, minWidth: 0, borderBottom: "none" }}
          />
          {/* 登录态区域：已登录显示用户名与登出，游客显示登录/注册 */}
          {user
            ? (
                <Space>
                  <span style={{ color: COLOR.textSecondary }}>
                    {user.username}
                    {user.role === "admin" ? "（主人）" : ""}
                  </span>
                  <form method="post" action="/logout" style={{ display: "inline" }}>
                    <Button size="small" htmlType="submit">
                      登出
                    </Button>
                  </form>
                </Space>
              )
            : (
                <Space>
                  <Button size="small" href="/login">
                    登录
                  </Button>
                  <Button size="small" type="primary" href="/register">
                    注册
                  </Button>
                </Space>
              )}
        </Header>
        <Content
          style={{
            padding: "24px 24px 48px",
            maxWidth: 1120,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <Outlet />
        </Content>
        <Footer style={{ textAlign: "center", color: COLOR.textSecondary }}>
          模拟盘 · 数据来自公开接口 · 仅供学习，不构成投资建议
        </Footer>
      </AntLayout>
    </ConfigProvider>
  );
```

同时把 `ErrorBoundary` 里第 148 行的 `<a href="/">返回首页</a>` 上方那段
内联 style 保持不动 —— 它没有颜色字面量，不在本次范围。

- [ ] **Step 6: 跑测试与校验**

```bash
pnpm test tests/smoke.test.ts
pnpm typecheck
pnpm lint
pnpm uno:build
```

预期：测试全绿；typecheck 无错；lint 无错；`app/uno.gen.css` 因 `text-rise`/`text-fall`
色值变化而产生 diff。

- [ ] **Step 7: 视觉验收**

```bash
pnpm dev
```

打开 `http://localhost:5173`，确认：

- 顶部导航条是**白底**、有底部细线、滚动时吸顶
- Logo「模拟基金」是**蓝色**
- 页面底色是浅灰 `#F5F7FA`，卡片是白色，两者有明显区分
- 「注册」按钮是**蓝色**实心（不再是红色）
- 主人的盘里盈亏数字仍是红/绿
- 内容区最宽 1120px 且居中

- [ ] **Step 8: Commit**

```bash
git add app/theme.ts app/root.tsx uno.config.ts tests/smoke.test.ts app/uno.gen.css
git commit -m "feat(ui): 建立视觉 token 层，主色换支付宝蓝

新增 app/theme.ts 作为颜色唯一出处（零 import，可 node 单测）：
- 主色 #c62828 → #1677FF，涨 #F5222D / 跌 #00A870 专职表达涨跌
- pnlColor 收敛（原先散落 3 处重复定义）；0 从返回 undefined 改为返回灰色
- ANTD_TOKEN 刻意不映射 colorSuccess/colorError，避免反向污染
  非金融语义（错误 Alert 变绿、成功 Alert 变红）

root.tsx：Header 由深色改白底 + 吸顶 + 细分割线，内容容器 1200 → 1120。
uno.config.ts 的 shortcuts 与 theme.colors 同步换色。
smoke 测试补 4 条色彩不变式断言（主色≠涨色是最关键那条）。"
```

---

## Task 2: `ui/` 基础四件套 + 用它改造设置页

先建最基础的 4 个展示组件，然后**立刻**用它们改造 `me.settings.tsx` ——
那是全站最简单的页面（无 `Table`、纯展示），拿它当第一个消费者，
既验证组件设计合理，也避免留下没人用的死代码。

**Files:**
- Create: `app/components/ui/StatBig.tsx`
- Create: `app/components/ui/PnlText.tsx`
- Create: `app/components/ui/SectionCard.tsx`
- Create: `app/components/ui/DataRow.tsx`
- Modify: `app/routes/me.settings.tsx:1-244`

**Interfaces:**
- Consumes: `~/theme` 的 `COLOR`、`NUM_FONT`、`pnlColor`（Task 1）
- Produces:
  - `StatBig(props: { label: ReactNode; value: ReactNode; color?: string; size?: number; suffix?: ReactNode; extra?: ReactNode })`
  - `PnlText(props: { cents?: number; rate?: number; size?: number; strong?: boolean; colorBy?: number })`
  - `SectionCard(props: { title?: ReactNode; extra?: ReactNode; children: ReactNode })`
  - `DataRow(props: { label: ReactNode; value: ReactNode; last?: boolean })`

- [ ] **Step 1: 写 `app/components/ui/StatBig.tsx`**

```tsx
import type { ReactNode } from "react";
import { COLOR, NUM_FONT } from "~/theme";

export interface StatBigProps {
  /** 标签，如「总资产」 */
  label: ReactNode;
  /** 主数值，传已格式化好的字符串（如 centsToYuan 的产物） */
  value: ReactNode;
  /** 数值颜色，默认正文色；盈亏类传 pnlColor(v) */
  color?: string;
  /** 数值字号。主位 32、次位 24、三级 20 */
  size?: number;
  /** 单位后缀，如「元」，渲染成小一号灰字 */
  suffix?: ReactNode;
  /** 副行说明，如「收益率 +2.31%」 */
  extra?: ReactNode;
}

/**
 * 大数字展示。取代 antd 的 Statistic —— Statistic 的字号与字体栈不可控，
 * 且用比例字体导致一列金额纵向对不齐（"1" 比 "8" 窄）。
 * 这里强制用 NUM_FONT 等宽栈。
 */
export function StatBig({
  label,
  value,
  color,
  size = 32,
  suffix,
  extra,
}: StatBigProps) {
  return (
    <div>
      <div style={{ fontSize: 13, color: COLOR.textSecondary, lineHeight: 1.6 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 2,
        }}
      >
        <span
          style={{
            fontSize: size,
            fontFamily: NUM_FONT,
            fontWeight: 500,
            lineHeight: 1.2,
            color: color ?? COLOR.textPrimary,
          }}
        >
          {value}
        </span>
        {suffix !== undefined && (
          <span style={{ fontSize: 13, color: COLOR.textSecondary }}>{suffix}</span>
        )}
      </div>
      {extra !== undefined && (
        <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
          {extra}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写 `app/components/ui/PnlText.tsx`**

```tsx
import { centsToYuan } from "~/domain/money";
import { NUM_FONT, pnlColor } from "~/theme";

export interface PnlTextProps {
  /** 盈亏金额（分）。传了就显示金额 */
  cents?: number;
  /** 盈亏率（普通小数，0.0231 表示 +2.31%）。传了就显示百分比 */
  rate?: number;
  /** 字号，默认 14 */
  size?: number;
  strong?: boolean;
  /** 显式指定判色依据；不传则用 cents，没有 cents 再用 rate */
  colorBy?: number;
}

/**
 * 涨跌数字。自动带 +/− 号与红绿配色 ——
 * 收敛此前散落在 6 个文件里、每次都手写一遍的
 * `{v > 0 ? "+" : ""}{centsToYuan(v)}` + `style={{ color: pnlColor(v) }}`。
 *
 * cents 与 rate 都传时渲染成「+1,203.55  +2.31%」两段。
 * 负数由 centsToYuan 自带 "-" 号，所以只在正数时补 "+"。
 */
export function PnlText({ cents, rate, size = 14, strong, colorBy }: PnlTextProps) {
  const basis = colorBy ?? cents ?? rate ?? 0;

  const parts: string[] = [];
  if (cents !== undefined)
    parts.push(`${cents > 0 ? "+" : ""}${centsToYuan(cents)}`);
  if (rate !== undefined)
    parts.push(`${rate > 0 ? "+" : ""}${(rate * 100).toFixed(2)}%`);

  return (
    <span
      style={{
        color: pnlColor(basis),
        fontFamily: NUM_FONT,
        fontSize: size,
        fontWeight: strong ? 600 : 400,
      }}
    >
      {parts.join("  ")}
    </span>
  );
}
```

- [ ] **Step 3: 写 `app/components/ui/SectionCard.tsx`**

```tsx
import type { ReactNode } from "react";
import { Card } from "antd";

export interface SectionCardProps {
  title?: ReactNode;
  /** 右上角操作或「查看全部 →」链接 */
  extra?: ReactNode;
  children: ReactNode;
}

/**
 * 统一卡片外壳：白底、12 圆角（由 ANTD_TOKEN 的 Card.borderRadiusLG 给）、
 * 无边框、极浅阴影。
 *
 * 用 variant="borderless" 而非已废弃的 bordered={false}（antd 6 已移除后者）。
 *
 * 刻意不透传 className / style：需要自定义样式的地方（首页的等高栅格、
 * 居中 CTA）继续用裸 Card，避免这个组件长成什么都能干的万能壳。
 */
export function SectionCard({ title, extra, children }: SectionCardProps) {
  return (
    <Card
      title={title}
      extra={extra}
      variant="borderless"
      style={{ boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)" }}
    >
      {children}
    </Card>
  );
}
```

- [ ] **Step 4: 写 `app/components/ui/DataRow.tsx`**

```tsx
import type { ReactNode } from "react";
import { COLOR } from "~/theme";

export interface DataRowProps {
  label: ReactNode;
  value: ReactNode;
  /** 列表最后一行传 true，不画分割线 */
  last?: boolean;
}

/**
 * 左标签右值的一行。取代 antd 的 Descriptions ——
 * Descriptions 的 bordered 模式在窄屏会把 label 与 value 挤成两行、
 * 且列宽不可控，信息密度反而更低。
 */
export function DataRow({ label, value, last }: DataRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        borderBottom: last ? undefined : `1px solid ${COLOR.border}`,
      }}
    >
      <span style={{ fontSize: 13, color: COLOR.textSecondary, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: COLOR.textPrimary, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: 改造 `app/routes/me.settings.tsx`**

改 import：把第 2-14 行的 antd import 替换为（去掉 `Card`、`Descriptions`、`Statistic`，
它们被新组件取代）：

```tsx
import {
  Alert,
  Button,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from "antd";
```

在第 30 行 `import { requireUser } from "~/services/guard";` 之后插入：

```tsx
import { DataRow } from "~/components/ui/DataRow";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
```

把「账户信息」卡片（第 139-175 行的整个 `<Card title="账户信息">…</Card>`）替换为：

```tsx
      <SectionCard title="账户信息">
        <DataRow label="用户名" value={user.username} />
        <DataRow
          label="角色"
          value={
            user.role === "admin"
              ? <Tag color="blue">管理员（组合公开）</Tag>
              : <Tag>普通用户</Tag>
          }
        />
        <DataRow label="注册时间" value={fmtTime(registeredAt)} />
        <DataRow label="初始本金" value={`${centsToYuan(acc.initialCash)} 元`} />
        <DataRow label="当前现金" value={`${centsToYuan(acc.cash)} 元`} />
        <DataRow
          label="累计签到入金"
          value={`${centsToYuan(acc.totalCheckin)} 元`}
          last
        />
      </SectionCard>
```

⚠️ 「管理员」Tag 从 `color="red"` 改成 `color="blue"` —— 红色现在专属涨跌，
不该拿去表达身份。

把「修改密码」与「重置模拟盘」两处 `<Card title="…">` 的开闭标签改成
`<SectionCard title="…">` / `</SectionCard>`（内部内容不动），并把
第 222-226 行的 `<Statistic title="重置后现金" … />` 替换为：

```tsx
          <StatBig
            label="重置后现金"
            value={centsToYuan(acc.initialCash)}
            suffix="元"
            size={24}
          />
```

- [ ] **Step 6: 校验**

```bash
pnpm typecheck
pnpm lint
```

预期：均无错。若 `pnpm lint` 报 `import` 排序问题，跑 `pnpm lint:fix` 自动修。

- [ ] **Step 7: 视觉验收**

`pnpm dev` 后登录并打开 `http://localhost:5173/me/settings`，确认：

- 三张卡片是白底、12 圆角、有极浅阴影、**无边框**
- 「账户信息」是 6 行「左灰标签 / 右黑值」，最后一行**没有**分割线
- 「管理员」Tag 是蓝色
- 「重置后现金」是等宽字体的大数字
- 修改密码与重置按钮功能正常（提交一次改密码试试，或点重置的 Popconfirm 但**取消**）

- [ ] **Step 8: Commit**

```bash
git add app/components/ui/ app/routes/me.settings.tsx
git commit -m "feat(ui): 新增 StatBig/PnlText/SectionCard/DataRow 并改造设置页

四个零业务依赖的展示组件，取代 antd 的 Statistic / Card / Descriptions：
- StatBig 强制等宽字体栈，解决一列金额纵向对不齐
- PnlText 收敛 6 处手写的「+/− 号 + pnlColor」样板
- SectionCard 用 variant=borderless（antd 6 已移除 bordered）
- DataRow 取代 Descriptions（bordered 模式窄屏会挤成两行且列宽不可控）

me.settings.tsx 作为第一个消费者验证组件设计，顺带把「管理员」Tag
从红色改蓝色——红色现在专属涨跌，不该拿去表达身份。"
```

---

## Task 3: 基金行组件 + 搜索页卡片化

**Files:**
- Create: `app/components/ui/FundListItem.tsx`
- Create: `app/components/ui/EmptyState.tsx`
- Modify: `app/routes/funds._index.tsx:1-114`

**Interfaces:**
- Consumes: `~/theme` 的 `COLOR`（Task 1）
- Produces:
  - `FundListItem(props: { fundCode: string; fundName: string; fundType?: string; note?: ReactNode; primary?: ReactNode; secondary?: ReactNode; actions?: ReactNode; href?: string; last?: boolean })`
  - `EmptyState(props: { description: ReactNode; children?: ReactNode })`

  `FundListItem` 是后续 **三个**列表组件（Task 4 的 `HoldingList`、
  Task 5 的 `OrderList`、Task 6 的 `DcaPlanList`）共同的行骨架 ——
  它们只负责往 `note` / `primary` / `secondary` / `actions` 四个插槽里塞内容。

  ⚠️ **Task 9 的 `TxList` 不是它的消费者**，这是有意的：资金流水的行没有基金主体。
  `transactions` 表**没有 fund 字段**，`checkin` / `init` 类型的行天然与基金无关，
  连 `buy` / `sell` 也只带一个可空的 `orderId`。所以 `TxList` 自建行 `div`
  （见 Task 9 的代码），而 `fundCode` / `fundName` 在 `FundListItem` 里
  **保持必填** —— 为一个不存在的消费者加可选性属 YAGNI，
  还会削弱三个真实消费者的契约强度。

- [ ] **Step 1: 写 `app/components/ui/FundListItem.tsx`**

```tsx
import type { ReactNode } from "react";
import { Tag } from "antd";
import { COLOR } from "~/theme";

export interface FundListItemProps {
  fundCode: string;
  fundName: string;
  /** 基金类型，如「混合型」；空串按不传处理 */
  fundType?: string;
  /** 名称下方的补充说明（如「3 批 · 1200.00 份待赎回」「2026-08-24 下单」） */
  note?: ReactNode;
  /** 右侧主值（如市值、委托金额） */
  primary?: ReactNode;
  /** 右侧副值（如盈亏、成交明细） */
  secondary?: ReactNode;
  /** 最右侧操作区（按钮组） */
  actions?: ReactNode;
  /**
   * 名称链接目标，默认 /funds/{fundCode}。
   * 期一没有调用方传它——留着是给期三用：`/me/holdings` 的行要链到
   * 单只持仓详情页 `/me/holdings/{code}` 而不是基金详情页。
   */
  href?: string;
  /** 列表最后一行传 true，不画分割线 */
  last?: boolean;
}

/**
 * 基金行骨架：左侧名称 + 代码 + 类型 + 备注，右侧主副双值，最右操作区。
 *
 * 存在的理由：重构前「基金」这一列的 render 在 8 个文件里各写了一遍
 * （`<a href={/funds/{code}}>{name}<br/><Text type="secondary">{code}</Text></a>`），
 * 改一处样式要改 8 个地方。持仓 / 订单 / 定投三个列表统一消费这个骨架。
 *
 * ⚠️ 资金流水（`TxList`）**不用**它 —— 流水的行没有基金主体：
 * `transactions` 表无 fund 字段，`checkin` / `init` 行天然与基金无关。
 * 所以 `fundCode` / `fundName` 在这里是必填的。
 */
export function FundListItem(props: FundListItemProps) {
  const {
    fundCode,
    fundName,
    fundType,
    note,
    primary,
    secondary,
    actions,
    href,
    last,
  } = props;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 0",
        borderBottom: last ? undefined : `1px solid ${COLOR.border}`,
      }}
    >
      {/* 左侧：名称与标识。minWidth: 0 让长名字能被 flex 压缩而不撑破布局 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/*
          ⚠️ <a> 必须同时包住名称与代码两行。
          旧表格的写法是 <a>{name}<br/><Text>{code}</Text></a> —— 两行都可点。
          若只把 fundName 放进 <a>，点代码就不跳转了，是可验证的功能退化。
          display: block 让链接铺满左列宽度，整块可点 —— 这也更接近支付宝
          基金列表「整行可点」的观感。
          note 刻意留在 <a> 外面：它装的是状态 Tag 与流水说明，不该整段变成链接。
        */}
        <a
          href={href ?? `/funds/${fundCode}`}
          style={{ display: "block", color: COLOR.textPrimary }}
        >
          <div style={{ fontSize: 15, fontWeight: 500 }}>{fundName}</div>
          <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
            {fundCode}
            {fundType ? <Tag style={{ marginInlineStart: 8 }}>{fundType}</Tag> : null}
          </div>
        </a>
        {note !== undefined && (
          <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 4 }}>
            {note}
          </div>
        )}
      </div>

      {/* 右侧：主副数值。whiteSpace: nowrap 防止金额被折行 */}
      {(primary !== undefined || secondary !== undefined) && (
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {primary !== undefined && <div>{primary}</div>}
          {secondary !== undefined && <div style={{ marginTop: 2 }}>{secondary}</div>}
        </div>
      )}

      {actions !== undefined && (
        <div style={{ whiteSpace: "nowrap" }}>{actions}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写 `app/components/ui/EmptyState.tsx`**

```tsx
import type { ReactNode } from "react";
import { Empty } from "antd";

export interface EmptyStateProps {
  description: ReactNode;
  /** 引导用的按钮等 */
  children?: ReactNode;
}

/**
 * 统一空态。包一层只为统一上下留白 ——
 * 裸 Empty 在不同卡片里高度参差，页面看起来不整齐。
 */
export function EmptyState({ description, children }: EmptyStateProps) {
  return (
    <div style={{ padding: "32px 0" }}>
      <Empty description={description}>{children}</Empty>
    </div>
  );
}
```

- [ ] **Step 3: 改造 `app/routes/funds._index.tsx`**

把第 3 行的 antd import 替换为（去掉 `Card`、`Empty`、`Table`、`Tag`）：

```tsx
import { Button, Input, Space, Typography } from "antd";
```

把第 5-6 行之后（`import { searchFunds } from "~/services/fund-data";` 之后）插入：

```tsx
import { EmptyState } from "~/components/ui/EmptyState";
import { FundListItem } from "~/components/ui/FundListItem";
import { SectionCard } from "~/components/ui/SectionCard";
```

把 `FundsIndex` 组件的 `return (...)`（第 41-112 行）整体替换为：

```tsx
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <SectionCard>
        <Title level={3}>基金搜索</Title>
        <Paragraph type="secondary">
          输入基金代码或名称，数据来自东方财富公开接口。点进详情可看真实净值曲线与费率。
        </Paragraph>
        <RouterForm method="get">
          <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
            <Input
              name="q"
              size="large"
              defaultValue={q}
              placeholder="如 000001 或 华夏成长"
              allowClear
            />
            <Button type="primary" size="large" htmlType="submit" loading={searching}>
              搜索
            </Button>
          </Space.Compact>
        </RouterForm>
      </SectionCard>

      {q
        ? (
            <SectionCard title={`「${q}」的搜索结果（${results.length} 条）`}>
              {results.length === 0
                ? (
                    <EmptyState description="没搜到，换个关键词试试" />
                  )
                : (
                    results.map((r, i) => (
                      <FundListItem
                        key={r.code}
                        fundCode={r.code}
                        fundName={r.name}
                        fundType={r.type || undefined}
                        last={i === results.length - 1}
                        actions={(
                          <Button size="small" type="link" href={`/funds/${r.code}`}>
                            查看详情
                          </Button>
                        )}
                      />
                    ))
                  )}
            </SectionCard>
          )
        : (
            <SectionCard title="热门基金">
              <Space wrap>
                {SUGGESTED.map(f => (
                  <Button key={f.code} href={`/funds/${f.code}`}>
                    {f.name}
                    （
                    {f.code}
                    ）
                  </Button>
                ))}
              </Space>
            </SectionCard>
          )}
    </Space>
  );
```

> 注：这里的「热门基金」仍是硬编码 5 只 —— **期四**会把它换成东财排行榜，
> 期一不动它，避免把两期的工作混在一个 commit 里。

- [ ] **Step 4: 校验**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 5: 视觉验收**

打开 `http://localhost:5173/funds`，搜「白酒」，确认：

- 结果是**竖向卡片行**，不再有横向滚动条
- 每行左侧基金名（黑、稍粗）、下方灰色代码 + 类型 Tag
- 最右「查看详情」链接按钮，点击能进详情页
- 最后一行**没有**底部分割线
- 搜个不存在的词（如 `zzzzzz`），空态居中且上下留白匀称

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/FundListItem.tsx app/components/ui/EmptyState.tsx app/routes/funds._index.tsx
git commit -m "feat(ui): 新增 FundListItem 行骨架，搜索结果卡片化

FundListItem 收敛此前在 8 个文件里各写一遍的「基金」列 render
（名称 + <br/> + 灰色代码），提供 note/primary/secondary/actions 四个插槽，
后续持仓/订单/定投三个列表组件都复用它。

资金流水（TxList）不用它——transactions 表无 fund 字段，
checkin/init 行天然与基金无关，故流水行没有基金主体，自建行 div。

funds._index.tsx 的搜索结果表格换成卡片行，去掉横向滚动。
「热门基金」仍是硬编码，期四换东财排行榜。"
```

---

## Task 4: 持仓列表组件 + 公开盘卡片化

`HoldingList` 是收敛面积最大的一个 —— 它一次干掉 4 处
`<Table<HoldingView>>`（`PortfolioView` / `me._index` / `me.holdings`，
其中 `PortfolioView` 又被 `/` 和 `/master` 两个页面消费）。

**Files:**
- Create: `app/components/HoldingList.tsx`
- Modify: `app/components/PortfolioView.tsx:1-180`

**Interfaces:**
- Consumes: `FundListItem`（Task 3）、`PnlText` / `StatBig`（Task 2）、`~/theme`（Task 1）
- Produces:
  - `HoldingList(props: { holdings: HoldingView[]; renderNote?: (h: HoldingView) => ReactNode; renderActions?: (h: HoldingView) => ReactNode })`
  - `PortfolioView.tsx` 改为导出 `PortfolioSummary`、`HoldingListReadonly`、`AdminNotReady`
  - ⚠️ **`pnlColor` 不再从 `PortfolioView.tsx` 导出** —— 改从 `~/theme` 导入。
    Task 8、9 要注意这个 breaking change。

- [ ] **Step 1: 写 `app/components/HoldingList.tsx`**

```tsx
import type { ReactNode } from "react";
import type { HoldingView } from "~/services/portfolio-service";
import { FundListItem } from "~/components/ui/FundListItem";
import { PnlText } from "~/components/ui/PnlText";
import { centsToYuan, navToDisplay } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

/**
 * 「净值 X.XXXX（日期）」的 note 渲染器。
 *
 * 公开盘（`HoldingListReadonly`）与仪表盘速览（`me._index`）共用 ——
 * 两处都只需要露出**估值时点**，不需要份额/成本/批次那些明细。
 *
 * 为什么必须露出日期：净值可能合法滞后数天（拉不到净值时订单顺延），
 * 不标估值时点，用户就分不清今天的估值与上周五的估值。
 * `portfolio-service.ts` 里该字段的注释原文即「便于页面标注「截至 X 日」」。
 *
 * ⚠️ 无 `navDate` 时返回 **`undefined`** 而非 `null`：`FundListItem` 的 `note`
 * 判空是 `!== undefined`，返回 `null` 会通过守卫并渲染出一个带 `marginTop: 4`
 * 的空 div。这个约束刻意收敛在这一个函数里 —— 让它在两个消费者之间不会走偏。
 *
 * 另有一层正确性收益：`portfolio-service` 在拉不到净值时用**成本价兜底**填
 * `navScaled`（同时 `navDate` 为 `null`），所以「有 navDate 才显示净值」
 * 顺带避免了把成本价冒充成净值展示。
 */
export function navDateNote(h: HoldingView): ReactNode {
  return h.navDate ? `净值 ${navToDisplay(h.navScaled)}（${h.navDate}）` : undefined;
}

export interface HoldingListProps {
  holdings: HoldingView[];
  /**
   * 名称下方的补充说明。
   * 只读页不传（保持简洁）；持仓管理页传份额/净值/成本。
   */
  renderNote?: (h: HoldingView) => ReactNode;
  /** 每行最右的操作按钮。只读页不传 */
  renderActions?: (h: HoldingView) => ReactNode;
}

/**
 * 持仓列表。收敛此前 4 处各写一遍 columns 的 <Table<HoldingView>>。
 *
 * 支付宝式信息层级：右侧主值是**市值**（用户最关心「我这只值多少钱」），
 * 副值是盈亏金额 + 盈亏率。份额/净值/成本属于二级信息，
 * 由调用方通过 renderNote 决定要不要露出。
 */
export function HoldingList({
  holdings,
  renderNote,
  renderActions,
}: HoldingListProps) {
  return (
    <div>
      {holdings.map((h, i) => (
        <FundListItem
          key={h.fundCode}
          fundCode={h.fundCode}
          fundName={h.fundName}
          fundType={h.fundType || undefined}
          note={renderNote?.(h)}
          last={i === holdings.length - 1}
          primary={(
            <span
              style={{
                fontFamily: NUM_FONT,
                fontSize: 16,
                color: COLOR.textPrimary,
              }}
            >
              {centsToYuan(h.marketValueCents)}
            </span>
          )}
          secondary={<PnlText cents={h.pnlCents} rate={h.pnlRate} size={12} />}
          actions={renderActions?.(h)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 重写 `app/components/PortfolioView.tsx`**

整个文件替换为：

```tsx
import type { HoldingView, PortfolioView } from "~/services/portfolio-service";
import { Col, Row, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { centsToYuan } from "~/domain/money";
import { pnlColor } from "~/theme";
import { HoldingList } from "./HoldingList";

const { Paragraph } = Typography;

export interface PortfolioViewProps {
  portfolio: PortfolioView;
  /** 是否展示可用现金（公开盘只给总资产，不露现金明细） */
  showCash?: boolean;
}

/**
 * 组合总览。被 /me（本人）与 /master、/（公开只读）共用——
 * 主人的盘就是那个公开盘，一份代码两种身份。
 *
 * ⚠️ pnlColor 已迁到 ~/theme，本文件不再导出它。
 */
export function PortfolioSummary({
  portfolio,
  showCash = true,
}: PortfolioViewProps) {
  const { summary } = portfolio;
  return (
    <Row gutter={[24, 16]}>
      <Col xs={12} md={6}>
        <StatBig
          label="总资产"
          value={centsToYuan(summary.totalAssetCents)}
          suffix="元"
        />
      </Col>
      <Col xs={12} md={6}>
        <StatBig
          label="持仓市值"
          value={centsToYuan(summary.marketValueCents)}
          suffix="元"
          size={24}
        />
      </Col>
      {showCash && (
        <Col xs={12} md={6}>
          <StatBig
            label="可用现金"
            value={centsToYuan(summary.cashCents)}
            suffix="元"
            size={24}
          />
        </Col>
      )}
      <Col xs={12} md={6}>
        <StatBig
          label="浮动盈亏"
          value={`${summary.totalPnlCents > 0 ? "+" : ""}${centsToYuan(summary.totalPnlCents)}`}
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
  );
}

/** 持仓列表（只读版，公开页用） */
export function HoldingListReadonly({ holdings }: { holdings: HoldingView[] }) {
  if (holdings.length === 0) {
    return <EmptyState description="暂无持仓" />;
  }
  // 估值时点必须露出，理由与 undefined-not-null 的约束都在 navDateNote 里
  return <HoldingList holdings={holdings} renderNote={navDateNote} />;
}

/** 主人还没注册时的引导提示 */
export function AdminNotReady({ adminName }: { adminName: string }) {
  return (
    <SectionCard>
      <EmptyState
        description={(
          <div>
            <Paragraph>
              管理员账号
              {" "}
              <Tag>{adminName}</Tag>
              {" "}
              还没注册，公开示范盘暂时为空。
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              用该用户名注册即成为主人，其组合会自动对所有访客公开。
            </Paragraph>
          </div>
        )}
      />
    </SectionCard>
  );
}
```

- [ ] **Step 3: 修掉两个调用方的 import**

`HoldingTableReadonly` 改名成了 `HoldingListReadonly`，两个页面会立刻编译失败。
在 `app/routes/_index.tsx:11-15` 与 `app/routes/master.tsx:4-8`，
把 `HoldingTableReadonly` 全部改成 `HoldingListReadonly`（import 与 JSX 使用处各一次，共 4 处）。

`_index.tsx` 第 160 行：

```tsx
                <HoldingListReadonly holdings={loaderData.portfolio.holdings} />
```

`master.tsx` 第 108 行：

```tsx
              children: <HoldingListReadonly holdings={portfolio.holdings} />,
```

> 这两个页面的其余部分（`master.tsx` 的三张表、`_index.tsx` 的最近操作块）
> 留给 Task 9，本任务只保证它们**编译通过且持仓部分已卡片化**。

- [ ] **Step 4: 校验**

```bash
pnpm typecheck
pnpm lint
```

预期：typecheck 必须无错。若报 `HoldingTableReadonly` 找不到，说明 Step 3 有漏改的地方 ——
用 `git grep HoldingTableReadonly` 确认已清零。

- [ ] **Step 5: 视觉验收**

打开 `http://localhost:5173/`（首页）与 `/master`，确认：

- 四个总览数字里「总资产」明显最大（32px），其余三个 24px
- 「浮动盈亏」数字带颜色，下方副行是「收益率 +x.xx%」且同色
- 持仓变成竖向卡片行，右侧上方是市值、下方是「盈亏金额 盈亏率」同色
- **没有横向滚动条**
- 数字是等宽字体，纵向对齐

- [ ] **Step 6: Commit**

```bash
git add app/components/HoldingList.tsx app/components/PortfolioView.tsx app/routes/_index.tsx app/routes/master.tsx
git commit -m "feat(ui): 新增 HoldingList，公开盘持仓卡片化

HoldingList 一次收敛 4 处 <Table<HoldingView>> 的 columns 定义。
信息层级按支付宝的做法：右侧主值是市值（用户最关心「值多少钱」），
副值是盈亏金额 + 盈亏率，份额/净值/成本降为可选的 note 插槽。

PortfolioView.tsx 重写：Statistic → StatBig、Table → HoldingList，
HoldingTableReadonly 改名 HoldingListReadonly，
并**不再导出 pnlColor**（统一从 ~/theme 取）。"
```

---

## Task 5: 订单列表组件 + 订单页卡片化

`me.orders.tsx` 现在是 **11 列**表格靠 `scroll={{ x: 1100 }}` 撑着，
是全站体验最差的一处。这个任务收益最明显。

**Files:**
- Create: `app/components/OrderList.tsx`
- Modify: `app/routes/me.orders.tsx:1-186`

**Interfaces:**
- Consumes: `FundListItem`（Task 3）、`PnlText`（Task 2）、`~/theme`（Task 1）
- Produces: `OrderList(props: { orders: OrderView[]; detailed?: boolean })`

- [ ] **Step 1: 写 `app/components/OrderList.tsx`**

```tsx
import type { OrderView } from "~/services/portfolio-service";
import { Tag, Tooltip } from "antd";
import { FundListItem } from "~/components/ui/FundListItem";
import { centsToYuan, navToDisplay, sharesToDisplay } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

/**
 * 状态标签。
 *
 * ⚠️ 只有 pending / failed 才贴 Tag —— 「已确认」是常态，
 * 给每一行都贴一个绿色「已确认」等于没有信息，只是噪音。
 * 无 Tag 即代表已成交。
 */
const STATUS_TAG: Partial<Record<OrderView["status"], { color: string; text: string }>> = {
  pending: { color: "orange", text: "待确认" },
  failed: { color: "red", text: "失败" },
};

export interface OrderListProps {
  orders: OrderView[];
  /**
   * true 时右侧副值展示完整成交信息（成交净值 / 份额 / 手续费）。
   * 订单页传 true；首页「最近订单」与公开盘传 false（只要方向和金额）。
   */
  detailed?: boolean;
}

/**
 * 订单列表。收敛 3 处 <Table<OrderView>>（me.orders 11 列、me._index、master）。
 *
 * 降噪三条（见设计文档 3.4）：
 *  - 「手动」不贴 Tag，只有定投才贴
 *  - 「已确认」不贴 Tag，只有待确认/失败才贴
 *  - 方向用蓝色/默认色，不占用红绿（红绿是涨跌的）
 */
export function OrderList({ orders, detailed }: OrderListProps) {
  return (
    <div>
      {orders.map((o, i) => {
        const statusTag = STATUS_TAG[o.status];

        // 委托：申购看金额、赎回看份额
        const commissioned
          = o.side === "buy"
            ? `${centsToYuan(o.amount ?? 0)} 元`
            : `${sharesToDisplay(o.shares ?? 0)} 份`;

        return (
          <FundListItem
            key={o.id}
            fundCode={o.fundCode}
            fundName={o.fundName}
            last={i === orders.length - 1}
            note={(
              <>
                {o.side === "buy"
                  ? <Tag color="blue">申购</Tag>
                  : <Tag>赎回</Tag>}
                {o.source === "dca" && <Tag color="purple">定投</Tag>}
                {statusTag && (
                  o.failReason
                    ? (
                        <Tooltip title={o.failReason}>
                          <Tag color={statusTag.color}>{statusTag.text}</Tag>
                        </Tooltip>
                      )
                    : (
                        <Tag color={statusTag.color}>{statusTag.text}</Tag>
                      )
                )}
                <span>
                  {o.placeDate}
                  {" 下单 · 确认日 "}
                  {o.confirmDate}
                </span>
              </>
            )}
            primary={(
              <span
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: 15,
                  color: COLOR.textPrimary,
                }}
              >
                {commissioned}
              </span>
            )}
            secondary={
              detailed && o.dealNav !== null
                ? (
                    <span style={{ fontSize: 12, color: COLOR.textSecondary }}>
                      {/* 到账/净申购金额放最前：赎回单里「我到手多少钱」是最该被一眼
                          看到的数字，而 primary 位显示的是委托份额、不是钱。
                          「净申购」/「到账」这两个词替代了旧表格靠 Tooltip 才能看到的
                          语义说明（申购=扣申购费后的净额，赎回=扣赎回费后的实际到账）。 */}
                      {o.dealAmount !== null
                        && `${o.side === "buy" ? "净申购" : "到账"} ${centsToYuan(o.dealAmount)} 元 · `}
                      {`成交净值 ${navToDisplay(o.dealNav)}`}
                      {o.dealShares !== null && ` · ${sharesToDisplay(o.dealShares)} 份`}
                      {o.fee !== null && ` · 费 ${centsToYuan(o.fee)} 元`}
                    </span>
                  )
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 改造 `app/routes/me.orders.tsx`**

把第 1-9 行替换为：

```tsx
import type { Route } from "./+types/me.orders";
import { Alert, Space, Typography } from "antd";
import { OrderList } from "~/components/OrderList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getOrders } from "~/services/portfolio-service";

const { Title, Text, Paragraph } = Typography;
```

删掉第 22-26 行的 `STATUS_MAP` 常量（已迁进 `OrderList`）。

把 `MeOrders` 组件里第 47-183 行的整个 `<Card title={...}>…</Card>` 替换为：

```tsx
      <SectionCard title={`全部订单（${orders.length} 笔）`}>
        {orders.length === 0
          ? (
              <EmptyState description="还没有交易记录" />
            )
          : (
              <OrderList orders={orders} detailed />
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          申购采用真实的
          <Text strong>内扣法</Text>
          ：手续费从申购金额中扣除，
          剩余净额除以确认日净值得到份额。赎回按
          <Text strong>先进先出</Text>
          逐批计费。
        </Paragraph>
      </SectionCard>
```

> ⚠️ 注意：旧表格有分页（`pageSize: 20`）。卡片列表去掉了分页 ——
> loader 上限是 200 条，一次渲染 200 行卡片可以接受，且模拟盘订单量远小于此。
> 若日后真的多到卡顿，再加「加载更多」，别现在预先优化。

- [ ] **Step 3: 校验**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 4: 视觉验收**

需要有订单数据。若账号还没订单，先去 `/funds/161725` 买一笔，再回来看。

打开 `http://localhost:5173/me/orders`，确认：

- **没有横向滚动条**（这是本任务最关键的验收点）
- 每行：左侧基金名 + 代码 + 一排 Tag + 「下单日 下单 · 确认日 X」
- 待确认的单有橙色「待确认」Tag；已成交的单**没有**状态 Tag
- 手动下的单**没有**「手动」Tag；定投单有紫色「定投」Tag
- 「申购」Tag 是蓝色，不是红色
- 已成交的单右侧副行显示「成交净值 x · y 份 · 费 z 元」
- 顶部「有 N 笔订单待确认」提示仍在

- [ ] **Step 5: Commit**

```bash
git add app/components/OrderList.tsx app/routes/me.orders.tsx
git commit -m "feat(ui): 新增 OrderList，订单页从 11 列表格改卡片

me.orders.tsx 原本是 11 列表格靠 scroll x=1100 撑着，是全站体验最差的一处。

顺手降噪（设计文档 3.4）：
- 「手动」不再贴 Tag，只有定投才贴
- 「已确认」不再贴 Tag，只有待确认/失败才贴（无 Tag 即已成交）
- 方向 Tag 用蓝色/默认色，不占用红绿——红绿专属涨跌

去掉了分页：loader 上限 200 条，一次渲染可接受，不预先优化。"
```

---

## Task 6: 定投列表组件 + 定投页卡片化

**Files:**
- Create: `app/components/DcaPlanList.tsx`
- Modify: `app/routes/me.dca.tsx:1-374`

**Interfaces:**
- Consumes: `FundListItem`（Task 3）、`~/theme`（Task 1）
- Produces:
  - `DcaPlanList(props: { plans: DcaPlanView[]; renderActions?: (p: DcaPlanView) => ReactNode })`
  - 频率文案的格式化收敛在 `DcaPlanList.tsx` **内部**（不导出 —— 两个调用方
    都只用 `DcaPlanList`，没人需要单独调它）。
    ⚠️ 这段逻辑此前在 `me.dca.tsx` 和 `master.tsx` **各写了一遍**，
    且实现略有差异：一个用 `WEEKDAYS.find(...).label.slice(1)`，
    一个用 `WEEKDAY_LABEL[...]` 查表。本任务删掉 `me.dca.tsx` 的副本，
    Task 9 删掉 `master.tsx` 的副本。

- [ ] **Step 1: 写 `app/components/DcaPlanList.tsx`**

```tsx
import type { ReactNode } from "react";
import type { DcaPlanView } from "~/services/portfolio-service";
import { Tag } from "antd";
import { FundListItem } from "~/components/ui/FundListItem";
import { centsToYuan } from "~/domain/money";
import { COLOR, NUM_FONT } from "~/theme";

/** 周几的中文（索引 1-7 对应周一到周日，0 位留空占位） */
const WEEKDAY_LABEL = ["", "一", "二", "三", "四", "五", "六", "日"];

/**
 * 把频率配置渲染成人话。
 *
 * ⚠️ 此前 me.dca.tsx 与 master.tsx 各实现了一遍，且写法不同
 * （一个从 WEEKDAYS 数组 find 再 slice(1)，一个查 WEEKDAY_LABEL 表），
 * 统一到这里。不导出——两个页面都只消费 DcaPlanList，不需要单独调它。
 */
function frequencyText(p: DcaPlanView): string {
  if (p.frequency === "daily")
    return "每个交易日";
  // ⚠️ 用 `||` 而非 `??`：WEEKDAY_LABEL 的索引 0 是空串占位，
  // `??` 只接 null/undefined，接不住空串 —— dayOfWeek 为 null 时会渲染成
  // 光秃秃的「每周」。被替换掉的 me.dca.tsx 版本（WEEKDAYS.find()?.label）
  // 对 null 是正确回退到「—」的，这里必须保持等价。
  if (p.frequency === "weekly")
    return `每周${WEEKDAY_LABEL[p.dayOfWeek ?? 0] || "—"}`;
  return `每月 ${p.dayOfMonth} 号`;
}

export interface DcaPlanListProps {
  plans: DcaPlanView[];
  /** 每行最右的操作按钮。公开盘（只读）不传 */
  renderActions?: (p: DcaPlanView) => ReactNode;
}

/**
 * 定投计划列表。收敛 2 处 <Table<DcaPlanView>>（me.dca、master）。
 *
 * 信息层级：右侧主值是**每期金额**（定投最核心的参数），
 * 副值是「已投 N 期 · 累计 X 元」；频率与下次执行日放在名称下方的 note，
 * 因为「下次什么时候扣钱」是用户第二关心的事，不该藏在第 4 列。
 */
export function DcaPlanList({ plans, renderActions }: DcaPlanListProps) {
  return (
    <div>
      {plans.map((p, i) => (
        <FundListItem
          key={p.id}
          fundCode={p.fundCode}
          fundName={p.fundName}
          last={i === plans.length - 1}
          note={(
            <>
              {p.status === "active"
                ? <Tag color="blue">执行中</Tag>
                : <Tag>已暂停</Tag>}
              <span>
                {frequencyText(p)}
                {p.status === "active" && ` · 下次 ${p.nextRun}`}
              </span>
            </>
          )}
          primary={(
            <span
              style={{
                fontFamily: NUM_FONT,
                fontSize: 16,
                color: COLOR.textPrimary,
              }}
            >
              {centsToYuan(p.amount)}
              <span style={{ fontSize: 12, color: COLOR.textSecondary }}> 元/期</span>
            </span>
          )}
          secondary={(
            <span style={{ fontSize: 12, color: COLOR.textSecondary }}>
              {`已投 ${p.runCount} 期 · 累计 ${centsToYuan(p.totalInvested)} 元`}
            </span>
          )}
          actions={renderActions?.(p)}
        />
      ))}
    </div>
  );
}
```

⚠️ 「执行中」Tag 从 `color="green"` 改成 `color="blue"` —— 绿色现在专属「跌」，
拿它表示「运行正常」会让人误读成亏损。

- [ ] **Step 2: 改造 `app/routes/me.dca.tsx`**

把第 3-19 行的 antd import 替换为（去掉 `Card`、`Empty`、`Table`、`Statistic`、`Tag`）：

```tsx
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Typography,
} from "antd";
```

在第 31 行 `import { getDcaPlans } from "~/services/portfolio-service";` 之后插入：

```tsx
import { DcaPlanList } from "~/components/DcaPlanList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
```

删掉第 125-133 行本地的 `frequencyText` 函数（已迁进 `DcaPlanList.tsx`）。
`WEEKDAYS` 常量**保留** —— 新建弹窗的 `Select` 还要用它。

把第 178-192 行的统计卡片替换为：

```tsx
      <SectionCard>
        <Space size={48} wrap>
          <StatBig label="计划总数" value={plans.length} suffix="个" size={24} />
          <StatBig label="执行中" value={activeCount} suffix="个" size={24} />
          <StatBig
            label="累计投入"
            value={centsToYuan(totalInvested)}
            suffix="元"
            size={24}
          />
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          系统每天北京时间
          {" "}
          <Text strong>10:00</Text>
          {" "}
          扫描到期的定投计划并自动下单，
          当晚 20:30 按当日净值撮合确认。现金不足时该期跳过，不影响其他计划。
        </Paragraph>
      </SectionCard>
```

把第 194-301 行的「计划列表」卡片替换为：

```tsx
      <SectionCard title="计划列表">
        {plans.length === 0
          ? (
              <EmptyState description="还没有定投计划">
                <Button type="primary" onClick={() => setOpen(true)}>
                  创建第一个计划
                </Button>
              </EmptyState>
            )
          : (
              <DcaPlanList
                plans={plans}
                renderActions={p => (
                  <Space>
                    <fetcher.Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={p.status === "active" ? "paused" : "active"}
                      />
                      <Button size="small" htmlType="submit">
                        {p.status === "active" ? "暂停" : "启用"}
                      </Button>
                    </fetcher.Form>
                    <Popconfirm
                      title="确定删除这个定投计划？"
                      description="已产生的订单和持仓不受影响。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() =>
                        fetcher.submit(
                          { intent: "delete", id: String(p.id) },
                          { method: "post" },
                        )}
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
              />
            )}
      </SectionCard>
```

新建弹窗（第 304-371 行的 `<Modal>`）**完全不动**。

- [ ] **Step 3: 校验**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 4: 视觉验收**

打开 `http://localhost:5173/me/dca`，若没有计划先建一个（基金代码用你访问过的，如 `161725`）：

- 三个统计数字是等宽字体、24px
- 计划行：左侧基金名 + 代码 + 「执行中」蓝 Tag + 「每月 15 号 · 下次 2026-09-15」
- 右侧主值「500.00 元/期」，副值「已投 0 期 · 累计 0.00 元」
- 最右「暂停」「删除」两个按钮
- **点「暂停」能真的暂停**（Tag 变成灰色「已暂停」，note 里的「下次」消失）
- 「删除」的 Popconfirm 弹出后点「取消」不删

- [ ] **Step 5: Commit**

```bash
git add app/components/DcaPlanList.tsx app/routes/me.dca.tsx
git commit -m "feat(ui): 新增 DcaPlanList，定投页卡片化

收敛 2 处 <Table<DcaPlanView>>，并统一 frequencyText ——
它此前在 me.dca.tsx 与 master.tsx 各实现一遍且写法不同
（一个 find+slice(1)，一个查表），现收敛为 DcaPlanList.tsx 的模块内私有函数。

信息层级调整：「下次扣款日」从第 4 列提到名称下方——
那是用户第二关心的事，不该藏在横向滚动区里。

「执行中」Tag 从绿改蓝：绿色现在专属「跌」，
用它表示「运行正常」会被误读成亏损。"
```

---

## Task 7: 持仓管理页卡片化

**Files:**
- Modify: `app/routes/me.holdings.tsx:1-362`

**Interfaces:**
- Consumes: `HoldingList`（Task 4）、`StatBig`（Task 2）、`SectionCard` / `EmptyState`（Task 2、3）、`~/theme`（Task 1）
- Produces: 无新接口

- [ ] **Step 1: 改 import**

把第 4-14 行的 antd import 替换为（去掉 `Card`、`Empty`、`Statistic`、`Table`、`Tag`）：

```tsx
import {
  Alert,
  Button,
  Space,
  Typography,
} from "antd";
```

在第 27 行 `import { placeBuyOrder, placeSellOrder } from "~/services/trade";` 之后插入：

```tsx
import { HoldingList } from "~/components/HoldingList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { pnlColor } from "~/theme";
```

- [ ] **Step 2: 删掉本地 `pnlColor`**

删除第 142-148 行整个函数：

```tsx
function pnlColor(v: number): string {
  if (v > 0)
    return "#c62828";
  if (v < 0)
    return "#2e7d32";
  return undefined as unknown as string;
}
```

它已被 `~/theme` 的版本取代（且那个版本对 0 返回灰色而非 `undefined as unknown as string` 硬拗）。

- [ ] **Step 3: 换总览卡片**

把第 173-185 行替换为：

```tsx
      <SectionCard>
        <Space size={48} wrap>
          <StatBig
            label="持仓市值"
            value={centsToYuan(summary.marketValueCents)}
            suffix="元"
          />
          <StatBig
            label="可用现金"
            value={centsToYuan(cash)}
            suffix="元"
            size={24}
          />
          <StatBig
            label="浮动盈亏"
            value={`${summary.totalPnlCents > 0 ? "+" : ""}${centsToYuan(summary.totalPnlCents)}`}
            suffix="元"
            size={24}
            color={pnlColor(summary.totalPnlCents)}
          />
        </Space>
      </SectionCard>
```

- [ ] **Step 4: 换持仓明细卡片**

把第 187-326 行的整个 `<Card title={`持仓明细（${holdings.length} 只）`}>…</Card>` 替换为：

```tsx
      <SectionCard title={`持仓明细（${holdings.length} 只）`}>
        {holdings.length === 0
          ? (
              <EmptyState description="还没有持仓">
                <Button type="primary" href="/funds">
                  去挑一只基金
                </Button>
              </EmptyState>
            )
          : (
              <HoldingList
                holdings={holdings}
                renderNote={(h) => {
                  const d = detailOf(h.fundCode);
                  return (
                    <>
                      {`${sharesToDisplay(h.sharesScaled)} 份 · 成本 ${centsToYuan(h.costCents)} 元`}
                      {` · 净值 ${navToDisplay(h.navScaled)}`}
                      {h.navDate ? `（${h.navDate}）` : ""}
                      {` · ${d.lots.length} 批`}
                      {d.pendingShares > 0 && (
                        <Text type="warning">
                          {` · ${sharesToDisplay(d.pendingShares)} 份待赎回`}
                        </Text>
                      )}
                    </>
                  );
                }}
                renderActions={h => (
                  <Space>
                    <Button size="small" onClick={() => setBuyTarget(h)}>
                      加仓
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => setSellTarget(h)}
                      disabled={detailOf(h.fundCode).availableShares <= 0}
                    >
                      赎回
                    </Button>
                  </Space>
                )}
              />
            )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          「批次」是同一只基金分次买入形成的份额批，赎回时按买入时间先进先出消耗，
          每批按各自持有天数计赎回费。
        </Paragraph>
      </SectionCard>
```

两个抽屉（第 328-359 行的 `BuyDrawer` / `SellDrawer`）**完全不动**。

- [ ] **Step 5: 校验**

```bash
pnpm typecheck
pnpm lint
git grep -n "c62828\|2e7d32" -- app/routes/me.holdings.tsx
```

最后一条必须**无输出**（本文件的 6 处旧色值已清零）。

- [ ] **Step 6: 视觉验收**

打开 `http://localhost:5173/me/holdings`（需有持仓），确认：

- **没有横向滚动条**（原来是 `scroll={{ x: 900 }}` 的 8 列表格）
- 每行 note 一行显示「x 份 · 成本 y 元 · 净值 z（日期）· n 批」
- 有待赎回份额时，note 末尾多一段橙色「· x 份待赎回」
- 「加仓」「赎回」按钮在最右，**点击能正常打开抽屉**
- 全部份额都在待确认赎回单里时，「赎回」按钮是**禁用**态
- 「浮动盈亏」数字带颜色

- [ ] **Step 7: Commit**

```bash
git add app/routes/me.holdings.tsx
git commit -m "feat(ui): 持仓管理页卡片化，删除本地 pnlColor

8 列表格（scroll x=900）换成 HoldingList 卡片行，
份额/成本/净值/批次/待赎回压成名称下方一行 note。

删掉本文件的 pnlColor 副本——它对 0 返回
\`undefined as unknown as string\`，是类型硬拗；
~/theme 的版本对 0 返回灰色。"
```

---

## Task 8: 我的仪表盘卡片化

`me._index.tsx` 是旧色值最密集的文件（**8 处**），且有两处 `Table`。

**Files:**
- Modify: `app/routes/me._index.tsx:1-321`

**Interfaces:**
- Consumes: `HoldingList`（Task 4）、`OrderList`（Task 5）、`StatBig` / `SectionCard` / `EmptyState`（Task 2、3）、`~/theme`（Task 1）
- Produces: 无新接口

- [ ] **Step 1: 改 import**

把第 3-16 行的 antd import 替换为（去掉 `Card`、`Empty`、`Statistic`、`Table`、`Tag` 之外仍需 `Tag`，因为标题还要贴「主人」）：

```tsx
import {
  Alert,
  Button,
  Col,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
```

在第 23 行 `import { getOrders, getPortfolio } from "~/services/portfolio-service";` 之后插入：

```tsx
import { HoldingList } from "~/components/HoldingList";
import { OrderList } from "~/components/OrderList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { COLOR, pnlColor } from "~/theme";
```

- [ ] **Step 2: 删掉本地 `pnlColor`**

删除第 61-68 行整个函数（含上方的 `/** 涨红跌绿（国内习惯） */` 注释）：

```tsx
/** 涨红跌绿（国内习惯） */
function pnlColor(v: number): string {
  if (v > 0)
    return "#c62828";
  if (v < 0)
    return "#2e7d32";
  return undefined as unknown as string;
}
```

- [ ] **Step 3: 换资产总览卡片**

把第 97-136 行的整个 `<Card>…</Card>` 替换为：

```tsx
      {/* 资产总览。⚠️ 期二会在这里加「资产走势曲线」与「收益（截至 X 日）」，
          本期只做视觉，不动数据来源 */}
      <SectionCard>
        <Row gutter={[24, 16]}>
          <Col xs={12} md={6}>
            <StatBig
              label="总资产"
              value={centsToYuan(summary.totalAssetCents)}
              suffix="元"
            />
          </Col>
          <Col xs={12} md={6}>
            <StatBig
              label="持仓市值"
              value={centsToYuan(summary.marketValueCents)}
              suffix="元"
              size={24}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatBig
              label="可用现金"
              value={centsToYuan(summary.cashCents)}
              suffix="元"
              size={24}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatBig
              label="浮动盈亏"
              value={`${summary.totalPnlCents > 0 ? "+" : ""}${centsToYuan(summary.totalPnlCents)}`}
              suffix="元"
              size={24}
              color={pnlColor(summary.totalPnlCents)}
              extra={`收益率 ${(summary.totalPnlRate * 100).toFixed(2)}%`}
            />
          </Col>
        </Row>
      </SectionCard>
```

- [ ] **Step 4: 换签到卡片**

把第 138-188 行的整个 `<Card title="每日签到领本金">…</Card>` 替换为：

```tsx
      {/* 每日签到 */}
      <SectionCard title="每日签到领本金">
        {fetcher.data?.ok && (
          <Alert type="success" showIcon message={fetcher.data.message} style={{ marginBottom: 16 }} />
        )}
        {fetcher.data?.error && (
          <Alert type="error" showIcon message={fetcher.data.error} style={{ marginBottom: 16 }} />
        )}

        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={8}>
            <StatBig label="当前连签" value={checkinStatus.streak} suffix="天" size={24} />
          </Col>
          <Col xs={24} md={8}>
            {/* ⚠️ 签到金额用主色蓝而非涨红：这是「领取本金」的操作引导，
                不是投资收益。用红色会让人误以为赚了钱 */}
            <StatBig
              label={checkinStatus.checkedToday ? "明天可领" : "今天可领"}
              value={centsToYuan(checkinStatus.nextReward)}
              suffix="元"
              size={24}
              color={COLOR.primary}
            />
            <Progress
              percent={Math.round((checkinStatus.nextReward / CHECKIN_MAX_CENTS) * 100)}
              size="small"
              showInfo={false}
              style={{ marginTop: 8 }}
              // ⚠️ strokeColor 必须显式传，不能删。
              // antd 在 percent >= 100 且未显式传 status 时会自动切成
              // status="success"（antd/lib/progress/progress.js:66-68），
              // 进度条变**绿** —— 而绿色在本项目专属「跌」。
              // 连签封顶正是 percent === 100，会渲染出一条绿色进度条，读作亏损。
              strokeColor={COLOR.primary}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              连签递增，每天 +50 元，封顶 500 元
            </Text>
          </Col>
          <Col xs={24} md={8}>
            <StatBig
              label="累计签到入金"
              value={centsToYuan(checkinStatus.totalCheckin)}
              suffix="元"
              size={24}
            />
            <fetcher.Form method="post" style={{ marginTop: 12 }}>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                block
                loading={signing}
                disabled={checkinStatus.checkedToday}
              >
                {checkinStatus.checkedToday ? "今日已签到" : "立即签到"}
              </Button>
            </fetcher.Form>
          </Col>
        </Row>
      </SectionCard>
```

⚠️ **`Progress` 的 `strokeColor` 必须保留（改为 `COLOR.primary`），不能删。**
我最初写的是「去掉 `strokeColor` —— 不传就用主色蓝，正是我们要的」，**那句是错的**：
antd 的 `Progress` 在 `percent >= 100` 且未显式传 `status` 时会自动切成
`status="success"`（见 `antd/lib/progress/progress.js:66-68` 的
`!ProgressStatuses.includes(status) && percentNumber >= 100` 分支），进度条变**绿**。
连签封顶正是 `percent === 100` —— 在红涨绿跌的体系里，一条绿色进度条读作亏损。
旧代码用 `strokeColor` 压住了这个行为，删掉它就是引入回归。

- [ ] **Step 5: 换持仓速览与最近订单**

把第 190-318 行（两个 `<Card>`）替换为：

```tsx
      {/* 持仓速览 */}
      <SectionCard title="我的持仓" extra={<a href="/me/holdings">管理持仓 →</a>}>
        {holdings.length === 0
          ? (
              <EmptyState description="还没有持仓">
                <Button type="primary" href="/funds">
                  去挑一只基金
                </Button>
              </EmptyState>
            )
          : (
              // 与公开盘用同一个 note 渲染器：速览也必须标注估值时点，
              // 否则「总资产/持仓市值/浮动盈亏」三个大数字不知是哪天的估值。
              <HoldingList holdings={holdings} renderNote={navDateNote} />
            )}
      </SectionCard>

      {/* 最近订单 */}
      <SectionCard title="最近订单" extra={<a href="/me/orders">全部订单 →</a>}>
        {orders.length === 0
          ? (
              <EmptyState description="还没有交易记录" />
            )
          : (
              <OrderList orders={orders} />
            )}
      </SectionCard>
```

同时删掉第 2 行不再需要的类型 import：

```tsx
import type { HoldingView } from "~/services/portfolio-service";
```

以及第 19 行 import 里不再用到的 `navToDisplay` 与 `sharesToDisplay`
（`HoldingList` 内部自己格式化）—— 改为：

```tsx
import { centsToYuan } from "~/domain/money";
```

- [ ] **Step 6: 换标题里的「主人」Tag 颜色**

第 83 行：

```tsx
          {user.role === "admin" && <Tag color="blue" style={{ marginLeft: 8 }}>主人</Tag>}
```

- [ ] **Step 7: 校验**

```bash
pnpm typecheck
pnpm lint
git grep -n "c62828\|2e7d32" -- app/routes/me._index.tsx
```

最后一条必须**无输出**（本文件 8 处旧色值清零）。

- [ ] **Step 8: 视觉验收**

打开 `http://localhost:5173/me`，确认：

- 「总资产」32px 最大，其余三个 24px
- 「浮动盈亏」带红/绿色，副行「收益率 x.xx%」
- 签到的「今天可领」数字是**蓝色**（不是红色），进度条也是蓝色
- **点「立即签到」能真的签到成功**，成功 Alert 是绿色（不是红色 —— 验证
  Task 1 没把 `colorSuccess` 改掉）
- 持仓与最近订单都是卡片行，无横向滚动
- 两张卡片右上角「管理持仓 →」「全部订单 →」链接是蓝色且可点

- [ ] **Step 9: Commit**

```bash
git add app/routes/me._index.tsx
git commit -m "feat(ui): 我的仪表盘卡片化，清掉 8 处旧色值

两处 Table 换成 HoldingList / OrderList，Statistic 全换 StatBig，
删掉本文件第三份 pnlColor 副本。

签到金额从红色改主色蓝：那是「领本金」的操作引导，不是投资收益，
用红色会让人误以为赚了钱。Progress 的 strokeColor 改成 COLOR.primary
（不能删，percent 满 100 时 antd 会自动变绿）。「主人」Tag 从红改蓝。"
```

---

## Task 9: 公开盘与首页卡片化

`master.tsx` 是最后一个还有 `Table` 的文件（3 处），且 `_index.tsx` 的
「最近操作」块也要按 3.4 的降噪规则改。

**Files:**
- Create: `app/components/TxList.tsx`
- Modify: `app/routes/master.tsx:1-299`
- Modify: `app/routes/_index.tsx:1-222`

**Interfaces:**
- Consumes: `OrderList`（Task 5）、`DcaPlanList`（Task 6）、`HoldingListReadonly`（Task 4）、`~/theme`（Task 1）
- Produces: `TxList(props: { txs: TransactionView[] })`

- [ ] **Step 1: 写 `app/components/TxList.tsx`**

```tsx
import type { TransactionView } from "~/services/portfolio-service";
import { Tag } from "antd";
import { centsToYuan } from "~/domain/money";
import { COLOR, NUM_FONT, pnlColor } from "~/theme";

/** 流水类型的中文与配色。⚠️ 不用红绿——红绿专属涨跌，这里是资金流向分类 */
const TX_TYPE_MAP: Record<TransactionView["type"], { color: string; text: string }> = {
  init: { color: "blue", text: "初始本金" },
  checkin: { color: "gold", text: "签到奖励" },
  buy: { color: "geekblue", text: "申购" },
  sell: { color: "cyan", text: "赎回到账" },
  fee: { color: "volcano", text: "手续费" },
};

export interface TxListProps {
  txs: TransactionView[];
}

/**
 * 资金流水列表。取代 master.tsx 里 5 列的 <Table<TransactionView>>。
 *
 * 每行：左侧类型 Tag + 时间 + 备注，右侧金额（正入账红、负出账绿）与变动后余额。
 * 这里复用 pnlColor 是合适的 —— 资金的「进」与「出」和涨跌同一套红绿语义。
 */
export function TxList({ txs }: TxListProps) {
  return (
    <div>
      {txs.map((t, i) => {
        const m = TX_TYPE_MAP[t.type];
        return (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "12px 0",
              borderBottom:
                i === txs.length - 1 ? undefined : `1px solid ${COLOR.border}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>
                <Tag color={m.color}>{m.text}</Tag>
                <span style={{ fontSize: 13, color: COLOR.textPrimary }}>
                  {t.note}
                </span>
              </div>
              <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
                {new Date(t.createdAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </div>
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div
                style={{
                  fontFamily: NUM_FONT,
                  fontSize: 15,
                  color: pnlColor(t.amount),
                }}
              >
                {t.amount > 0 ? "+" : ""}
                {centsToYuan(t.amount)}
              </div>
              <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
                {`余额 ${centsToYuan(t.balance)}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 改造 `app/routes/master.tsx`**

把第 1-21 行替换为：

```tsx
import type { Route } from "./+types/master";
import { Space, Tabs, Tag, Typography } from "antd";
import { DcaPlanList } from "~/components/DcaPlanList";
import { OrderList } from "~/components/OrderList";
import {
  AdminNotReady,
  HoldingListReadonly,
  PortfolioSummary,
} from "~/components/PortfolioView";
import { TxList } from "~/components/TxList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAppContext } from "~/services/context";
import { getAdminUser } from "~/services/guard";
import {
  getDcaPlans,
  getOrders,
  getPortfolio,
  getTransactions,
} from "~/services/portfolio-service";

const { Title, Paragraph } = Typography;
```

删掉第 52-68 行的 `TX_TYPE_MAP`、`WEEKDAY_LABEL`、`frequencyText`
（三者都已迁进 `TxList.tsx` / `DcaPlanList.tsx`）。

把第 89-91 行的「公开」Tag 改成蓝色：

```tsx
          <Tag color="blue" style={{ marginLeft: 8 }}>
            公开
          </Tag>
```

把第 98-296 行（两个 `<Card>`，含 `Tabs` 与三张表）替换为：

```tsx
      <SectionCard>
        <PortfolioSummary portfolio={portfolio} />
      </SectionCard>

      <SectionCard>
        <Tabs
          items={[
            {
              key: "holdings",
              label: `持仓（${portfolio.holdings.length}）`,
              children: <HoldingListReadonly holdings={portfolio.holdings} />,
            },
            {
              key: "dca",
              label: `定投计划（${plans.length}）`,
              children:
                plans.length === 0
                  ? <EmptyState description="暂无定投计划" />
                  : <DcaPlanList plans={plans} />,
            },
            {
              key: "orders",
              label: `交易记录（${orders.length}）`,
              children:
                orders.length === 0
                  ? <EmptyState description="暂无交易记录" />
                  : <OrderList orders={orders} />,
            },
            {
              key: "txs",
              label: `资金流水（${txs.length}）`,
              children:
                txs.length === 0
                  ? <EmptyState description="暂无流水" />
                  : <TxList txs={txs} />,
            },
          ]}
        />
      </SectionCard>
```

⚠️ 三处 `pagination={{ pageSize: 15 }}` 随表格一起没了。loader 上限是
orders 50 / txs 50 / plans 全量，卡片列表一次渲染完全可以接受。

- [ ] **Step 3: 改造 `app/routes/_index.tsx`**

Task 4 已经把 `HoldingTableReadonly` 改名，这里只剩三件事。

**3a. 改 import。** 把第 2-10 行的 antd import 替换为这一行（`Card` **保留** ——
理由见 3b）：

```tsx
import { Button, Card, Col, Row, Space, Tag, Typography } from "antd";
```

在第 15 行 `} from "~/components/PortfolioView";` 之后插入：

```tsx
import { OrderList } from "~/components/OrderList";
import { SectionCard } from "~/components/ui/SectionCard";
```

第 23 行的 `const { Title, Paragraph, Text } = Typography;` **不动** ——
`Text` 在头图文案（第 96、105 行）里还在用。

**3b. 只把两处 `Card` 换成 `SectionCard`。** 本文件有 4 处 `<Card>`：

| 位置 | 处理 | 理由 |
| ---- | ---- | ---- |
| 第 89 行 头图 | → `SectionCard` | 需要统一阴影 |
| 第 146 行 主人的盘 | → `SectionCard` | 需要标题栏 + `extra` 链接 |
| 第 197 行 卖点栅格 | **保留 `Card`** | 带 `className="h-full"`，而 `SectionCard` 不透传 className |
| 第 210 行 底部 CTA | **保留 `Card`** | 带 `className="text-center"`，同上 |

前两处把开闭标签都改掉（`<Card` → `<SectionCard`、`</Card>` → `</SectionCard>`），
标签上的 `title` / `extra` 属性原样保留。

**3c. 「公开」Tag 改蓝 + 「最近操作」块降噪。**

第 150-152 行：

```tsx
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    公开
                  </Tag>
```

第 162-189 行的整个「最近操作」块替换为（按 3.4 降噪，不再手工堆 Tag）：

```tsx
              {loaderData.orders.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <Title level={5}>最近操作</Title>
                  <OrderList orders={loaderData.orders.slice(0, 5)} />
                </div>
              )}
```

- [ ] **Step 4: 校验**

```bash
pnpm typecheck
pnpm lint
git grep -n "c62828\|2e7d32" -- app/
git grep -n "HoldingTableReadonly" -- app/
```

后两条必须**均无输出**。

- [ ] **Step 5: 视觉验收**

打开 `http://localhost:5173/master`，确认：

- 四个 Tab 都能切，内容全是卡片列表，**无横向滚动**
- 「资金流水」Tab：左侧类型 Tag + 备注 + 时间，右侧金额（入账红/出账绿）+ 余额
- 「公开」Tag 是蓝色

打开 `http://localhost:5173/`，确认：

- 头图与「主人的示范盘」卡片有统一阴影、12 圆角
- 「最近操作」是订单卡片行（不再是一串堆叠的 Tag）
- 4 个卖点卡片仍是等高栅格（`className="h-full"` 生效）

- [ ] **Step 6: Commit**

```bash
git add app/components/TxList.tsx app/routes/master.tsx app/routes/_index.tsx
git commit -m "feat(ui): 公开盘与首页卡片化，清空最后 3 处 Table

新增 TxList 取代 master.tsx 的 5 列资金流水表。
master.tsx 的定投/订单/流水三张表全部换成列表组件，
并删掉本地的 TX_TYPE_MAP / WEEKDAY_LABEL / frequencyText
（后两个与 me.dca.tsx 重复实现，已统一到 DcaPlanList）。

_index.tsx 的「最近操作」改用 OrderList，
不再手工堆 Tag（原来一行最多贴 4 个）。

「公开」「主人」等身份 Tag 一律从红改蓝——红色专属涨跌。
头图与主人盘用 SectionCard；卖点栅格与底部 CTA 保留裸 Card，
因为它们需要 className 而 SectionCard 不透传。"
```

---

## Task 10: 详情页与两个抽屉

最后一批旧色值在 `funds.$code.tsx`（1 处）与 `SellDrawer.tsx`（2 处）。
顺便把 `NavChart` 的 `Radio.Group` 换成 `PeriodTabs`（期四的阶段涨幅表要复用它）。

**Files:**
- Create: `app/components/ui/PeriodTabs.tsx`
- Modify: `app/components/NavChart.tsx:1-137`
- Modify: `app/routes/funds.$code.tsx:1-281`
- Modify: `app/components/BuyDrawer.tsx:88-110`
- Modify: `app/components/SellDrawer.tsx:110-129, 231-252`

**Interfaces:**
- Consumes: `StatBig` / `DataRow` / `SectionCard`（Task 2）、`~/theme`（Task 1）
- Produces: `PeriodTabs(props: { options: readonly { key: string; label: string }[]; value: string; onChange: (key: string) => void; size?: "small" | "middle" | "large" })`

- [ ] **Step 1: 写 `app/components/ui/PeriodTabs.tsx`**

```tsx
import { Segmented } from "antd";

export interface PeriodOption {
  key: string;
  label: string;
}

export interface PeriodTabsProps {
  options: readonly PeriodOption[];
  value: string;
  onChange: (key: string) => void;
  size?: "small" | "middle" | "large";
}

/**
 * 时间范围切换。用 Segmented 而非 Radio.Group ——
 * Segmented 带滑块背景，是 antd 里视觉最接近支付宝那排周期切换的组件。
 *
 * 期四的阶段涨幅表会复用它，所以做成通用组件而非写死在 NavChart 里。
 */
export function PeriodTabs({ options, value, onChange, size = "small" }: PeriodTabsProps) {
  return (
    <Segmented
      size={size}
      value={value}
      onChange={v => onChange(String(v))}
      options={options.map(o => ({ label: o.label, value: o.key }))}
    />
  );
}
```

- [ ] **Step 2: 改 `app/components/NavChart.tsx`**

把第 2 行改为（去掉 `Radio`）：

```tsx
import { Empty } from "antd";
```

在第 4 行 `import { NAV_SCALE } from "~/domain/money";` 之前插入：

```tsx
import { PeriodTabs } from "~/components/ui/PeriodTabs";
```

把第 117-125 行的 `<Radio.Group … />` 替换为：

```tsx
      <div style={{ marginBottom: 16 }}>
        <PeriodTabs
          options={RANGES.map(r => ({ key: r.key, label: r.label }))}
          value={range}
          onChange={setRange}
        />
      </div>
```

`ChartSkeleton` 里的 `rgba(0,0,0,.06)` 等值**保留** —— 那是骨架屏的渐变动画，
不是语义色，且必须与 antd 的 `ant-skeleton-loading` 关键帧对齐。

- [ ] **Step 3: 改 `app/routes/funds.$code.tsx`**

把第 3-12 行的 antd import 替换为：

```tsx
import { Alert, Button, Space, Tag, Typography } from "antd";
```

在第 24 行 `import { placeBuyOrder } from "~/services/trade";` 之后插入：

```tsx
import { DataRow } from "~/components/ui/DataRow";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { pnlColor } from "~/theme";
```

把第 157-164 行的 `RISK_MAP` 替换为：

```tsx
/**
 * 风险等级对应的颜色与说明。
 *
 * ⚠️ 刻意避开红与绿：低风险不用 green、高风险不用 red ——
 * 那两个颜色现在专属涨跌，拿来表示风险会让用户
 * 把「高风险」误读成「在涨」。改用蓝→金→橙的暖度递进。
 */
const RISK_MAP: Record<number, { color: string; label: string }> = {
  1: { color: "blue", label: "低风险" },
  2: { color: "cyan", label: "中低风险" },
  3: { color: "gold", label: "中风险" },
  4: { color: "orange", label: "中高风险" },
  5: { color: "volcano", label: "高风险" },
};
```

把第 176-228 行的整个头部 `<Card>…</Card>` 替换为：

```tsx
      <SectionCard>
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Space align="baseline" wrap>
            <Title level={3} style={{ margin: 0 }}>
              {f.name}
            </Title>
            <Text type="secondary">{f.code}</Text>
            {f.type && <Tag>{f.type}</Tag>}
            <Tag color={risk.color}>{risk.label}</Tag>
            <Tag color={f.status.includes("开放") ? "blue" : "default"}>{f.status}</Tag>
          </Space>

          <Space size={48} wrap style={{ marginTop: 8 }}>
            <StatBig
              label={`单位净值${latest ? `（${latest.navDate}）` : ""}`}
              value={latest ? navToDisplay(latest.unitNav) : "—"}
            />
            <StatBig
              label="日涨跌"
              value={`${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(2)}`}
              suffix="%"
              size={24}
              color={pnlColor(growthPct)}
            />
            <StatBig
              label="申购费率"
              value={rateToPercent(f.purchaseRate)}
              size={24}
            />
            <StatBig
              label="起购金额"
              value={centsToYuan(f.minPurchase)}
              suffix="元"
              size={24}
            />
          </Space>

          <Space style={{ marginTop: 8 }}>
            {isLoggedIn
              ? (
                  <Button
                    type="primary"
                    size="large"
                    onClick={() => setBuyOpen(true)}
                    disabled={!latest}
                  >
                    买入
                  </Button>
                )
              : (
                  <Button type="primary" size="large" href="/register">
                    注册后即可买入
                  </Button>
                )}
            <Button size="large" href="/funds">
              继续搜索
            </Button>
          </Space>
        </Space>
      </SectionCard>
```

⚠️ 「日涨跌」这里传 `pnlColor(growthPct)`。注意 `growthPct` 为 0 时旧代码
显示红色（因为 `>= 0`），新代码显示灰色 —— **这是有意的修正**：
0 涨跌就是没涨没跌，标红是错的。

把第 230-232 行的净值走势卡片改为：

```tsx
      <SectionCard title="净值走势">
        <NavChart data={series} />
      </SectionCard>
```

把第 234-254 行的赎回费率阶梯卡片替换为：

```tsx
      <SectionCard title="赎回费率阶梯">
        <Paragraph type="secondary">
          赎回按
          <Text strong>份额批次先进先出</Text>
          逐批计费，每批按各自的持有天数查下表档位。
          所以一笔赎回可能同时按多个费率计费。
        </Paragraph>
        {f.redeemTiers.map((t, i) => (
          <DataRow
            key={i}
            label={
              t.maxDays === null
                ? `持有满 ${t.minDays} 天`
                : `持有 ${t.minDays} ~ 不满 ${t.maxDays} 天`
            }
            value={rateToPercent(t.rate)}
            last={i === f.redeemTiers.length - 1}
          />
        ))}
      </SectionCard>
```

- [ ] **Step 4: 改 `app/components/BuyDrawer.tsx`**

把第 1-5 行的 antd import 里的 `Descriptions` 去掉（其余保留），
并在 `~/domain/money` import 之后插入：

```tsx
import { DataRow } from "~/components/ui/DataRow";
```

把第 88-110 行的 `<Descriptions … />` 替换为：

```tsx
        <div style={{ marginBottom: 16 }}>
          <DataRow label="基金代码" value={fundCode} />
          <DataRow
            label="最新净值"
            value={
              navScaled > 0
                ? `${navToDisplay(navScaled)}${navDate ? `（${navDate}）` : ""}`
                : "暂无"
            }
          />
          <DataRow label="申购费率" value={rateToPercent(purchaseRate)} />
          <DataRow label="起购金额" value={`${centsToYuan(minPurchaseCents)} 元`} />
          <DataRow
            label="可用现金"
            value={cashCents === null ? "请先登录" : `${centsToYuan(cashCents)} 元`}
            last
          />
        </div>
```

- [ ] **Step 5: 改 `app/components/SellDrawer.tsx`**

从 antd 的 import 里去掉 `Descriptions`（其余保留，**`Table` 必须留着** ——
FIFO 明细表不动）。在第 22 行 `import { calcRedeem } from "~/domain/redeem";` 之后插入：

```tsx
import { DataRow } from "~/components/ui/DataRow";
import { COLOR, pnlColor } from "~/theme";
```

**5a. 把第 110-129 行的 `<Descriptions … />` 替换为：**

```tsx
        <div style={{ marginBottom: 16 }}>
          <DataRow label="基金代码" value={fundCode} />
          <DataRow
            label="最新净值"
            value={`${navToDisplay(navScaled)}${navDate ? `（${navDate}）` : ""}`}
          />
          <DataRow
            label="可赎份额"
            value={`${sharesToDisplay(availableSharesScaled)} 份`}
          />
          <DataRow label="预计确认日" value={confirmDate} last />
        </div>
```

⚠️ 这一步是预扫补的：`BuyDrawer` 换了 `DataRow` 而 `SellDrawer` 不换，
两个孪生抽屉会一个新一个旧，视觉不一致。spec 第 4 节把 `DataRow` 定为
「取代 `Descriptions` 的滥用」，两个抽屉必须同构。

**5b. 第 231-238 行「预计到账」：**

```tsx
                <div>
                  预计到账：
                  <Text strong style={{ color: COLOR.primary }}>
                    {centsToYuan(estimate.totalNetCents)}
                    {" "}
                    元
                  </Text>
                </div>
```

⚠️ 「预计到账」从红改成主色蓝 —— 那是个金额提示，不是盈亏。

**5c. 第 239-252 行「已实现盈亏」：**

```tsx
                <div>
                  已实现盈亏：
                  <Text
                    strong
                    style={{ color: pnlColor(estimate.realizedPnlCents) }}
                  >
                    {estimate.realizedPnlCents > 0 ? "+" : ""}
                    {centsToYuan(estimate.realizedPnlCents)}
                    {" "}
                    元
                  </Text>
                </div>
```

第 182-214 行的 FIFO 逐批费用明细 `<Table>` **保留不动**（见设计文档 4.0：
它是真正的表格数据，同维度多行横向对比，换卡片反而更难读）。

- [ ] **Step 6: 校验**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 7: 视觉验收**

打开 `http://localhost:5173/funds/161725`，确认：

- 「单位净值」32px 最大，其余三个 24px，全等宽字体
- 「日涨跌」带红/绿色与 +/− 号
- 风险 Tag 不是绿色也不是红色（应为蓝/青/金/橙/朱红之一）
- 净值走势图上方的周期切换是**带滑块的 Segmented**（不再是一排单选按钮），
  切换「近 1 月/3 月/1 年/全部」图表能变
- 「赎回费率阶梯」是若干「左标签右费率」的行，最后一行无分割线
- 点「买入」，抽屉里基金信息是 5 行 DataRow，输入金额能看到费用预估
- 去 `/me/holdings` 点「赎回」，抽屉里 FIFO 明细**仍是表格**，
  「预计到账」是蓝色，「已实现盈亏」按正负变红/绿

- [ ] **Step 8: Commit**

```bash
git add app/components/ui/PeriodTabs.tsx app/components/NavChart.tsx app/routes/funds.\$code.tsx app/components/BuyDrawer.tsx app/components/SellDrawer.tsx
git commit -m "feat(ui): 详情页与买卖抽屉换新视觉，清空最后 3 处旧色值

新增 PeriodTabs（Segmented 实现，带滑块，比 Radio.Group 更接近支付宝），
NavChart 改用它；期四的阶段涨幅表也会复用。

funds.\$code.tsx：Statistic → StatBig、Descriptions → DataRow。
风险等级配色刻意避开红绿（低风险原本用 green、高风险用 red），
改蓝→青→金→橙→朱红的暖度递进——否则「高风险」会被误读成「在涨」。
「日涨跌」为 0 时从红色改灰色：不涨不跌标红是错的。

SellDrawer 的「预计到账」从红改主色蓝（那是金额提示不是盈亏）；
FIFO 逐批费用明细表按设计文档 4.0 保留表格结构。"
```

---

## Task 11: 收尾验收

**Files:**
- Modify: `app/uno.gen.css`（由 `pnpm uno:build` 生成，不手改）
- Modify: `docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md`（勾掉期一）

- [ ] **Step 1: 重新生成 UnoCSS 产物**

```bash
pnpm uno:build
git diff --stat app/uno.gen.css
```

前面几个任务动过 `className`（`_index.tsx` 的 `h-full` / `text-center` 仍在用），
且 Task 1 改了 `shortcuts` 与 `theme.colors` 的色值，产物必须重新生成。

- [ ] **Step 2: 补两条测试硬化断言**

Task 1 的 review 发现现有守卫有两个洞，在这里补上。

**2a.** `tests/smoke.test.ts` 的「视觉 token 不变式」describe 块里追加：

```ts
  it("送进 antd 的主色必须就是 COLOR.primary（防止硬写色值绕过上面那条断言）", () => {
    const token = ANTD_TOKEN.token as Record<string, unknown>;
    expect(token.colorPrimary).toBe(COLOR.primary);
  });
```

⚠️ 为什么需要它：上面那条「主色不能与涨色相同」断言的是 `COLOR.primary`，
但真正渲染按钮的是 `ANTD_TOKEN.token.colorPrimary`。若有人硬写
`colorPrimary: "#F5222D"` 而留着 `COLOR.primary` 是蓝的，**9 条测试全绿，
所有按钮变红** —— 正是整期要防的那个 bug。今天两者靠引用相连才没出事，
这条断言把这个「靠巧合成立」变成「被强制成立」。

**2b.** 同一个 describe 块里追加（文件顶部需要 `import { readFileSync } from "node:fs";`）：

```ts
  it("uno.config.ts 的镜像色值必须与 theme.ts 一致", () => {
    // uno.config.ts 引入 unocss preset，无法在 node 测试环境 import，
    // 只能按文本读。这是 spec 自己标为隐患的手工镜像——
    // 原本只靠一句「改色时两处都要改」的注释，而注释强制不了任何东西。
    const src = readFileSync("uno.config.ts", "utf8");
    expect(src).toContain(COLOR.primary);
    expect(src).toContain(COLOR.up);
    expect(src).toContain(COLOR.down);
  });
```

跑 `pnpm test tests/smoke.test.ts`，预期 **11/11 passing**（原 9 + 新 2）。

**做一次变异检查证明 2b 有效**：把 `uno.config.ts` 里的 `text-rise` 色值临时改成
`text-[#c62828]` → 跑测试 → 2b 必须变红；改回 `text-[#F5222D]` → 必须变绿。
两次输出记进报告。

- [ ] **Step 3: 全量校验**

```bash
pnpm verify
```

这一条等价于 `pnpm lint && pnpm typecheck && pnpm test`，必须**全绿**。

- [ ] **Step 4: 旧色值清零检查**

```bash
git grep -n "c62828" ; git grep -n "2e7d32"
```

**两条都必须无输出。** 若 `uno.config.ts` 还有残留，说明 Task 1 Step 4 没做完。

- [ ] **Step 5: 死代码检查**

```bash
git grep -n "HoldingTableReadonly"
git grep -n -- '<Table' -- app/
```

第一条必须**无输出**。第二条必须**只有 1 行**，且是
`app/components/SellDrawer.tsx`（FIFO 逐批费用明细表，按设计文档 4.0 有意保留）。

顺便确认这三个已收敛的符号不再有重复定义：

```bash
git grep -n "function pnlColor"        # 应只剩 app/theme.ts 一处
git grep -n "function frequencyText"   # 应只剩 app/components/DcaPlanList.tsx 一处
git grep -n "TX_TYPE_MAP"             # 应只剩 app/components/TxList.tsx 一处
```

- [ ] **Step 6: 逐页回归**

`pnpm dev` 后**登录**并依次打开，确认功能未退化（期一承诺「功能一行不改」）：

| 页面 | 必须能用 |
| ---- | -------- |
| `/` | 头图按钮跳转、主人的盘持仓与最近操作可见 |
| `/funds` | 搜索出结果、点进详情 |
| `/funds/161725` | 净值图渲染、周期切换、点「买入」下单成功 |
| `/master` | 四个 Tab 都能切换且有内容 |
| `/me` | 签到成功、两张速览卡片有数据 |
| `/me/holdings` | 「加仓」「赎回」抽屉都能打开并下单 |
| `/me/orders` | 新下的单出现在列表、待确认有橙 Tag |
| `/me/dca` | 新建计划、暂停/启用、删除 |
| `/me/settings` | 改密码（改完记得改回来）|

⚠️ 特别验证 **antd 语义色没被污染**：签到成功的 Alert 必须是**绿色**，
下单金额低于起购时的警告必须是**橙色**，现金不足的错误必须是**红色**。
若成功变红或错误变绿，说明 `ANTD_TOKEN` 里错误地映射了 `colorSuccess` / `colorError`。

- [ ] **Step 7: 勾掉设计文档里的期一**

在 `docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md` 的
「### 期一 · 视觉地基」标题后加上完成标记：

```markdown
### 期一 · 视觉地基（不加功能，纯改观感）✅ 已完成
```

- [ ] **Step 8: Commit**

```bash
git add app/uno.gen.css docs/superpowers/specs/2026-08-25-alipay-style-refactor-design.md
git commit -m "chore(ui): 期一收尾——重新生成 UnoCSS 产物并验收

pnpm verify 全绿。旧色值 #c62828 / #2e7d32 全仓清零。
11 处 Table 只剩 SellDrawer 的 FIFO 明细表（按设计文档 4.0 有意保留）。
pnlColor / frequencyText / TX_TYPE_MAP 三个重复实现各收敛为唯一定义。

逐页回归通过，功能无退化；antd 语义色未被涨跌色污染
（成功 Alert 仍绿、错误 Alert 仍红）。"
```

---

## Task 12: 金额显示扫尾（修回归）

> 本任务是 Task 2 的 review 发现后追加的。**它修的是期一自己制造的回归，不是润色。**

**背景**：antd 的 `Statistic` 自带 `groupSeparator`，会把 `10000.00` 渲染成
`10,000.00`。期一把 22 处 `Statistic` 换成 `StatBig` 之后，这个能力全部丢失 ——
总资产、持仓市值、可用现金、初始本金全变成难读的长串数字。
用户当初批准的效果图上写的是 `128,450.66`，实际会渲染成 `128450.66`。

同源的第二个问题：`DataRow` 的 `value` 用比例字体渲染，而它的多数用途是数字
（设置页 3 个金额、`BuyDrawer` 5 行、`SellDrawer` 4 行、赎回费率阶梯）。
一列堆叠的金额纵向对不齐 —— 正是 `NUM_FONT` 存在的理由。

**⚠️ 绝不能把千分位加进 `centsToYuan`。** `app/components/BuyDrawer.tsx` 的
「全部」快捷按钮把 `centsToYuan(cashCents)` 的结果直接塞进金额 `Input` 的 value，
该值随后走 `Number()` / `yuanToCents()`。一旦变成 `"100,000.00"`，
`Number()` 得到 `NaN`，action 判「请输入正确的金额」——**买入功能当场坏掉**。
千分位只能做在展示层。

**Files:**
- Create: `app/components/ui/format.ts`
- Modify: `app/components/ui/DataRow.tsx`（加 `mono` prop）
- Modify: 所有把金额喂给 `StatBig` / 列表组件的调用点（见 Step 3 清单）

**Interfaces:**
- Consumes: `centsToYuan`（`~/domain/money`）、`NUM_FONT`（`~/theme`）
- Produces:
  - `fmtYuan(cents: number): string` —— 带千分位的金额展示字符串
  - `DataRow` 新增 `mono?: boolean`

- [ ] **Step 1: 写 `app/components/ui/format.ts`**

```ts
import { centsToYuan } from "~/domain/money";

/**
 * 金额（分）→ 带千分位的展示字符串，如 12845066 → "128,450.66"。
 *
 * ⚠️ 为什么不直接改 `centsToYuan`：它的返回值会被塞进输入框
 * （`BuyDrawer` 的「全部」快捷按钮 → `Input` 的 value → `Number()` / `yuanToCents()`），
 * 带逗号会让 `Number()` 得到 NaN，下单直接失败。
 * 所以 `centsToYuan` 保持机器可读，千分位只在展示层加。
 *
 * 这个函数纯字符串处理，不参与任何金额运算 ——
 * 精度铁律不受影响（运算仍在 domain 层用 decimal.js 完成）。
 */
export function fmtYuan(cents: number): string {
  const plain = centsToYuan(cents);
  const negative = plain.startsWith("-");
  const body = negative ? plain.slice(1) : plain;
  const [intPart, decPart] = body.split(".");
  // 从右往左每 3 位插一个逗号
  const grouped = intPart.replace(/\B(?=(\d{3})+$)/g, ",");
  return `${negative ? "-" : ""}${grouped}.${decPart}`;
}
```

- [ ] **Step 2: 写单测（本任务有真实逻辑，走 TDD）**

新建 `tests/domain/format.test.ts`（放 `tests/domain/` 是因为
`vitest.config.ts` 只 include `tests/domain/**` 与 `tests/smoke.test.ts`；
该文件不依赖 DOM，node 环境即可跑）：

```ts
import { describe, expect, it } from "vitest";
import { fmtYuan } from "~/components/ui/format";

describe("fmtYuan 千分位", () => {
  it("四位数以上插逗号", () => {
    expect(fmtYuan(1000000)).toBe("10,000.00");
    expect(fmtYuan(12845066)).toBe("128,450.66");
    expect(fmtYuan(100000000)).toBe("1,000,000.00");
  });

  it("三位数及以下不插", () => {
    expect(fmtYuan(0)).toBe("0.00");
    expect(fmtYuan(99999)).toBe("999.99");
  });

  it("负数的逗号插在数字里而不是符号后", () => {
    expect(fmtYuan(-12845066)).toBe("-128,450.66");
    expect(fmtYuan(-100)).toBe("-1.00");
  });

  it("恰好千位边界", () => {
    expect(fmtYuan(99999 + 1)).toBe("1,000.00");
  });
});
```

先跑 `pnpm test tests/domain/format.test.ts` 确认 RED（模块不存在或断言失败），
再写实现，再跑确认 GREEN。两次输出记进报告。

- [ ] **Step 3: 给 `DataRow` 加 `mono` prop**

`app/components/ui/DataRow.tsx` 的 `DataRowProps` 追加：

```ts
  /**
   * 数值用等宽字体渲染。金额/净值/份额/费率一律传 true ——
   * 比例字体下 "1" 比 "8" 窄，一列堆叠的数字会纵向对不齐，
   * 这正是 NUM_FONT 存在的理由。
   */
  mono?: boolean;
```

函数签名改为 `{ label, value, last, mono }`，并把 value 那个 `<span>` 的
style 改为：

```tsx
      <span
        style={{
          fontSize: 14,
          color: COLOR.textPrimary,
          textAlign: "right",
          fontFamily: mono ? NUM_FONT : undefined,
        }}
      >
        {value}
      </span>
```

顶部 import 改为 `import { COLOR, NUM_FONT } from "~/theme";`。

- [ ] **Step 4: 把展示层的 `centsToYuan` 换成 `fmtYuan`**

⚠️ **只换展示位置。** 凡是结果会进入 `Input` value、`fetcher.submit` 载荷、
或任何后续要 `Number()` / `yuanToCents()` 的地方，**必须保持 `centsToYuan`**。

逐文件执行，每个文件改完立刻 `pnpm typecheck`：

| 文件 | 换成 `fmtYuan` 的位置 | 必须保留 `centsToYuan` 的位置 |
| ---- | -------------------- | ---------------------------- |
| `app/components/ui/PnlText.tsx` | 内部格式化金额那处 | — |
| `app/components/HoldingList.tsx` | 市值 `primary` | — |
| `app/components/OrderList.tsx` | 委托金额、成交金额、手续费 | — |
| `app/components/DcaPlanList.tsx` | 每期金额、累计投入 | — |
| `app/components/TxList.tsx` | 金额、变动后余额 | — |
| `app/components/PortfolioView.tsx` | 4 个 `StatBig` 的 value | — |
| `app/routes/me._index.tsx` | 4 个资产 `StatBig` + 3 个签到 `StatBig` | — |
| `app/routes/me.holdings.tsx` | 3 个 `StatBig` + `renderNote` 里的成本 | — |
| `app/routes/me.dca.tsx` | 累计投入 `StatBig` | — |
| `app/routes/me.settings.tsx` | 3 个金额 `DataRow`（并传 `mono`）+ 重置后现金 `StatBig` + 警告文案里的初始本金 | — |
| `app/routes/funds.$code.tsx` | 起购金额 `StatBig` | — |
| `app/components/BuyDrawer.tsx` | 起购金额、可用现金的 `DataRow`（并传 `mono`）、费用预估的三个金额 | **`onClick={() => setAmountYuan(centsToYuan(cashCents))}` 与 `placeholder` 里的起购金额** —— 前者进输入框，后者是给用户照着输的参考值 |
| `app/components/SellDrawer.tsx` | FIFO 明细表的赎回费、赎回总额、赎回费合计、预计到账、已实现盈亏 | — |

`SellDrawer` / `BuyDrawer` / `funds.$code.tsx` / `me.settings.tsx` 的
数值型 `DataRow` 一律补 `mono`。

- [ ] **Step 5: 全量校验**

```bash
pnpm verify
git grep -n "centsToYuan" -- app/
```

第二条的输出逐行过一遍：每一处残留的 `centsToYuan` 都必须能说出「为什么这里
不能带千分位」（进输入框 / 进 placeholder / 在 `fmtYuan` 内部）。
说不出理由的就是漏改。

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/format.ts tests/domain/format.test.ts app/components app/routes
git commit -m "fix(ui): 恢复金额千分位，DataRow 数值改等宽

期一把 22 处 antd Statistic 换成 StatBig 时，顺带丢掉了 Statistic
自带的 groupSeparator——总资产/持仓市值/可用现金全变成难读的长串。
这是期一自己制造的回归，不是缺少润色。

千分位刻意不进 centsToYuan：BuyDrawer 的「全部」按钮把它的结果塞进
金额 Input，加逗号会让 Number() 得到 NaN，买入当场失败。
故新增展示层的 fmtYuan，机器可读的 centsToYuan 保持原样。

同源问题一并修：DataRow 的 value 此前用比例字体，而它多数用途是数字
（设置页 3 个金额、两个抽屉共 9 行），一列堆叠对不齐——加 mono prop。

fmtYuan 有真实字符串逻辑，配 TDD 单测覆盖千位边界与负数符号位置。"
```

---

## 期一完成后的状态

- 主色蓝、涨跌红绿分离，颜色有唯一出处 `app/theme.ts`
- `app/components/ui/` 8 个展示组件就位（7 个原定 + `format.ts`），期二至期四直接消费
- 4 个列表组件收敛掉 10 处重复的 `columns` 定义
- 三个重复实现（`pnlColor` ×3、`frequencyText` ×2、`TX_TYPE_MAP` ×1）各归一处
- 金额带千分位、数值列等宽对齐（Task 12 修掉了 `Statistic` → `StatBig` 丢失
  `groupSeparator` 造成的回归）
- **功能零变化**，纯观感与代码结构改善

**下一步**：期二「我的资产」——`app/domain/asset-timeline.ts` 的账本重放
（走 TDD，先写 `tests/domain/asset-timeline.test.ts`），
然后是资产走势曲线与收益日历。需要时再出期二的计划。
