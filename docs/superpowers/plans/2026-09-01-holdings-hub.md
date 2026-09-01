# 持仓详情页交易枢纽（Holdings Hub）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把持仓详情页重构成单只基金的全功能交易枢纽（Tabs：交易/定投/订单），撤单改单显眼化，订单页增加待确认委托区，持仓列表行内提供卖出深链。

**Architecture:** 纯 UI 重排 + 一个新查询函数 + 一个新组件；金融逻辑（下单/撤单/改单/撮合）一行不动。Tabs 状态进 URL search param 支持深链；定投页签复用 dca-service 与 /me/dca 的 intent 协议。

**Tech Stack:** React Router 8（loader/action/useFetcher/useSearchParams）、antd 5（Tabs/Modal/message）、Drizzle + D1、Vitest（workers 池跑 services 测试）。

**Spec:** `docs/superpowers/specs/2026-09-01-holdings-hub-design.md`

## Global Constraints

- 包管理器只用 **pnpm**；跑单个测试**不加 `--`**（`pnpm test tests/domain/x.test.ts`）
- services 层测试跑 `pnpm test:workers tests/services/<file>`（真实 D1）；domain 层跑 `pnpm test`
- 代码风格：双引号 + 分号 + 2 空格缩进（@antfu/eslint-config），**代码加合理中文注释**
- 金额整数分、份额 ×10000、净值 ×10000、费率万分之；中间运算 decimal.js——本计划不改金融计算，但别引入浮点算钱
- **一个 Task 一个 commit**，commit 前跑 `npx eslint --fix <改动的文件>`（不要全仓 lint:fix，工作区有用户保存的 html 垃圾文件会被扫）
- 分支：`feat/order-cancel-amend`（撤单/改单已在该分支，本计划叠加其上）；**不推送不合并**，主人发话才动
- 新增 class 若用到 UnoCSS 工具类，提交前跑 `pnpm uno:build`（`app/uno.gen.css` 入库勿手改）——本计划预计只用 antd 组件与内联 style，不需要

---

### Task 1: OrderActions 撤单/改单按钮显眼化

**Files:**
- Modify: `app/components/OrderActions.tsx`（Space 内两个按钮，约 106-113 行）

**Interfaces:**
- Consumes: 现有 `OrderActionsProps { order: OrderView }`，不变
- Produces: 组件对外契约不变（挂载处 `me.orders.tsx` / `me.holdings.$code.tsx` 无需改动）

- [ ] **Step 1: 把链接小字改为实底小按钮**

把 `app/components/OrderActions.tsx` 返回值里的按钮区（`<Space size={0}>` 那块）替换为：

```tsx
      {/* 实底小按钮：链接小字太隐蔽，主人反馈「撤单改单难发现」。
          仍放 note 行而非 FundListItem 的 actions 槽（对齐警告见 OrderList 注释） */}
      <Space size={8}>
        <Button size="small" disabled={submitting} onClick={openAmend}>
          改单
        </Button>
        <Button size="small" danger disabled={submitting} onClick={confirmCancel}>
          撤单
        </Button>
      </Space>
```

同时删掉原按钮区上方那段「放 note 行内而非 actions 槽」的旧注释（已被新注释替代）。

- [ ] **Step 2: lint + typecheck 验证**

Run: `npx eslint "app/components/OrderActions.tsx" && pnpm typecheck`
Expected: 均无报错

- [ ] **Step 3: Commit**

```bash
git add app/components/OrderActions.tsx
git commit -m "style(orders): 撤单/改单从链接小字升级为实底小按钮"
```

---

### Task 2: 持仓详情页 Tabs 骨架（交易/订单两页签 + URL 深链）

**Files:**
- Modify: `app/routes/me.holdings.$code.tsx`（组件 return 结构重排）

**Interfaces:**
- Consumes: 现有 loader 数据 `{ detail, cash, orders, confirmDate, today }`，不变
- Produces: URL 约定 `?tab=trade|dca|orders`（默认 trade）。Task 4 的 DcaFundPanel 挂进 `dca` 页签；Task 6 的持仓列表「卖出」深链 `?tab=trade`

- [ ] **Step 1: 引入 Tabs 与 URL 同步**

在 `app/routes/me.holdings.$code.tsx` 中：

antd 导入加 `Tabs`；react-router 导入：

```tsx
import { useSearchParams } from "react-router";
```

组件顶部（`MeHoldingDetail` 内）加：

```tsx
  // 页签状态进 URL（?tab=trade|dca|orders，默认 trade）：
  // 持仓列表「卖出」深链、外链直达订单页签都靠它。replace 避免每次切页签堆历史
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "trade";
  const setTab = (key: string) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", key);
        return p;
      },
      { replace: true },
    );
  };
```

- [ ] **Step 2: 重排组件 return**

保持「标题行 / 持仓概览 / 份额批次」三个 SectionCard 原样在顶部；把「加仓」「卖出」两个 SectionCard 与「该基金交易」SectionCard 从平铺改为塞进 Tabs；`<Button href="/me/dca">设置/管理定投 →</Button>` 暂时保留在 Tabs 上方（Task 4 会替换成定投页签）。结构：

```tsx
      {/* 交易 / 订单 两页签（定投页签 Task 4 接入）。
          页签纯 UI 状态，loader 数据一次性全量返回，切换不发请求 */}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "trade",
            label: "交易",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                {/* ↓ 原样搬入：加仓 SectionCard（d.navScaled > 0 守卫不变） */}
                {/* ↓ 原样搬入：卖出 SectionCard（d.availableShares > 0 守卫不变） */}
              </Space>
            ),
          },
          {
            key: "orders",
            label: "订单",
            children: (
              /* 原样搬入：该基金交易 SectionCard（含 OrderList + renderActions） */
              <></>
            ),
          },
        ]}
      />
```

搬移规则：三个 SectionCard 的 JSX **逐字节原样移动**（含注释），只改外层容器；`tick` 重挂机制、`handleSuccess`、`BuyPanel`/`SellPanel` 的 props 全部不动。`dca` 页签本 Task 不加。

- [ ] **Step 3: 手动验证 + lint + typecheck**

Run: `pnpm dev` 后访问 `/me/holdings/<有持仓的代码>`：
- 默认落在「交易」页签，加仓/卖出面板功能正常（下单成功有 toast、输入清空）
- 切到「订单」页签能看到该基金订单与撤单/改单按钮
- URL 出现 `?tab=orders`，刷新后停留在订单页签

Run: `npx eslint "app/routes/me.holdings.\$code.tsx" && pnpm typecheck`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add "app/routes/me.holdings.\$code.tsx"
git commit -m "feat(holdings): 持仓详情页 Tabs 化——交易/订单页签 + ?tab= 深链"
```

---

### Task 3: getDcaPlans 支持按基金过滤（TDD）

**Files:**
- Modify: `app/services/portfolio-service.ts`（`getDcaPlans` 加可选参数，约 205-226 行）
- Test: `tests/services/portfolio-dca-query.test.ts`（新建）

**Interfaces:**
- Produces: `getDcaPlans(db, userId, fundCode?) => Promise<DcaPlanView[]>`——fundCode 传了就只返回该基金的计划。Task 4 的 loader 调用 `getDcaPlans(db, user.id, code)`

- [ ] **Step 1: 写失败测试**

新建 `tests/services/portfolio-dca-query.test.ts`：

```ts
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, checkin, dcaPlan, fund, fundNav, holding, orders, session, shareLot, transactions, user } from "~/db/schema";
import { DEFAULT_REDEEM_TIERS } from "~/domain/redeem";
import { registerUser } from "~/services/auth";
import { createDcaPlan } from "~/services/dca-service";
import { getDcaPlans } from "~/services/portfolio-service";

/** getDcaPlans 的按基金过滤：持仓详情页定投页签的查询 */

async function resetAll() {
  const db = getDb(env.DB);
  await db.delete(transactions);
  await db.delete(shareLot);
  await db.delete(holding);
  await db.delete(orders);
  await db.delete(dcaPlan);
  await db.delete(checkin);
  await db.delete(session);
  await db.delete(account);
  await db.delete(user);
  await db.delete(fundNav);
  await db.delete(fund);
}

async function seedFund(code: string) {
  const db = getDb(env.DB);
  await db.insert(fund).values({
    code,
    name: `测试基金${code}`,
    type: "混合型",
    purchaseRate: 150,
    redeemTiers: DEFAULT_REDEEM_TIERS,
    minPurchase: 1000,
    riskLevel: 4,
    status: "开放申购",
    updatedAt: Date.now(),
  });
}

beforeEach(resetAll);

describe("getDcaPlans 按基金过滤", () => {
  it("不传 fundCode 返回全部；传了只返回该基金的", async () => {
    const db = getDb(env.DB);
    await seedFund("000001");
    await seedFund("000002");
    const { id: userId } = await registerUser(db, env, "alice", "hunter2");
    const now = new Date("2026-08-24T06:00:00Z");

    await createDcaPlan(db, { userId, fundCode: "000001", amountCents: 50000, frequency: "monthly", dayOfMonth: 15, now });
    await createDcaPlan(db, { userId, fundCode: "000002", amountCents: 30000, frequency: "weekly", dayOfWeek: 1, now });

    const all = await getDcaPlans(db, userId);
    expect(all).toHaveLength(2);

    const only1 = await getDcaPlans(db, userId, "000001");
    expect(only1).toHaveLength(1);
    expect(only1[0].fundCode).toBe("000001");
    expect(only1[0].fundName).toBe("测试基金000001");
  });

  it("该基金没有计划时返回空数组", async () => {
    const db = getDb(env.DB);
    await seedFund("000001");
    const { id: userId } = await registerUser(db, env, "alice", "hunter2");
    expect(await getDcaPlans(db, userId, "000001")).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:workers tests/services/portfolio-dca-query.test.ts`
Expected: FAIL，`getDcaPlans` 第三个参数类型不符（TS 报错）或运行时不生效

- [ ] **Step 3: 最小实现**

`app/services/portfolio-service.ts` 的 `getDcaPlans` 改为：

```ts
/** 读取用户的定投计划。fundCode 传入时只返回该基金的计划（持仓详情页定投页签用） */
export async function getDcaPlans(
  db: Db,
  userId: number,
  fundCode?: string,
): Promise<DcaPlanView[]> {
  const rows = await db
    .select()
    .from(dcaPlan)
    .where(
      fundCode
        ? and(eq(dcaPlan.userId, userId), eq(dcaPlan.fundCode, fundCode))
        : eq(dcaPlan.userId, userId),
    )
    .orderBy(desc(dcaPlan.createdAt));
```

（函数体其余部分——codes/funds/nameMap 组装——原样保留；确保文件顶部已导入 `and`，没有就加进 drizzle-orm 的 import。）

- [ ] **Step 4: 跑测试确认通过 + 回归**

Run: `pnpm test:workers tests/services/portfolio-dca-query.test.ts`
Expected: PASS
Run: `pnpm test:workers`
Expected: 全绿（`me.dca`/`master` 现有调用不受影响）

- [ ] **Step 5: Commit**

```bash
git add app/services/portfolio-service.ts tests/services/portfolio-dca-query.test.ts
git commit -m "feat(dca): getDcaPlans 支持按基金过滤——持仓详情页定投页签的查询"
```

---

### Task 4: 定投页签（DcaFundPanel + action 接线）

**Files:**
- Create: `app/components/DcaFundPanel.tsx`
- Modify: `app/routes/me.holdings.$code.tsx`（loader 加 plans、action 加 dca 分支、Tabs 加页签）

**Interfaces:**
- Consumes: `getDcaPlans(db, userId, fundCode)`（Task 3）；`createDcaPlan / toggleDcaPlan / deleteDcaPlan`（dca-service，签名见其源文件）；`DcaPlanView`（portfolio-service）
- Produces: `DcaFundPanelProps { fundCode: string; fundName: string; plans: DcaPlanView[]; action: string }`；action 新 intent：`create` / `toggle` / `delete`（表单字段与 /me/dca 一致，create 的 fundCode 由路由参数提供）

- [ ] **Step 1: 写 DcaFundPanel 组件**

新建 `app/components/DcaFundPanel.tsx`（形态参照 `me.dca.tsx` 的表单与行内管理，但基金锁定、无代码输入框）：

```tsx
import type { DcaPlanView } from "~/services/portfolio-service";
import { Button, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Typography, message } from "antd";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { DcaPlanList } from "~/components/DcaPlanList";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";

const { Text } = Typography;

interface ActionData {
  ok?: boolean;
  message?: string;
  error?: string;
}

export interface DcaFundPanelProps {
  fundCode: string;
  fundName: string;
  /** 该基金的定投计划（loader 里 getDcaPlans(db, userId, code)） */
  plans: DcaPlanView[];
  /** 提交到哪个 action（持仓详情页自身） */
  action: string;
}

const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

/**
 * 持仓详情页「定投」页签：该基金的定投计划管理。
 *
 * 与全局 /me/dca 分工：这里是基金视角（代码锁定、直接创建），
 * 全局页管跨基金总览与无持仓基金的定投——intent 协议保持一致
 * （create/toggle/delete），service 层完全复用。
 */
export function DcaFundPanel({ fundCode, fundName, plans, action }: DcaFundPanelProps) {
  const fetcher = useFetcher();
  const submitting = fetcher.state === "submitting";
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(15);

  // 结果 toast（notifiedRef 判重，同 OrderActions 套路）
  const notifiedRef = useRef<ActionData | null>(null);
  useEffect(() => {
    const d = fetcher.data as ActionData | undefined;
    if (!d || d === notifiedRef.current)
      return;
    notifiedRef.current = d;
    if (d.ok) {
      message.success(d.message ?? "操作成功");
      // 异步提交完成后关弹窗，me.dca 同款豁免理由
      // eslint-disable-next-line react/set-state-in-effect
      setOpen(false);
    }
    else if (d.error) {
      message.error(d.error);
    }
  }, [fetcher.data]);

  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post", action });

  const totalInvested = plans.reduce((s, p) => s + p.totalInvested, 0);
  const activeCount = plans.filter(p => p.status === "active").length;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text type="secondary">
          {plans.length} 个计划 · 执行中 {activeCount} · 累计投入 {fmtYuan(totalInvested)} 元
        </Text>
        <Button type="primary" onClick={() => setOpen(true)}>
          新建定投
        </Button>
      </Space>

      {plans.length === 0
        ? <EmptyState description={`${fundName} 还没有定投计划`} />
        : (
            <DcaPlanList
              plans={plans}
              // 行操作与 me.dca 同款「···」Dropdown（暂停/启用/删除）
              renderActions={p => (
                <Dropdown
                  menu={{
                    items: [
                      { key: "toggle", label: p.status === "active" ? "暂停" : "启用" },
                      { key: "delete", label: "删除", danger: true },
                    ],
                    onClick: ({ key }) => {
                      if (key === "toggle") {
                        submit({
                          intent: "toggle",
                          id: String(p.id),
                          status: p.status === "active" ? "paused" : "active",
                        });
                      }
                      else if (key === "delete") {
                        Modal.confirm({
                          title: "确定删除这个定投计划？",
                          content: "已产生的订单和持仓不受影响。",
                          okText: "删除",
                          okButtonProps: { danger: true },
                          cancelText: "取消",
                          onOk: () => submit({ intent: "delete", id: String(p.id) }),
                        });
                      }
                    },
                  }}
                >
                  <Button size="small">···</Button>
                </Dropdown>
              )}
            />
          )}

      <Modal
        title={`新建定投 · ${fundName}`}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
      >
        {/* 基金代码锁定为本基金，隐藏域携带；表单字段与 /me/dca 完全一致 */}
        <fetcher.Form method="post" action={action}>
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="fundCode" value={fundCode} />

          <Form.Item label="每期金额（元）" layout="vertical">
            <Input name="amount" inputMode="decimal" placeholder="如 500" suffix="元" />
          </Form.Item>

          <Form.Item label="定投频率" layout="vertical">
            <Select
              value={frequency}
              onChange={v => setFrequency(v)}
              options={[
                { value: "daily", label: "每日" },
                { value: "weekly", label: "每周" },
                { value: "monthly", label: "每月" },
              ]}
            />
            <input type="hidden" name="frequency" value={frequency} />
          </Form.Item>

          {frequency === "weekly" && (
            <Form.Item label="每周几" layout="vertical">
              <Select value={dayOfWeek} options={WEEKDAYS} onChange={v => setDayOfWeek(v)} />
              <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
            </Form.Item>
          )}

          {frequency === "monthly" && (
            <Form.Item label="每月几号" layout="vertical" extra="限 1-28 号，避免 2 月没有 29/30/31 号的问题">
              <InputNumber min={1} max={28} value={dayOfMonth} style={{ width: "100%" }} onChange={v => setDayOfMonth(v ?? 15)} />
              <input type="hidden" name="dayOfMonth" value={dayOfMonth} />
            </Form.Item>
          )}

          <Button type="primary" htmlType="submit" block loading={submitting}>
            创建计划
          </Button>
        </fetcher.Form>
      </Modal>
    </Space>
  );
}
```

- [ ] **Step 2: loader 加 plans、action 加 dca 分支、Tabs 加页签**

`app/routes/me.holdings.$code.tsx`：

导入区加：

```tsx
import { DcaFundPanel } from "~/components/DcaFundPanel";
import { getDcaPlans, getHoldingDetail, getOrdersByFund } from "~/services/portfolio-service";
import { createDcaPlan, deleteDcaPlan, toggleDcaPlan } from "~/services/dca-service";
```

（`getHoldingDetail`/`getOrdersByFund` 已有，合并 import 即可；`yuanToCents` 已在导入里。）

loader 返回对象加一项（`orders` 查询之后）：

```tsx
  // 该基金的定投计划（定投页签）
  const plans = await getDcaPlans(db, user.id, code);
```

return 里加 `plans,`。

action 的 try 块内、`if (intent === "buy")` 之前，加三个分支（校验口径抄 `me.dca.tsx`）：

```tsx
    // ===== 定投（与 /me/dca 同协议，create 的基金代码取路由参数） =====
    if (intent === "create") {
      const amount = String(fd.get("amount") ?? "");
      const frequency = String(fd.get("frequency") ?? "monthly") as
        | "daily"
        | "weekly"
        | "monthly";
      const dayOfWeek = fd.get("dayOfWeek") ? Number(fd.get("dayOfWeek")) : null;
      const dayOfMonth = fd.get("dayOfMonth") ? Number(fd.get("dayOfMonth")) : null;

      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0)
        return { error: "请输入正确的金额" };

      await createDcaPlan(db, {
        userId: user.id,
        fundCode,
        amountCents: yuanToCents(amount),
        frequency,
        dayOfWeek,
        dayOfMonth,
      });
      return { ok: true, message: "定投计划已创建" };
    }

    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      const status = String(fd.get("status")) as "active" | "paused";
      await toggleDcaPlan(db, user.id, id, status);
      return { ok: true, message: status === "active" ? "已启用" : "已暂停" };
    }

    if (intent === "delete") {
      const id = Number(fd.get("id"));
      await deleteDcaPlan(db, user.id, id);
      return { ok: true, message: "计划已删除" };
    }
```

Tabs `items` 数组在 `trade` 与 `orders` 之间插入：

```tsx
          {
            key: "dca",
            label: "定投",
            children: (
              <DcaFundPanel
                fundCode={d.fundCode}
                fundName={d.fundName}
                plans={plans}
                action={actionUrl}
              />
            ),
          },
```

组件解构 loaderData 处加 `plans`；**删掉**「设置/管理定投 →」那个 Button（`<Button href="/me/dca">设置/管理定投 →</Button>`，全局页入口已由页签承担，`/me/dca` 从导航仍可达）。

- [ ] **Step 3: 手动验证 + lint + typecheck**

Run: `pnpm dev` 后进持仓详情页「定投」页签：
- 新建计划成功 toast、弹窗关闭、列表出现新计划；刷新页面数据仍在
- 「···」暂停/启用/删除都生效，删除有二次确认
- URL 带 `?tab=dca` 刷新后仍停留定投页签；「交易」「订单」页签不回归

Run: `npx eslint "app/components/DcaFundPanel.tsx" "app/routes/me.holdings.\$code.tsx" && pnpm typecheck`
Expected: 无报错

- [ ] **Step 4: Commit**

```bash
git add app/components/DcaFundPanel.tsx "app/routes/me.holdings.\$code.tsx"
git commit -m "feat(holdings): 定投页签——DcaFundPanel 管理该基金计划，复用 /me/dca 协议"
```

---

### Task 5: 订单页「待确认委托」区块

**Files:**
- Modify: `app/routes/me.orders.tsx`

**Interfaces:**
- Consumes: `OrderList`（`renderActions` prop 已存在）、`OrderActions`
- Produces: 无对外接口（纯页面重排）

- [ ] **Step 1: 顶部待确认区块替换原 Alert**

`app/routes/me.orders.tsx` 组件内：

```tsx
  // 待确认委托独立成区：委托管理的主战场，撤单/改单按钮就在眼前，
  // 不再和已成交历史混在一条时间线里（主人反馈「撤单改单难发现」）
  const pendingOrders = orders.filter(o => o.status === "pending");
```

把现有的 `{pendingCount > 0 && (<Alert ... />)}` 整块替换为：

```tsx
      {pendingOrders.length > 0 && (
        <SectionCard title={`待确认委托（${pendingOrders.length} 笔）`}>
          <OrderList orders={pendingOrders} renderActions={o => <OrderActions order={o} />} />
          <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            真实基金是 T+1 成交：交易日 15:00 前下单按当日净值，之后顺延至下一交易日。
            系统每晚 20:30 拉取当日净值并撮合，此前均可撤单或改单。
          </Paragraph>
        </SectionCard>
      )}
```

同时：`pendingCount` 变量改用 `pendingOrders.length`（或直接删掉旧变量）；导入 `OrderList`、`OrderActions`、`SectionCard`（SectionCard 已有则不重复）；`Alert` 导入若无他人使用则移除；下方「全部订单」区维持 OrderTimeline + renderActions 不变。

- [ ] **Step 2: 手动验证 + lint + typecheck**

Run: `pnpm dev` 后访问 `/me/orders`：
- 有 pending 单时顶部出现「待确认委托」卡片，行内改单/撤单按钮可见且可操作
- 操作成功后 toast + 列表实时刷新（fetcher revalidate）
- 无 pending 单时该区块消失，只剩「全部订单」

Run: `npx eslint "app/routes/me.orders.tsx" && pnpm typecheck`
Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add app/routes/me.orders.tsx
git commit -m "feat(orders): 订单页顶部独立「待确认委托」区——委托管理主战场"
```

---

### Task 6: 持仓列表行内「详情 / 卖出」深链

**Files:**
- Modify: `app/routes/me.holdings.tsx`

**Interfaces:**
- Consumes: `HoldingList` 的 `renderActions?: (h: HoldingView) => ReactNode`（已存在）
- Produces: 无

- [ ] **Step 1: 行内加两个按钮**

`app/routes/me.holdings.tsx` 的 `<HoldingList>` 加 `renderActions`：

```tsx
              <HoldingList
                holdings={holdings}
                renderNote={h => `${sharesAndNavNote(h)} · 成本 ${fmtYuan(h.costCents)} 元`}
                getHref={h => `/me/holdings/${h.fundCode}`}
                // 行内「详情 / 卖出」：卖出深链直达交易页签（?tab=trade）。
                // 每行按钮一致（FundListItem 的 actions 宽度契约），不加买入——
                // 买入入口在自选页/基金详情页，这里再加就回到「到处都是」
                renderActions={h => (
                  <>
                    <Button size="small" href={`/me/holdings/${h.fundCode}`}>
                      详情
                    </Button>
                    <Button size="small" type="primary" href={`/me/holdings/${h.fundCode}?tab=trade`}>
                      卖出
                    </Button>
                  </>
                )}
              />
```

（两个 Button 外包 `<Space size={8}>` 或用 `<>` + Button 自带 margin 均可，以 lint 通过、视觉不挤为准；`Button` 已在导入里。）

- [ ] **Step 2: 手动验证 + lint + typecheck**

Run: `pnpm dev` 后访问 `/me/holdings`：
- 每行右侧出现「详情」「卖出」按钮，两列数字对齐不因按钮错位
- 点「卖出」直达该基金详情页交易页签（URL 带 `?tab=trade`，卖出面板在视口内）
- 点「详情」与点行本体行为一致

Run: `npx eslint "app/routes/me.holdings.tsx" && pnpm typecheck`
Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add app/routes/me.holdings.tsx
git commit -m "feat(holdings): 持仓列表行内「详情/卖出」——卖出深链直达交易页签"
```

---

### Task 7: 全量校验收尾

**Files:**
- 无新改动（只跑校验；发现问题回到对应 Task 修，修正合并进该 Task 自己的 commit）

- [ ] **Step 1: 全量校验**

Run:
```bash
pnpm verify
pnpm test:workers
```
Expected: `verify`（lint + typecheck + domain 测试）全绿；workers 127+2 测试全绿

- [ ] **Step 2: 跨页手动冒烟**

Run: `pnpm dev`，走一遍完整链路：
持仓列表「卖出」深链 → 交易页签卖出面板 → 订单页签看到待确认赎回 → 订单页撤单 → 现金回到持仓列表概览。全程有 toast 反馈、无控制台报错。

- [ ] **Step 3: 收尾**

若一切正常，本 Task 无 commit（校验性质）；若有修正，`git commit --amend` 进对应 Task 的 commit。

---

## Self-Review 记录

- Spec 覆盖：§1 Tabs（Task 2）、§2 DcaFundPanel（Task 3/4）、§3 撤改单显眼 + 待确认区（Task 1/5）、§4 各页定界（Task 5 收敛订单页职责；首页/自选页不动）、§5 持仓列表行内（Task 6）——全覆盖
- 类型一致性：`getDcaPlans(db, userId, fundCode?)` 与 Task 4 loader 调用一致；`DcaFundPanelProps` 四字段与 Task 4 JSX 一致；intent `create/toggle/delete` 与 action 分支一致
- 本计划无数据库迁移、无新金融计算、无 UnoCSS 新 class
