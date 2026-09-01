# 上线流程（标准作业流程）

> 本文档是本仓库从写代码到上线的**唯一权威流程**，人和 AI 助手（Claude Code）都照此执行。
> 把本文档喂给 AI 时，它会按第 6 节的 agent 规约行事。

---

## 1. 全景图

```
专题分支上开发 → 本地全量校验 → push 到 GitHub → 建 PR（base: main）
      → CodeRabbit 机器人 review → 有则改之、无则加冕 → 合并进 main
      → Test 流水线（lint + typecheck + build + 两套测试）全绿
      → Deploy 流水线自动接手（D1 迁移 + 构建 + 部署到 Cloudflare）
```

线上生效的最后一环是 GitHub Actions 自动部署——**合并进 main 即上线**，
不存在"合并了但还没发"的中间态。合并前请确认代码真的可以见人。

## 2. 分支纪律

- **绝不在 main 上直接提交任何东西**——包括纯文档。main 只通过合并 PR 进货。
- 每期工作开**以内容命名的专题分支**，slug 与 spec/plan 文件名对齐，便于溯源。
  例：`feat/admin-readonly`、`feat/phase5-mobile-adaptation`。
- 提交粒度：**一个 Task 一个 commit**，conventional 格式（`feat(scope): ...` /
  `fix(scope): ...` / `docs: ...`）。不要一条注释一个 commit。
- 并线、推送、建 PR 的时机是主人的显式决定，助手不擅自执行。

## 3. 提交前：本地全量校验

```bash
pnpm verify          # lint + typecheck + 领域层单测（毫秒级）
pnpm test:workers    # 应用层集成测试（真实 workerd + D1，慢但不进 verify 脚本）
```

**两个都要跑绿**再 push——CI 的 Test 流水线就是这两套（外加 build），
本地不绿推上去只会浪费 CI 额度并收获一个红叉。

> 本机网络备忘：GitHub 直连不通，推送走 Clash 代理 `127.0.0.1:7890`；
> 包管理只用 pnpm（`.npmrc` 已指向淘宝镜像）。

## 4. PR 与 CodeRabbit 评审

1. push 分支后在 GitHub 上建 PR，**base: main**，标题用 conventional 格式，
   描述里给出测试证据（跑了什么命令、多少个用例）与已知遗留。
2. PR 会自动触发两件事：
   - **Test 流水线**先跑（`.github/workflows/test.yml`：Lint & Typecheck & Build
     + Unit & Workers Tests 两个 job）
   - **CodeRabbit 机器人**给出 code review 建议
3. 看 CodeRabbit 的建议，**有则改之，无则加冕**：
   - 采纳的建议 → 在同一分支上追加 commit 修正，再 push（PR 自动更新）
   - 不采纳的建议 → 在 PR 里回复说明理由后Resolve掉，不必盲从机器人
4. Test 全绿 + review 意见处理完毕 → 合并进 main。

## 5. 合并后：自动部署（无需人工动作）

`.github/workflows/deploy.yml` 监听 **main 分支上 Test 工作流的成功结束**，自动接手：

1. checkout 到**刚被测过的那个 commit**（测过的就是部署的，不会部署别人后推的代码）
2. `wrangler d1 migrations apply`（幂等：只应用未执行过的迁移，没有新迁移则跳过）
3. `pnpm build` → `wrangler deploy` 上线 Cloudflare Workers

同一 commit 的部署任务排队而不互相取消（避免打断进行中的迁移）。
部署失败或改完配置想重发：Actions 页面 → Deploy → Run workflow 手动触发。

验证上线结果：访问线上站点确认行为，或看 Actions 里两条流水线均为绿。

## 6. AI 助手（Claude Code）规约

主人把本文档喂给你时，按以下规约行事：

- **默认在 worktree 里干活**（分支隔离），不碰主 checkout 的未提交改动。
- 本地 `pnpm verify` + `pnpm test:workers` 全绿是 push 的前置条件。
- **push / 建 PR / 合并 PR 必须先获得主人显式同意**，一次授权只覆盖当次操作。
- PR 描述写清：做了什么、测试证据、已知遗留——CodeRabbit 之外的第二道人审材料。
- CodeRabbit 在 PR 上的建议若需跟进：在同一分支追加 commit 修正后 push，
  保持"一个修正主题一个 commit"，不拆细碎 commit。
- 合并进 main 后可提醒主人：部署是自动的，线上有问题可去 Actions 手动重跑。
- 改动了 `wrangler.jsonc` 或迁移文件时，在 PR 描述里明确提示——
  部署流水线会自动应用 D1 迁移，结构变更要主人心里有数。
