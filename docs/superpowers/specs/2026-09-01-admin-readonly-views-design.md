# Admin 只读后台设计

日期：2026-09-01
状态：设计定稿，待实施

## 背景与动机

现有权限模型是「admin 没有独立后台：主理人的 `/me` 就是被公开的那个盘，
`/master` 只是它的只读镜像」。管理员排查用户问题（"单子为什么没成交"）、
看全局运行状况、满足运营好奇心，都没有任何通道——`/me/*` 的 loader 一律
`requireUser` 后只查自己的数据。

本期给 admin 开一个**只读**的查看通道。

## 目标 / 非目标

**目标：**

1. `/admin` 用户列表：用户名、角色、现金、持仓市值、浮动盈亏、订单数、注册时间
2. `/admin` 顶部全局监控统计卡：总用户数、待撮合订单数（**全部** pending——
   撮合积压的直接指标，不限当日）、今日已撮合单数（北京时间口径 confirmDate = 今天）
3. `/admin/users/:id` 单用户视图：持仓组合（复用 `PortfolioView`）+ 最近
   最多 200 条订单
4. 订单表展示：时间、基金、方向、金额、份额、确认净值、状态（pending/
   confirmed/failed）、失败原因——排查撮合问题的核心

**非目标（明确不做）：**

- 任何写操作（帮撤单、修数据、重跑撮合）——遇到真实需要时单独设计
- `share_lot` 批次钻取、定投计划、自选、账户流水
- 分页（模拟盘用户量小，全量渲染）
- 边缘缓存 / KV（admin 自己看，不占 KV 写额度）

## 权限设计

`app/services/guard.ts` 新增 `requireAdmin(request, db)`：

- 复用 `getCurrentUser`，未登录与普通用户均抛 `Response(403)`
  （不是 redirect 到登录页——是明确拒绝，语义与 `assertOwnership` 一致）
- 两个新路由 loader 均以此为唯一守门

**边界铁律：admin 能力圈死在 `/admin/*`，`/me` 全部代码一行不动。**
防越权口子不蔓延。

## 路由

```text
app/routes/admin.tsx              # 用户列表 + 全局统计卡
app/routes/admin.users.$id.tsx    # 单用户组合 + 订单
```

导航：admin 登录态下多渲染一个「管理」入口（按 `role === "admin"` 判断）。

## 数据流

- `/admin`：service 层新增 `listUsersOverview(db)` 批量聚合——一次批量取
  user / account / holding / 最新净值 + 一条 groupBy 订单数，固定 ~5 条查询
  与用户数无关（D1 免费版每请求 50 条查询硬顶，早期逐人调 getPortfolio 的
  N+1 写法在用户过 ~10 人时会直接 500，已消除）。持仓估值口径与
  `getPortfolio` 完全一致：`valuateHolding` + 无净值时 `costBasisNavScaled`
  成本兜底，汇总走 `valuatePortfolio`
- `/admin/users/:id`：
  - `getPortfolio(db, userId)` 换 userId 复用现有 service
  - 组合渲染复用 `PortfolioView`（当初渲染/取数分离的红利）
  - 订单需要不带基金过滤的 `getOrders(db, userId)` 变体
  - 用户不存在 → 404

## 测试

领域层无新逻辑，不动 domain 单测。应用层 `tests/services/admin.test.ts`
（`pnpm test:workers`）覆盖：

1. 普通用户访问 `/admin` loader → 403
2. 未登录访问 → 403
3. admin 能拿到他人数据
4. 不存在的用户 → 404
