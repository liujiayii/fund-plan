# 用户收益排行榜设计（/leaderboard）

日期：2026-08-28
状态：已批准的设计

## 1. 背景与目标

系统已支持多用户注册（注册送 10 万模拟本金、每日签到领现金），但用户之间互相看不见——
只有主理人的 `/master` 是公开的。加一个**收益/收益率排行榜**，让所有用户的模拟盘
同台竞技，给「签到 → 买基金 → 看排名」一个闭环的游戏化目标。

排行榜是纯读侧聚合页：**零 schema 变更、零 cron、零缓存、零新依赖**。

## 2. 收益口径（本设计最核心的决策）

### 2.1 为什么不用现有浮动盈亏口径

现有 `valuatePortfolio`（app/domain/portfolio.ts）的口径是
`浮盈 = 持仓市值 − 持仓成本`、`收益率 = 浮盈 ÷ 持仓成本`。它对「我的持仓」页是
对的，但拿来排榜不公平：

- 全部清仓的用户浮盈归零，**落袋为安的利润从榜上消失**——赚了就跑反而查无此人
- 只持仓不签到的口径没把「入金规模」纳入分母，本金大小不同的用户不可比

### 2.2 采用累计口径

```
累计入金 = initialCash + totalCheckin          （account 表现成字段）
总资产   = 持仓市值 + 现金
总收益   = 总资产 − 累计入金                    （已实现 + 浮动盈亏都在内）
收益率   = 总收益 ÷ 累计入金
```

性质：

| 场景 | 结果 | 理由 |
| --- | --- | --- |
| 清仓落袋 | 利润保留在榜上 | 现金里留着利润 |
| 只签到不买 | 收益恒为 0 | 签到是入金不是收益，刷不了榜 |
| 全亏光 | 收益率为负上榜 | 真实反映水平 |

与期二资产时间线的「净入金」概念一致（init + checkin 算入金，buy/sell/fee 不算），
全站口径自洽。

### 2.3 精度

遵守精度铁律：金额整数「分」、净值 ×10000、中间运算 decimal.js、最后 `roundInt()`
（HALF_UP）。收益率是给领域层排序用的普通小数，展示层格式化成百分比。

## 3. 上榜门槛与展示范围

- **全员自动上榜**，不做 opt-in 开关（模拟盘是假钱，无隐私顾虑；YAGNI）
- **门槛**：有过任意一笔 `status='confirmed'` 的订单。从未成交的纯新号不上榜，
  避免榜上一堆 0% 空号
- **露字段**：排名、用户名、总收益（红绿着色）、收益率、总资产。总资产露出来
  是刻意的——满足「看大佬本金多少」的观摩欲
- 游客可看（与 /master 同为公开页）

## 4. 架构分层

三层洁净架构，不跨层：

### 4.1 领域层 `app/domain/leaderboard.ts`（纯函数，node 单测）

```ts
/** 单用户原始数据（service 层从 D1 查出后拼好喂进来） */
interface LeaderboardEntryInput {
  userId: number;
  username: string;
  /** 持仓市值合计（分），由 service 用最新净值算好 */
  marketValueCents: number;
  cashCents: number;
  initialCashCents: number;
  totalCheckinCents: number;
  /** 是否有过 confirmed 订单（门槛） */
  hasTrades: boolean;
}

interface LeaderboardEntry extends LeaderboardEntryInput {
  totalAssetCents: number;   // 市值 + 现金
  totalPnlCents: number;     // 总资产 − 累计入金
  totalPnlRate: number;      // 总收益 ÷ 累计入金（普通小数）
  rank: number;              // 名次，由 rankLeaderboard 填
}

/** 过滤（门槛）+ 计算口径 */
function computeLeaderboard(rows: LeaderboardEntryInput[]): LeaderboardEntry[];

/** 排序：by = 'rate' | 'pnl'，各自降序 */
function rankLeaderboard(entries: LeaderboardEntry[], by: 'rate' | 'pnl')
  : LeaderboardEntry[];   // 附 rank 字段，同分同名次
```

排序稳定：同分同名次（1,2,2,4 型），次序键 `userId` 升序保证确定性。

### 4.2 服务层 `app/services/leaderboard-service.ts`

`getLeaderboard(db): Promise<LeaderboardRow[]>`，四次查询：

1. `user` + `account` 联查全量（用户名、现金、initialCash、totalCheckin）
2. `holding` 全量（按 userId 分组求市值素材：份额 × 最新净值，无净值用成本兜底
   ——与 getPortfolio 同款兜底，不另立口径）
3. `latestNavMap(db, codes)` 一次取所有涉及基金的最新净值（复用现成函数）
4. `orders` 聚合出「哪些 userId 有过 confirmed 订单」

不抛错：查不到数据返回空数组，页面渲染空态。模拟盘用户量小，全量内存计算即可，
不做 KV 缓存（KV 写入 1000 次/天是最紧额度，别去挤）也不加 cron 物化。

### 4.3 路由与页面 `app/routes/leaderboard.tsx`

- 公开页，loader 调 service + 领域层，返回两个维度各自排好序的榜单
- 页面结构：
  - 标题 + 口径说明一行（「总收益 = 总资产 − 累计入金，已清仓的收益也保留」），
    防止用户拿它对不上自己持仓页的浮盈
  - antd `Tabs`：**收益率榜（默认）** / 总收益榜，同一份数据两个排序
  - 列表卡片风格，对齐现有基金排行页观感；前 3 名奖牌样式
  - 已登录且自己不在前排时，底部钉一行「我的排名」（含名次 + 收益率）
  - 空态：没人有成交时 EmptyState + 引导文案
- 移动端适配沿用期五约定：窄屏横向滚动容器（fp-h-scroll）包表格

### 4.4 导航入口

- `NAV_ITEMS` 加「排行榜」项（桌面顶栏自动出现）
- ⚠️ `NAV_ITEMS` 顺序是接口的一部分：新项 key 为 `/leaderboard`，无前缀冲突，
  插在「主理人的盘」之后
- **移动端底栏不动**（期五刻意只放 4 格，320px÷5 会挤爆）。移动端入口走首页
  引流卡片——首页已有主理人盘引流卡片的现成范式，同款加一张
- `tests/domain/nav.test.ts` 顺序断言随之更新

## 5. 错误处理

| 场景 | 行为 |
| --- | --- |
| 榜上无人（无成交用户） | 空态 + 引导「去基金页开第一单」 |
| 某持仓无净值记录 | 成本兜底估值（同 getPortfolio），不崩 |
| D1 查询失败 | loader 自然抛错，走全局 ErrorBoundary |
| 除零（累计入金 0——理论不可能，注册即 init） | 领域层守卫返回 rate=0 |

## 6. 测试

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| domain（node，毫秒级） | `tests/domain/leaderboard.test.ts` | 口径：清仓利润保留、签到不算收益、除零守卫；门槛过滤；两维排序；同分同名次 |
| domain（node） | `tests/domain/nav.test.ts` | 补 /leaderboard 项的顺序断言 |
| services（workerd + 真实 D1） | `tests/services/leaderboard.test.ts` | 造 3 个用户（有成交/纯签到/空号），验证聚合、门槛、我的排名 |

## 7. 明确不做（YAGNI）

- ❌ 周榜/月榜（区间口径需逐用户重放资产时间线，计算重，二期再看）
- ❌ opt-in 上榜开关、隐私设置
- ❌ KV 缓存 / cron 物化快照表
- ❌ 历史名次变化趋势（「较昨日上升 2 名」）
