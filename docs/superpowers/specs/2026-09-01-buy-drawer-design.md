# 买入抽屉（BuyDrawer）设计

日期：2026-09-01 · 状态：已实施（`feat/buy-drawer` 分支）

## 背景与决策链

**为什么抽屉形态又回来了。** 期三（2026-08-26 trading-experience）曾删光
BuyDrawer/SellDrawer，把交易动作统一收进 `/me/holdings/:code` 详情页的内嵌面板。
那次收敛解决的是「持仓页交易入口分散」。

本期的诉求是新场景：**自选页看中就买、不跳页**（主人明确提出）。弹层 + 复用
BuyPanel 是唯一不动金融逻辑的做法；顺势把基金详情页的买入入口也换成同一抽屉，
买入交互全站统一。这不是翻烧饼：持仓详情页的「交易驾驶舱」形态刻意保持不变
（卖出面板的 FIFO 逐批明细表也不适合塞抽屉）。

## 方案

| 件 | 职责 |
| --- | --- |
| `app/hooks/useIsMobile.ts` | matchMedia 767px 断点（与 responsive.css 对齐）。项目首个 JS 断点设施——此前响应式纯 CSS；抽屉的 placement 是 JS prop，CSS 管不到。SSR 按桌面渲染，水合首帧同值避免 mismatch |
| `app/components/BuyDrawer.tsx` | 抽屉壳：桌面右侧 400px / 移动端底部弹层 88%；`destroyOnHidden` 关闭即重置面板（等价 tick 重挂，宿主零状态）；成功 toast + 自动关 |
| `BuyPanel` / `SellPanel` 的 `onSuccess` | 成功信号通道（见下节） |

- 自选页入口：行内 `[买入][···]`，主色按钮承载全行唯一强调。原「查看」按钮退役——
  行首基金名整块可点进详情（FundListItem 契约），76px actions 宽度契约不变
- 无净值的行禁用买入（Tooltip 说明），与详情页「没有净值时无法下单」口径一致
- 自选页 action 增 `buy` 分支调 `placeBuyOrder`，金额校验与 funds.$code 同口径

## 关键教训：fetcher 的成功信号只能从提交者出

React Router 的 `useFetcher` 每个实例独立——**提交走哪个 fetcher，action 的
返回就只落在哪个 fetcher 上**。BuyPanel/SellPanel 都在组件内部自建 fetcher
提交，宿主页面自建的 fetcher 永远拿不到结果。

`me.holdings.$code` 曾因此带病运行：页面级 `fetcher.data?.ok` 看守成功（期望
显示 Alert + tick 重挂清空输入），但它从不 submit、data 恒空——买入/卖出成功后
静默无反馈、输入不清空。修复：面板暴露 `onSuccess` 回调（内部 fetcher 落地
`data.ok` 时触发，`notifiedRef` 按 data 对象判重，防内联回调引用变化重复触发），
宿主接回调 toast + 重挂。

**规则**：以后任何「页面感知面板提交结果」的需求，一律走面板回调，别在页面
再建一个 useFetcher 看守——那是死信号。

## 边缘与口径

- 无净值：自选行禁用买入；详情页维持「净值数据就绪后可在此下单」占位
- 未登录：自选页本身 requireUser 无此分支；详情页维持注册引导
- 买入成功后现金刷新：useFetcher POST 触发 loader revalidate，无需手动刷新
- 抽屉退场动画期间数据保持（自选页 buyOpen/buyTarget 双 state），不闪空壳
