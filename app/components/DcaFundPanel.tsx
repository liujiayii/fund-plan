import type { DcaPlanView } from "~/services/portfolio-service";
import { Button } from "antd";
import { useState } from "react";
import { DcaPlanFormModal } from "~/components/DcaPlanFormModal";
import { DcaPlanList } from "~/components/DcaPlanList";
import { DcaPlanRowActions } from "~/components/DcaPlanRowActions";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";

export interface DcaFundPanelProps {
  fundCode: string;
  fundName: string;
  /** 该基金的定投计划（loader 里 getDcaPlans(db, userId, code)） */
  plans: DcaPlanView[];
}

/**
 * 详情页「定投」抽屉（DcaDrawer 的弹层内容，持仓详情页与基金详情页共用）：
 * 该基金的定投计划管理。
 *
 * 表单弹窗与行内操作全部走共享组件（DcaPlanFormModal / DcaPlanRowActions，
 * 2026-09-09 随「修改」功能收拢）——与全局 /me/dca 页、/me 的定投 tab
 * 一份真相。这里只剩基金视角的外壳：摘要一行 + 列表 + 新建入口，
 * 创建时基金锁定为本基金（编辑时同理，service 层不允许换基金）。
 */
export function DcaFundPanel({ fundCode, fundName, plans }: DcaFundPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);

  const totalInvested = plans.reduce((s, p) => s + p.totalInvested, 0);
  const activeCount = plans.filter(p => p.status === "active").length;

  return (
    // 外层纵排容器：Space direction 在 antd v6 已弃用（orientation 接替），
    // 这里本来就不需要 Space 的对齐能力，直接 flex 纵排（gap-6 = size large）
    <div className="flex w-full flex-col gap-6">
      {/* 摘要条：计数与累计投入收进井格（数字走 font-num），新建钮常驻右端 */}
      <div className="flex items-center justify-between gap-3 rounded-xl bg-well px-4 py-3">
        <div className="min-w-0 text-xs text-muted">
          <span className="font-num text-ink">{plans.length}</span>
          {" "}
          个计划 · 执行中
          <span className="font-num text-ink">{activeCount}</span>
          {" "}
          · 累计投入
          <span className="font-num text-ink">{fmtYuan(totalInvested)}</span>
          {" "}
          元
        </div>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建定投
        </Button>
      </div>

      {plans.length === 0
        ? <EmptyState description={`${fundName} 还没有定投计划`} />
        : (
            <DcaPlanList
              plans={plans}
              renderActions={p => <DcaPlanRowActions plan={p} />}
            />
          )}

      {/* 创建模式基金锁定本基金；条件渲染 = 每次打开全新实例 */}
      {createOpen && (
        <DcaPlanFormModal
          open
          onClose={() => setCreateOpen(false)}
          lockedFund={{ code: fundCode, name: fundName }}
        />
      )}
    </div>
  );
}
