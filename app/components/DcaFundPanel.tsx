import type { DcaPlanView } from "~/services/portfolio-service";
import { Button, Dropdown, Form, Input, InputNumber, message, Modal, Select, Space, Typography } from "antd";
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
