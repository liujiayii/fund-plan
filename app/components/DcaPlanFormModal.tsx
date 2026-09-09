import type { DcaPlanView } from "~/services/portfolio-service";
import { Button, Form, Input, InputNumber, message, Modal, Select, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { centsToYuan } from "~/domain/money";

const { Text } = Typography;

/** /me/dca action 的返回形状 */
interface ActionData {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** 周几选项。此前在 me.dca / MeTabsPanels / DcaFundPanel 抄了三份，收拢为唯一定义 */
export const DCA_WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

export interface DcaPlanFormModalProps {
  /**
       开合受控。建议调用方条件渲染本组件（而非常挂 + open 开关）——
      每次打开都是全新实例，频率/日子/金额的初始值自然取自 plan，不用手动重置
   */
  open: boolean;
  onClose: () => void;
  /** 编辑模式：传计划（基金锁定、金额/频率预填、intent=update）。不传 = 创建 */
  plan?: DcaPlanView;
  /** 创建模式且基金锁定时传（DcaFundPanel 的基金视角）。与 plan 二选一 */
  lockedFund?: { code: string; name: string };
  /** 创建模式可编辑代码输入框的预填值（/me/dca?fund= 深链带进来） */
  defaultFundCode?: string;
  /** 提交目标，默认 /me/dca（定投四 intent 的唯一 action） */
  action?: string;
}

/**
 * 定投计划表单弹窗：创建 / 修改合一（2026-09-09 随「修改」功能抽出）。
 *
 * 三个消费方此前各自抄了一份创建表单（me.dca 全局页、MeTabsPanels 的
 * DcaPanel、DcaFundPanel 抽屉面板），这次连「修改」一起收拢——
 * 表单、提交、toast、成功自关全部内聚，调用方只剩开合与模式。
 *
 * 编辑模式的语义（与 service 层 updateDcaPlan 对齐）：
 *  - 基金锁定只读（换基金 = 删除重建，计划身份就是「对这只基金定投」）
 *  - 金额/频率/日子预填；next_run 由服务端按新频率重算
 */
export function DcaPlanFormModal({
  open,
  onClose,
  plan,
  lockedFund,
  defaultFundCode,
  action = "/me/dca",
}: DcaPlanFormModalProps) {
  const fetcher = useFetcher<typeof import("~/routes/me.dca").action>();
  const submitting = fetcher.state !== "idle";

  // 频率/日子受控状态：编辑按计划预填，创建默认月投。
  // 组件由调用方条件渲染，每次打开都是新实例，初始值天然正确
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(
    plan?.frequency ?? "monthly",
  );
  const [dayOfWeek, setDayOfWeek] = useState(plan?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(plan?.dayOfMonth ?? 15);

  // 结果 toast + 成功自关（notifiedRef 按 data 对象判重，同 OrderActions 套路）
  const notifiedRef = useRef<ActionData | null>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (!d || d === notifiedRef.current)
      return;
    notifiedRef.current = d;
    if (d.ok) {
      message.success(d.message ?? "操作成功");
      // 异步提交完成的副作用（关弹窗），effect 正是该用的工具——
      // 改成派生状态反而会因 fetcher.data 残留 ok 导致弹窗关了再也打不开

      onClose();
    }
    else if (d.error) {
      message.error(d.error);
    }
  }, [fetcher.data, onClose]);

  // 展示用：编辑模式取计划，创建锁定模式取锁定基金
  const fund = plan
    ? { code: plan.fundCode, name: plan.fundName }
    : lockedFund ?? null;

  return (
    <Modal
      title={plan ? `修改定投 · ${fund!.name}` : fund ? `新建定投 · ${fund.name}` : "新建定投计划"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <fetcher.Form method="post" action={action}>
        <input type="hidden" name="intent" value={plan ? "update" : "create"} />
        {/* 编辑模式带 id；创建锁定模式带锁定基金代码 */}
        {plan && <input type="hidden" name="id" value={plan.id} />}
        {fund && <input type="hidden" name="fundCode" value={fund.code} />}

        {fund
          ? (
              // 基金锁定：编辑与抽屉视角都不可换（换基金 = 删除重建）
              <Form.Item label="基金" layout="vertical">
                <Text>
                  {fund.name}
                  （
                  {fund.code}
                  ）
                </Text>
              </Form.Item>
            )
          : (
              // 全局创建：代码可编辑，深链 ?fund= 预填
              <Form.Item
                label="基金代码"
                layout="vertical"
                extra="6 位数字。需先在基金详情页访问过一次，系统才会收录该基金"
              >
                <Input
                  name="fundCode"
                  placeholder="如 000001"
                  maxLength={6}
                  defaultValue={defaultFundCode}
                />
              </Form.Item>
            )}

        <Form.Item label="每期金额（元）" layout="vertical">
          <Input
            name="amount"
            inputMode="decimal"
            placeholder="如 500"
            suffix="元"
            defaultValue={plan ? centsToYuan(plan.amount) : undefined}
          />
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
          {/* 受控值走隐藏域提交（不用 document.querySelector 改输入框） */}
          <input type="hidden" name="frequency" value={frequency} />
        </Form.Item>

        {frequency === "weekly" && (
          <Form.Item label="每周几" layout="vertical">
            <Select value={dayOfWeek} options={DCA_WEEKDAYS} onChange={v => setDayOfWeek(v)} />
            <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
          </Form.Item>
        )}

        {frequency === "monthly" && (
          <Form.Item
            label="每月几号"
            layout="vertical"
            extra="限 1-28 号，避免 2 月没有 29/30/31 号的问题"
          >
            <InputNumber
              min={1}
              max={28}
              value={dayOfMonth}
              style={{ width: "100%" }}
              onChange={v => setDayOfMonth(v ?? 15)}
            />
            <input type="hidden" name="dayOfMonth" value={dayOfMonth} />
          </Form.Item>
        )}

        <Button type="primary" htmlType="submit" block loading={submitting}>
          {plan ? "保存修改" : "创建计划"}
        </Button>
      </fetcher.Form>
    </Modal>
  );
}
