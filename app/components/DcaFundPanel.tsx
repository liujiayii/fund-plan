import type { DcaPlanView } from "~/services/portfolio-service";
import { Button, Space, Typography } from "antd";
import { useState } from "react";
import { DcaPlanFormModal } from "~/components/DcaPlanFormModal";
import { DcaPlanList } from "~/components/DcaPlanList";
import { DcaPlanRowActions } from "~/components/DcaPlanRowActions";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";

const { Text } = Typography;

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
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text type="secondary">
          {plans.length}
          {" "}
          个计划 · 执行中
          {activeCount}
          {" "}
          · 累计投入
          {fmtYuan(totalInvested)}
          {" "}
          元
        </Text>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建定投
        </Button>
      </Space>

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
    </Space>
  );
}
