import type { Route } from "./+types/me.dca";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { DcaPlanList } from "~/components/DcaPlanList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { centsToYuan, yuanToCents } from "~/domain/money";
import { getAppContext } from "~/services/context";
import {
  createDcaPlan,
  deleteDcaPlan,
  toggleDcaPlan,
} from "~/services/dca-service";
import { searchFunds } from "~/services/fund-data";
import { requireUser } from "~/services/guard";
import { getDcaPlans } from "~/services/portfolio-service";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的定投 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const plans = await getDcaPlans(db, user.id);
  return { plans };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);

  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  try {
    if (intent === "create") {
      const fundCode = String(fd.get("fundCode") ?? "").trim();
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
      if (!/^\d{6}$/.test(fundCode))
        return { error: "请输入 6 位基金代码" };

      // 基金可能还没入库（用户没点过详情页），这里顺手拉一次
      const exists = await db.query.fund.findFirst({
        where: (f, { eq }) => eq(f.code, fundCode),
      });
      if (!exists) {
        const found = await searchFunds(env, fundCode);
        if (found.length === 0) {
          return { error: `没找到基金 ${fundCode}，请先在基金页搜索确认` };
        }
        return {
          error: `请先访问 /funds/${fundCode} 查看一次该基金，系统会自动收录后再来创建定投`,
        };
      }

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

    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
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

export default function MeDca({ loaderData }: Route.ComponentProps) {
  const { plans } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("monthly");
  // 受控的频率参数，避免用 document.querySelector 去改隐藏域
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(15);

  const submitting = fetcher.state === "submitting";
  const totalInvested = plans.reduce((s, p) => s + p.totalInvested, 0);
  const activeCount = plans.filter(p => p.status === "active").length;

  // 创建成功后关掉弹窗。
  // 这里 eslint 会提示「不要在 effect 里同步调 setState」——但那条规则针对的是
  // 「用 effect 同步派生状态」的反模式。本场景是「异步提交完成后触发副作用」，
  // effect 正是该用的工具：改成派生状态反而会出 bug（fetcher.data 会一直保留
  // ok=true，导致弹窗关掉后再也打不开）。故定向豁免。
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      // eslint-disable-next-line react/set-state-in-effect
      setOpen(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Title level={3} style={{ marginBottom: 0 }}>
          我的定投
        </Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          新建定投计划
        </Button>
      </Space>

      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} closable />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} closable />
      )}

      <SectionCard>
        <Space size={48} wrap>
          <StatBig label="计划总数" value={plans.length} suffix="个" size={24} />
          <StatBig label="执行中" value={activeCount} suffix="个" size={24} />
          <StatBig
            label="累计投入"
            value={centsToYuan(totalInvested)}
            suffix="元"
            size={24}
          />
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          系统每天北京时间
          {" "}
          <Text strong>10:00</Text>
          {" "}
          扫描到期的定投计划并自动下单，
          当晚 20:30 按当日净值撮合确认。现金不足时该期跳过，不影响其他计划。
        </Paragraph>
      </SectionCard>

      <SectionCard title="计划列表">
        {plans.length === 0
          ? (
              <EmptyState description="还没有定投计划">
                <Button type="primary" onClick={() => setOpen(true)}>
                  创建第一个计划
                </Button>
              </EmptyState>
            )
          : (
              <DcaPlanList
                plans={plans}
                renderActions={p => (
                  <Space>
                    <fetcher.Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={p.status === "active" ? "paused" : "active"}
                      />
                      <Button size="small" htmlType="submit">
                        {p.status === "active" ? "暂停" : "启用"}
                      </Button>
                    </fetcher.Form>
                    <Popconfirm
                      title="确定删除这个定投计划？"
                      description="已产生的订单和持仓不受影响。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() =>
                        fetcher.submit(
                          { intent: "delete", id: String(p.id) },
                          { method: "post" },
                        )}
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                )}
              />
            )}
      </SectionCard>

      {/* 新建计划弹窗 */}
      <Modal
        title="新建定投计划"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="create" />

          <Form.Item
            label="基金代码"
            layout="vertical"
            extra="6 位数字。需先在基金详情页访问过一次，系统才会收录该基金"
          >
            <Input name="fundCode" placeholder="如 000001" maxLength={6} />
          </Form.Item>

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
              <Select
                value={dayOfWeek}
                options={WEEKDAYS}
                onChange={v => setDayOfWeek(v)}
              />
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
            创建计划
          </Button>
        </fetcher.Form>
      </Modal>
    </Space>
  );
}
