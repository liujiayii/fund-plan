# Admin 只读后台 Implementation Plan

> 状态：已完成 · 2026-09-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 admin 开一个只读后台：`/admin` 用户列表 + 全局统计卡，`/admin/users/:id` 单用户的持仓组合 + 全量订单。

**Architecture:** admin 能力全部圈死在 `/admin/*` 两个新路由里，`/me` 一行不动。守门用 `guard.ts` 新增的 `requireAdmin`（非 admin 一律 403）。数据层新建 `admin-service.ts`（用户列表聚合 + 全局统计 + 单用户详情），复用现成的 `getPortfolio` / `getOrders`（它们本来就按 userId 取参）。渲染复用 `PortfolioSummary` / `HoldingListReadonly` / `OrderList`。

**Tech Stack:** React Router 8 (framework mode) + antd 5 + Drizzle + D1 (vitest-workers)。

**Spec:** `docs/superpowers/specs/2026-09-01-admin-readonly-views-design.md`

## Global Constraints

- **包管理器必须用 pnpm**（`.npmrc` 指向淘宝镜像，npm 官方源不通）。
- **精度铁律**：金额整数「分」、份额/净值 ×10000、费率万分之。展示用 `fmtYuan` / `navToDisplay` / `sharesToDisplay`，绝不用浮点算钱。
- **`/me` 全部代码一行不动**——admin 能力只出现在 `/admin/*` 与 `guard.ts` 新函数里。
- 代码风格 `@antfu/eslint-config`：双引号 + 分号 + 2 空格缩进；**所有新增代码写中文注释**。
- 测试分两套：service 层测试跑 `pnpm test:workers tests/services/admin.test.ts`（**不加 `--`**）。
- 提交粒度：一个 Task 一个 commit，commit message 用 conventional 格式（`feat(admin): ...`）。
- 组件复用优先：统计卡用 `StatBig` + `SectionCard`，列表用现有 `HoldingListReadonly` / `OrderList`，别复制粘贴。
- 测试环境 `ADMIN_USERNAME = 'testadmin'`（`vitest.workers.config.ts` 已绑定），`registerUser(db, env, "testadmin", "hunter2")` 即得 admin 账号。

---

### Task 1: `requireAdmin` 守门函数

**Files:**
- Modify: `app/services/guard.ts`（文件末尾、`assertOwnership` 之前插入）
- Test: `tests/services/guard.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `getCurrentUser(request, db)`（已有，返回 `CurrentUser | null`）
- Produces: `requireAdmin(request: Request, db: Db): Promise<CurrentUser>`——admin 返回用户对象；未登录或普通用户抛 `Response`（403）。后续 Task 4/5 的两个路由 loader 以此为唯一守门。

- [ ] **Step 1: 写失败的测试**

在 `tests/services/guard.test.ts` 末尾追加（复用文件顶部已有的 `requestWithToken` helper 与 `registerUser`/`createSession` import）：

```ts
describe("requireAdmin 管理员守门", () => {
  it("admin 通过", async () => {
    const db = getDb(env.DB);
    // 测试环境 ADMIN_USERNAME = 'testadmin'
    const reg = await registerUser(db, env, "testadmin", "hunter2");
    const token = await createSession(db, reg.id);

    const u = await requireAdmin(requestWithToken(token), db);
    expect(u.id).toBe(reg.id);
    expect(u.role).toBe("admin");
  });

  it("普通用户抛 403", async () => {
    const db = getDb(env.DB);
    const reg = await registerUser(db, env, "alice", "hunter2");
    const token = await createSession(db, reg.id);

    try {
      await requireAdmin(requestWithToken(token), db);
      expect.unreachable("应该抛出 403");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }
  });

  it("未登录抛 403（不是重定向——/admin 的存在本身就不该对游客暴露）", async () => {
    const db = getDb(env.DB);
    const req = new Request("https://x.dev/admin");

    try {
      await requireAdmin(req, db);
      expect.unreachable("应该抛出 403");
    }
    catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }
  });
});
```

同时把文件顶部的 import 从 `~/services/guard` 里加上 `requireAdmin`。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:workers tests/services/guard.test.ts
```

预期：FAIL，报 `requireAdmin` 未导出（import 报错）。

- [ ] **Step 3: 实现**

在 `app/services/guard.ts` 的 `getAdminUser` 之后、`assertOwnership` 之前插入：

```ts
/**
 * 要求管理员。未登录与普通用户都抛 403。
 *
 * 与 requireUser 的语义刻意不同：requireUser 未登录时重定向到 /login
 * （那是「你还没登录」的善意引导）；/admin 是管理后台，对非 admin
 * 一视同仁地拒绝，不暴露「这里有个后台」的信息。
 * 语义与 assertOwnership 的 403 一致。
 */
export async function requireAdmin(
  request: Request,
  db: Db,
): Promise<CurrentUser> {
  const u = await getCurrentUser(request, db);
  if (!u || u.role !== "admin") {
    throw new Response("仅管理员可访问", { status: 403 });
  }
  return u;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test:workers tests/services/guard.test.ts
```

预期：全绿（原有用例 + 新增 3 条）。

- [ ] **Step 5: Commit**

```bash
git add app/services/guard.ts tests/services/guard.test.ts
git commit -m "feat(admin): requireAdmin 守门——非 admin 访问后台一律 403"
```

---

### Task 2: `admin-service` 用户列表与全局统计

**Files:**
- Create: `app/services/admin-service.ts`
- Test: `tests/services/admin.test.ts`（新建）

**Interfaces:**
- Consumes: `getPortfolio(db, userId)`（已有，`~/services/portfolio-service`）；schema 表 `user` / `account` / `orders`。
- Produces（Task 4/5 依赖，签名必须一字不差）：
  - `UserOverview`：`{ id, username, role, cashCents, marketValueCents, totalPnlCents, orderCount, createdAt }`
  - `AdminStats`：`{ users, pendingOrders, todayConfirmedOrders }`
  - `listUsersOverview(db: Db): Promise<UserOverview[]>`——按注册时间倒序
  - `getAdminStats(db: Db, now?: Date): Promise<AdminStats>`

- [ ] **Step 1: 写失败的测试**

新建 `tests/services/admin.test.ts`（种子数据套路抄 `tests/services/settle.test.ts` 的 `resetAll` / `seedFund` / `seedUser`）：

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import {
  account,
  checkin,
  dcaPlan,
  fund,
  fundNav,
  holding,
  orders,
  session,
  shareLot,
  transactions,
  user,
} from "~/db/schema";
import { registerUser } from "~/services/auth";
import { getAdminStats, listUsersOverview } from "~/services/admin-service";
import { toBeijing } from "~/domain/trading-calendar";

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

beforeEach(resetAll);

describe("listUsersOverview 用户列表", () => {
  it("每人的现金与持仓市值来自 account 与 portfolio，订单数独立统计", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    // alice 下一笔买单（pending），让 orderCount 有区分度
    const today = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(orders).values({
      userId: alice.id,
      fundCode: "000001",
      side: "buy",
      status: "pending",
      source: "manual",
      amount: 100000,
      placeDate: today,
      confirmDate: today,
      createdAt: Date.now(),
    });

    const rows = await listUsersOverview(db);
    expect(rows).toHaveLength(2);

    const a = rows.find(r => r.username === "alice")!;
    // alice 没持仓：市值 0、盈亏 0、现金即账户现金
    expect(a.marketValueCents).toBe(0);
    expect(a.totalPnlCents).toBe(0);
    expect(a.orderCount).toBe(1);
    const acc = await db.query.account.findFirst({ where: undefined })!;
    // 用注册返回值对表校验（registerUser 建 account 发 10 万初始本金）
    expect(a.cashCents).toBeGreaterThan(0);
    expect(a.role).toBe("user");
    void acc;

    const admin = rows.find(r => r.username === "testadmin")!;
    expect(admin.role).toBe("admin");
    expect(admin.orderCount).toBe(0);
  });

  it("按注册时间倒序（后注册的排前面）", async () => {
    const db = getDb(env.DB);
    await registerUser(db, env, "alice", "hunter2");
    await registerUser(db, env, "bob", "hunter2");

    const rows = await listUsersOverview(db);
    expect(rows.map(r => r.username)).toEqual(["bob", "alice"]);
  });
});

describe("getAdminStats 全局统计", () => {
  it("用户数 / 待撮合单数 / 今日已撮合单数", async () => {
    const db = getDb(env.DB);
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    const today = toBeijing(new Date()).format("YYYY-MM-DD");
    const yesterday = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(orders).values([
      // alice 的两笔 pending（都算待撮合）
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 100000, placeDate: today, confirmDate: today, createdAt: Date.now() },
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "dca", amount: 50000, placeDate: yesterday, confirmDate: yesterday, createdAt: Date.now() },
      // admin 的一笔今日已确认
      { userId: admin.id, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 20000, placeDate: yesterday, confirmDate: today, createdAt: Date.now() },
      // admin 的一笔昨日已确认（不计入「今日」）
      { userId: admin.id, fundCode: "000001", side: "buy", status: "confirmed", source: "manual", amount: 20000, placeDate: yesterday, confirmDate: yesterday, createdAt: Date.now() },
    ]);

    const s = await getAdminStats(db);
    expect(s.users).toBe(2);
    expect(s.pendingOrders).toBe(2);
    expect(s.todayConfirmedOrders).toBe(1);
  });

  it("空库全为 0", async () => {
    const db = getDb(env.DB);
    const s = await getAdminStats(db);
    expect(s).toEqual({ users: 0, pendingOrders: 0, todayConfirmedOrders: 0 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:workers tests/services/admin.test.ts
```

预期：FAIL，`Cannot find module '~/services/admin-service'`。

- [ ] **Step 3: 实现**

新建 `app/services/admin-service.ts`：

```ts
import type { Db } from "~/db/client";
import { desc, eq, sql } from "drizzle-orm";
import { account, orders, user } from "~/db/schema";
import { toBeijing } from "~/domain/trading-calendar";
import { getPortfolio } from "./portfolio-service";

/** /admin 用户列表一行的数据 */
export interface UserOverview {
  id: number;
  username: string;
  role: "admin" | "user";
  /** 可用现金（分） */
  cashCents: number;
  /** 持仓市值（分） */
  marketValueCents: number;
  /** 浮动盈亏（分） */
  totalPnlCents: number;
  /** 历史订单总数（含 pending/failed/cancelled） */
  orderCount: number;
  /** 注册时间戳（毫秒） */
  createdAt: number;
}

/** /admin 顶部全局统计卡 */
export interface AdminStats {
  /** 总用户数 */
  users: number;
  /** 待撮合订单数（所有 pending——它们都在等净值） */
  pendingOrders: number;
  /** 今日已撮合确认的订单数（北京时间口径 confirmDate = 今天） */
  todayConfirmedOrders: number;
}

/**
 * 用户列表聚合。模拟盘用户量小（几十人级），逐人调 getPortfolio 的
 * N+1 暂不优化——真到瓶颈再做 holding + fund_nav 的联表聚合。
 */
export async function listUsersOverview(db: Db): Promise<UserOverview[]> {
  const [users, orderCounts] = await Promise.all([
    db.select().from(user).orderBy(desc(user.createdAt), desc(user.id)),
    // 每用户订单数一条 groupBy 拿全，避免再逐人 count
    db
      .select({ userId: orders.userId, n: sql<number>`count(*)` })
      .from(orders)
      .groupBy(orders.userId),
  ]);
  const countMap = new Map(orderCounts.map(r => [r.userId, r.n]));

  const portfolios = await Promise.all(users.map(u => getPortfolio(db, u.id)));

  return users.map((u, i) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    cashCents: portfolios[i].summary.cashCents,
    marketValueCents: portfolios[i].summary.marketValueCents,
    totalPnlCents: portfolios[i].summary.totalPnlCents,
    orderCount: countMap.get(u.id) ?? 0,
    createdAt: u.createdAt,
  }));
}

/** 全局统计。三个口径见 AdminStats 字段注释 */
export async function getAdminStats(
  db: Db,
  now: Date = new Date(),
): Promise<AdminStats> {
  const today = toBeijing(now).format("YYYY-MM-DD");

  const [[users], [pending], [todayConfirmed]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(user),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, "pending")),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(sql`${orders.status} = 'confirmed' and ${orders.confirmDate} = ${today}`),
  ]);

  return {
    users: users.n,
    pendingOrders: pending.n,
    todayConfirmedOrders: todayConfirmed.n,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test:workers tests/services/admin.test.ts
```

预期：全绿。若 lint 报 unused（如 `account` import 未用），按 `pnpm lint:fix` 清理。

- [ ] **Step 5: Commit**

```bash
git add app/services/admin-service.ts tests/services/admin.test.ts
git commit -m "feat(admin): 用户列表聚合与全局统计 service"
```

---

### Task 3: `getUserDetail` 单用户详情

**Files:**
- Modify: `app/services/admin-service.ts`（追加）
- Test: `tests/services/admin.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `getPortfolio`、`getOrders(db, userId, limit)`（已有，`~/services/portfolio-service`）。
- Produces: `getUserDetail(db: Db, userId: number): Promise<AdminUserDetail | null>`，其中

```ts
export interface AdminUserDetail {
  user: { id: number; username: string; role: "admin" | "user"; createdAt: number };
  portfolio: PortfolioView;   // 来自 portfolio-service
  orders: OrderView[];        // 最近 200 条，倒序
}
```

不存在该用户时返回 `null`（路由层据此抛 404）。

- [ ] **Step 1: 写失败的测试**

在 `tests/services/admin.test.ts` 追加（顶部 import 加上 `getUserDetail`，并复用已有 `resetAll`；`OrderView` 等类型从 `~/services/portfolio-service` 导入）：

```ts
describe("getUserDetail 单用户详情", () => {
  it("返回该用户的组合与订单，别人的订单不混入", async () => {
    const db = getDb(env.DB);
    const admin = await registerUser(db, env, "testadmin", "hunter2");
    const alice = await registerUser(db, env, "alice", "hunter2");

    const today = toBeijing(new Date()).format("YYYY-MM-DD");
    await db.insert(orders).values([
      { userId: alice.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 100000, placeDate: today, confirmDate: today, createdAt: Date.now() },
      { userId: admin.id, fundCode: "000001", side: "buy", status: "pending", source: "manual", amount: 20000, placeDate: today, confirmDate: today, createdAt: Date.now() },
    ]);

    const d = await getUserDetail(db, alice.id);
    expect(d).not.toBeNull();
    expect(d!.user.username).toBe("alice");
    expect(d!.user.role).toBe("user");
    expect(d!.orders).toHaveLength(1);
    expect(d!.orders[0].userId).toBe(undefined); // OrderView 不含 userId，靠数量断言隔离
    expect(d!.portfolio.summary.cashCents).toBeGreaterThan(0);
  });

  it("用户不存在返回 null（路由层据此 404）", async () => {
    const db = getDb(env.DB);
    expect(await getUserDetail(db, 99999)).toBeNull();
  });
});
```

注意第一条里 `d!.orders[0].userId` 这行是弱断言（`OrderView` 无 `userId` 字段，恒为 undefined）——真正的隔离断言是 `toHaveLength(1)`：admin 也有一笔单，若查询没按 userId 过滤会查出 2 笔。实现时可删掉那行弱断言，只留 `toHaveLength(1)`。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test:workers tests/services/admin.test.ts
```

预期：FAIL，`getUserDetail` 未导出。

- [ ] **Step 3: 实现**

在 `app/services/admin-service.ts` 追加（import 补 `getOrders`、类型 `OrderView` / `PortfolioView`）：

```ts
/** /admin/users/:id 页的数据包 */
export interface AdminUserDetail {
  user: { id: number; username: string; role: "admin" | "user"; createdAt: number };
  portfolio: PortfolioView;
  orders: OrderView[];
}

/**
 * 单用户详情（组合 + 订单）。用户不存在返回 null，
 * 路由层据此抛 404——与 getHoldingDetail 的「查不到 → 404」套路一致。
 */
export async function getUserDetail(
  db: Db,
  userId: number,
): Promise<AdminUserDetail | null> {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u)
    return null;

  // 组合与订单互不依赖，并行发出（跨大区部署时每跳都是百毫秒级往返）
  const [portfolio, orderList] = await Promise.all([
    getPortfolio(db, userId),
    getOrders(db, userId, 200),
  ]);

  return {
    user: { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt },
    portfolio,
    orders: orderList,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm test:workers tests/services/admin.test.ts
```

预期：全绿。

- [ ] **Step 5: Commit**

```bash
git add app/services/admin-service.ts tests/services/admin.test.ts
git commit -m "feat(admin): getUserDetail 单用户组合与订单详情"
```

---

### Task 4: `/admin` 用户列表页

**Files:**
- Create: `app/routes/admin.tsx`
- Modify: `app/routes.ts`（注册路由）

**Interfaces:**
- Consumes: `requireAdmin`（Task 1）、`listUsersOverview` / `getAdminStats`（Task 2）、`StatBig` / `SectionCard` / `fmtYuan` / `pnlColor` / `toBeijing`。
- Produces: 可访问的 `/admin` 页面。路由注册在 `routes.ts` 的「需登录」区之后新增「管理」区。

- [ ] **Step 1: 注册路由**

`app/routes.ts` 在「需登录」区之后追加，并更新文件头注释：

```ts
  // ==== 管理（admin 专属，loader 里 requireAdmin 把门）====
  route("admin", "routes/admin.tsx"),
  route("admin/users/:id", "routes/admin.users.$id.tsx"),
```

（`admin.users.$id.tsx` 的文件在 Task 5 创建；本 Task 先只加 `route("admin", ...)` 这一行，`users/:id` 那行等 Task 5 一并加——**routes.ts 引用不存在的文件会让 dev/typecheck 直接炸**。）

- [ ] **Step 2: 写页面**

新建 `app/routes/admin.tsx`：

```tsx
import type { Route } from "./+types/admin";
import { Table, Tag, Typography } from "antd";
import { Link } from "react-router";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { fmtInt, fmtYuan } from "~/components/ui/format";
import { toBeijing } from "~/domain/trading-calendar";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";
import { getAdminStats, listUsersOverview } from "~/services/admin-service";
import { PnlText } from "~/components/ui/PnlText";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "管理后台 · 模拟基金" }];
}

/** admin 只读后台：全局统计 + 用户列表。写操作一概没有（见设计文档非目标） */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  await requireAdmin(request, db);

  const [stats, users] = await Promise.all([
    getAdminStats(db),
    listUsersOverview(db),
  ]);
  return { stats, users };
}

export default function AdminIndex({ loaderData }: Route.ComponentProps) {
  const { stats, users } = loaderData;

  const columns = [
    {
      title: "用户",
      dataIndex: "username",
      render: (_: unknown, r: { id: number; username: string }) => (
        <Link to={`/admin/users/${r.id}`}>{r.username}</Link>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 90,
      render: (role: "admin" | "user") =>
        role === "admin" ? <Tag color="blue">主理人</Tag> : <Tag>用户</Tag>,
    },
    {
      title: "现金",
      dataIndex: "cashCents",
      align: "right" as const,
      render: (v: number) => fmtYuan(v),
    },
    {
      title: "持仓市值",
      dataIndex: "marketValueCents",
      align: "right" as const,
      render: (v: number) => fmtYuan(v),
    },
    {
      title: "浮动盈亏",
      dataIndex: "totalPnlCents",
      align: "right" as const,
      render: (v: number) => <PnlText cents={v} rate={null} />,
    },
    {
      title: "订单数",
      dataIndex: "orderCount",
      align: "right" as const,
      width: 80,
      render: (v: number) => fmtInt(v),
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      width: 110,
      render: (v: number) => toBeijing(new Date(v)).format("YYYY-MM-DD"),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>管理后台</Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          只读视图：排查用户问题与全局运行状况。点用户名进入其组合与订单。
        </Paragraph>
      </div>

      <SectionCard>
        {/* 全局监控三格。主位是用户数（本页主题），其余次位 24 */}
        <Space size={[16, 16]} wrap>
          <StatBig label="注册用户" value={fmtInt(stats.users)} />
          <StatBig label="待撮合订单" value={fmtInt(stats.pendingOrders)} size={24} />
          <StatBig label="今日已撮合" value={fmtInt(stats.todayConfirmedOrders)} size={24} />
        </Space>
      </SectionCard>

      <SectionCard title={`用户（${users.length}）`}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          pagination={false}
          size="middle"
          scroll={{ x: 720 }}
        />
      </SectionCard>
    </Space>
  );
}
```

注意点（实现时自查）：

- `PnlText` 的 props 以 `app/components/ui/PnlText.tsx` 实际签名为准——若它不支持 `cents` 单独传（`rate` 传 null），就看它的调用方式（`HoldingList` 里是 `cents={...} rate={...}`）照抄口径；`rate` 不可为 null 就只传 `cents`、或改用 `<span style={{ color: pnlColor(v) }}>{fmtYuan(v)}</span>`。**以能编译 + 颜色正确为准，不要为它新改 PnlText 组件。**
- 顶部 import 的 `Space` 来自 antd，别漏。
- `Table` 若与 eslint 规则冲突（如 render 参数类型），以 `pnpm lint:fix` 输出为准。
- 嵌套表格窄屏：`scroll={{ x: 720 }}` 让窄屏横向滚动，不顶穿卡片。

- [ ] **Step 3: typecheck + lint**

```bash
pnpm typecheck && pnpm lint:fix
```

预期：通过（`+types/admin` 由 typecheck 前置的 `react-router typegen` 生成）。

- [ ] **Step 4: 手动验证**

```bash
pnpm dev
```

浏览器登录 admin 账号访问 `http://localhost:5173/admin`：统计卡有数字、用户表列出所有人、点用户名暂为 404（Task 5 才有目标页）。再开无痕窗口（游客）访问 `/admin`：看到 403 错误页（走 root.tsx 的 ErrorBoundary）。

- [ ] **Step 5: Commit**

```bash
git add app/routes/admin.tsx app/routes.ts
git commit -m "feat(admin): /admin 用户列表与全局统计页"
```

---

### Task 5: `/admin/users/:id` 用户详情页

**Files:**
- Create: `app/routes/admin.users.$id.tsx`
- Modify: `app/routes.ts`（补上 Task 4 预留的 `route("admin/users/:id", ...)` 行）

**Interfaces:**
- Consumes: `requireAdmin`（Task 1）、`getUserDetail`（Task 3）、`PortfolioSummary` / `HoldingListReadonly`（`~/components/PortfolioView`）、`OrderList`（`detailed` 模式）、`StatBig` / `SectionCard` / `fmtYuan` / `toBeijing`。
- Produces: 完整功能闭环。

- [ ] **Step 1: 注册路由**

`app/routes.ts` 的管理区补上（Task 4 已写好则跳过）：

```ts
  route("admin/users/:id", "routes/admin.users.$id.tsx"),
```

- [ ] **Step 2: 写页面**

新建 `app/routes/admin.users.$id.tsx`：

```tsx
import type { Route } from "./+types/admin.users.$id";
import { Button, Space, Tag, Typography } from "antd";
import { HoldingListReadonly, PortfolioSummary } from "~/components/PortfolioView";
import { OrderList } from "~/components/OrderList";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { fmtYuan } from "~/components/ui/format";
import { toBeijing } from "~/domain/trading-calendar";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";
import { getUserDetail } from "~/services/admin-service";
import { pnlColor } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "用户详情 · 管理后台 · 模拟基金" }];
}

/** admin 看某个用户的盘：只读。渲染复用 /master 那套（PortfolioSummary + 只读列表） */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  await requireAdmin(request, db);

  const id = Number(params.id);
  // 非数字 id（如 /admin/users/abc）与不存在的用户一并 404
  const detail = Number.isInteger(id) && id > 0
    ? await getUserDetail(db, id)
    : null;
  if (!detail) {
    throw new Response("用户不存在", { status: 404 });
  }

  return { detail };
}

export default function AdminUserDetail({ loaderData }: Route.ComponentProps) {
  const { detail } = loaderData;
  const { user, portfolio, orders } = detail;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {user.username}
          {" 的盘"}
          {user.role === "admin" && <Tag color="blue" style={{ marginLeft: 8 }}>主理人</Tag>}
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          注册于 {toBeijing(new Date(user.createdAt)).format("YYYY-MM-DD")} ·
          管理员只读视图，与用户自己的 /me 同口径
        </Paragraph>
      </div>

      {/* 返回列表的入口放标题区下方，排查问题时在多个用户间跳转是高频动作 */}
      <Button href="/admin">← 返回用户列表</Button>

      <SectionCard>
        <PortfolioSummary portfolio={portfolio} />
      </SectionCard>

      <SectionCard title={`持仓（${portfolio.holdings.length}）`}>
        <HoldingListReadonly holdings={portfolio.holdings} />
      </SectionCard>

      <SectionCard title={`订单（最近 ${orders.length} 条）`}>
        {/* detailed 模式：成交净值/份额/手续费全展开，failed 的原因在
            OrderList 的 failReason Tooltip 里——排查「为什么没成交」就靠它 */}
        {orders.length === 0
          ? <Paragraph type="secondary" style={{ marginBottom: 0 }}>无订单</Paragraph>
          : <OrderList orders={orders} detailed />}
      </SectionCard>
    </Space>
  );
}
```

实现时自查：

- `StatBig` / `pnlColor` 若最终没用到（PortfolioSummary 已覆盖统计行），删掉对应 import，别留死代码过 lint。
- `OrderList` 的行内操作槽 `renderActions` 刻意不传——admin 只读，绝不出现撤单/改单按钮。

- [ ] **Step 3: typecheck + lint + 全量测试**

```bash
pnpm typecheck && pnpm lint:fix && pnpm test:workers
```

预期：全部通过。

- [ ] **Step 4: 手动验证**

`pnpm dev` 后：

1. 登录 admin，`/admin` 点任意用户名 → 看到其总资产/持仓/订单
2. 访问 `/admin/users/99999` → 404「用户不存在」
3. 登录普通用户访问 `/admin/users/1` → 403

- [ ] **Step 5: Commit**

```bash
git add app/routes/admin.users.$id.tsx app/routes.ts
git commit -m "feat(admin): /admin/users/:id 用户组合与订单只读视图"
```

---

### Task 6: 顶栏「管理」入口（admin 可见）

**Files:**
- Modify: `app/root.tsx`（`App` 组件内）

**Interfaces:**
- Consumes: `NAV_ITEMS` / `resolveSelectedKey`（`~/domain/nav`，**不改它们**）、root loader 已返回的 `user`（含 `role`）。
- Produces: admin 登录态下顶栏多一个「管理」链接；`/admin/*` 页面上「管理」高亮。移动端 TabBar 刻意不加（TABS 是显式挑选的 4 项，管理是低频操作，手机上输 URL 即可——与「主理人的盘不进底栏」同一条设计原则）。

- [ ] **Step 1: 改 root.tsx**

在 `const selectedKey = ...` 一行之前插入并替换该行：

```tsx
  // admin 专属导航项：运行时按角色拼接，不加进 domain 的 NAV_ITEMS ——
  // NAV_ITEMS 是「无角色分叉的公共导航」的单一事实源（顶栏与 TabBar 共用、
  // 顺序被单测钉死），混入角色逻辑就毁了这个约定。追加在末尾无前缀冲突。
  const navItems = user?.role === "admin"
    ? [...NAV_ITEMS, { key: "/admin", label: "管理" }]
    : NAV_ITEMS;
  // 高亮当前所在的一级导航（顶栏与底部 TabBar 共用同一份纯函数）
  const selectedKey = resolveSelectedKey(location.pathname, navItems);
```

同时把顶栏 `<Menu>` 的 `items` 改为消费 `navItems`（原来消费 `NAV_ITEMS`）：

```tsx
              items={navItems.map(i => ({
                key: i.key,
                label: <a href={i.key}>{i.label}</a>,
              }))}
```

- [ ] **Step 2: 领域单测确认没被波及**

```bash
pnpm test tests/domain/nav.test.ts
```

预期：全绿（NAV_ITEMS 未动，顺序钉子完好）。

- [ ] **Step 3: typecheck + lint**

```bash
pnpm typecheck && pnpm lint:fix
```

- [ ] **Step 4: 手动验证**

admin 登录：顶栏出现「管理」，点进 `/admin` 后「管理」处于高亮；普通用户登录：顶栏无「管理」。

- [ ] **Step 5: Commit**

```bash
git add app/root.tsx
git commit -m "feat(admin): 顶栏 admin 专属「管理」入口"
```

---

### Task 7: 收尾——全量校验与状态戳

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-admin-readonly-views.md`（盖状态戳）

**Interfaces:**
- Consumes: 前六个 Task 的全部产出。
- Produces: 可交付的完整功能。

- [ ] **Step 1: 全量校验**

```bash
pnpm verify
```

预期：lint + typecheck + 两套测试全绿。任何红灯先修再继续，不带病收尾。

- [ ] **Step 2: 手动全流程过一遍**

`pnpm dev` 后按检查单走：

1. admin 登录 → 顶栏「管理」→ `/admin` 统计卡与用户表数字合理
2. 点用户名 → 组合/订单正确（找一个有 pending 单和 failed 单的账号，确认「待确认」「失败」Tag 与 failReason Tooltip 可见）
3. 403 / 404 两条错误路径如 Task 5 Step 4 所述
4. 普通用户登录态下顶栏无「管理」

- [ ] **Step 3: 盖状态戳**

在计划文件标题（`# Admin 只读后台 Implementation Plan` 一行）下方插入，**必须盖在 `For agentic workers` 引用块之前**：

```markdown
> 状态：已完成 · 2026-09-01
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-01-admin-readonly-views.md
git commit -m "docs(admin): admin 只读后台计划盖完成戳"
```

---

## Self-Review 记录

- **Spec 覆盖**：权限（Task 1）、路由（Task 4/5）、用户列表 + 统计卡（Task 2/4）、单用户组合 + 订单 + 404（Task 3/5）、导航入口（Task 6）、测试四条用例（403×2、admin 可读、404——分布在 Task 1/3 的 service 层测试 + Task 4/5 的手动验证）。非目标（写操作/批次/分页/缓存）无一涉足。✅
- **类型一致性**：`requireAdmin` / `listUsersOverview` / `getAdminStats` / `getUserDetail` 在 Task 1/2/3 定义、Task 4/5 消费，签名已核对一致。✅
- **已知实现期歧义**：Task 4 的 `PnlText` 调用口径以组件实际签名为准（计划里已写明降级方案），`StatBig`/`pnlColor` 未用则删 import。✅
