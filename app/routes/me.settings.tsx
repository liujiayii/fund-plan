import type { Route } from "./+types/me.settings";
import {
  Alert,
  Button,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from "antd";
import { eq } from "drizzle-orm";
import { useFetcher } from "react-router";
import { DataRow } from "~/components/ui/DataRow";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import {
  account,
  checkin,
  dcaPlan,
  holding,
  orders,
  shareLot,
  transactions,
  user as userTable,
} from "~/db/schema";
import { centsToYuan } from "~/domain/money";
import { changePassword } from "~/services/auth";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "设置 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  const acc = await db.query.account.findFirst({
    where: eq(account.userId, user.id),
  });
  const u = await db.query.user.findFirst({
    where: eq(userTable.id, user.id),
  });

  return {
    user,
    account: {
      cash: acc?.cash ?? 0,
      initialCash: acc?.initialCash ?? 0,
      totalCheckin: acc?.totalCheckin ?? 0,
      createdAt: acc?.createdAt ?? 0,
    },
    registeredAt: u?.createdAt ?? 0,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  try {
    if (intent === "changePassword") {
      const oldPwd = String(fd.get("oldPassword") ?? "");
      const newPwd = String(fd.get("newPassword") ?? "");
      const newPwd2 = String(fd.get("newPassword2") ?? "");
      if (newPwd !== newPwd2)
        return { error: "两次输入的新密码不一致" };
      await changePassword(db, user.id, oldPwd, newPwd);
      return { ok: true, message: "密码已修改，下次登录请用新密码" };
    }

    if (intent === "reset") {
      const acc = await db.query.account.findFirst({
        where: eq(account.userId, user.id),
      });
      if (!acc)
        return { error: "账户不存在" };

      // 清空该用户的交易痕迹，现金恢复初始本金。
      // 注意 totalCheckin 一并归零，否则「累计签到」与流水对不上账。
      await db.batch([
        db.delete(shareLot).where(eq(shareLot.userId, user.id)),
        db.delete(holding).where(eq(holding.userId, user.id)),
        db.delete(orders).where(eq(orders.userId, user.id)),
        db.delete(dcaPlan).where(eq(dcaPlan.userId, user.id)),
        db.delete(transactions).where(eq(transactions.userId, user.id)),
        db.delete(checkin).where(eq(checkin.userId, user.id)),
        db
          .update(account)
          .set({ cash: acc.initialCash, totalCheckin: 0 })
          .where(eq(account.userId, user.id)),
        db.insert(transactions).values({
          userId: user.id,
          type: "init",
          amount: acc.initialCash,
          balance: acc.initialCash,
          note: "重置模拟盘，恢复初始本金",
          createdAt: Date.now(),
        }),
      ]);

      return { ok: true, message: "模拟盘已重置，现金恢复初始本金" };
    }

    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

export default function MeSettings({ loaderData }: Route.ComponentProps) {
  const { user, account: acc, registeredAt } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const submitting = fetcher.state === "submitting";

  const fmtTime = (ts: number) =>
    ts ? new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        设置
      </Title>

      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} closable />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} closable />
      )}

      <SectionCard title="账户信息">
        <DataRow label="用户名" value={user.username} />
        <DataRow
          label="角色"
          value={
            user.role === "admin"
              ? <Tag color="blue">管理员（组合公开）</Tag>
              : <Tag>普通用户</Tag>
          }
        />
        <DataRow label="注册时间" value={fmtTime(registeredAt)} />
        <DataRow label="初始本金" value={`${centsToYuan(acc.initialCash)} 元`} />
        <DataRow label="当前现金" value={`${centsToYuan(acc.cash)} 元`} />
        <DataRow
          label="累计签到入金"
          value={`${centsToYuan(acc.totalCheckin)} 元`}
          last
        />
      </SectionCard>

      <SectionCard title="修改密码">
        <fetcher.Form method="post" style={{ maxWidth: 420 }}>
          <input type="hidden" name="intent" value="changePassword" />
          <Form.Item label="当前密码" layout="vertical">
            <Input.Password name="oldPassword" autoComplete="current-password" />
          </Form.Item>
          <Form.Item label="新密码" layout="vertical" extra="至少 6 位">
            <Input.Password name="newPassword" autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="确认新密码" layout="vertical">
            <Input.Password name="newPassword2" autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting}>
            修改密码
          </Button>
        </fetcher.Form>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          本站不发邮件，忘记密码需联系管理员手动重置，请务必记好。
        </Paragraph>
      </SectionCard>

      <SectionCard title="重置模拟盘">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message="这是不可逆操作"
            description={(
              <div>
                将
                <Text strong>清空</Text>
                你的全部持仓、份额批次、订单、定投计划、
                资金流水与签到记录，现金恢复为初始本金
                {" "}
                <Text strong>
                  {centsToYuan(acc.initialCash)}
                  {" "}
                  元
                </Text>
                。
                <br />
                想从头再来的时候用它，练手练废了不用重新注册。
              </div>
            )}
          />
          <StatBig
            label="重置后现金"
            value={centsToYuan(acc.initialCash)}
            suffix="元"
            size={24}
          />
          <Popconfirm
            title="确定要重置模拟盘？"
            description="全部交易记录会被清空，无法恢复。"
            okText="确定重置"
            okButtonProps={{ danger: true }}
            cancelText="算了"
            onConfirm={() =>
              fetcher.submit({ intent: "reset" }, { method: "post" })}
          >
            <Button danger loading={submitting}>
              重置模拟盘
            </Button>
          </Popconfirm>
        </Space>
      </SectionCard>
    </Space>
  );
}
