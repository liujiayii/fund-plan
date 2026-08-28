import type { Route } from "./+types/register";
import { Alert, Button, Form, Input, Typography } from "antd";
import { redirect, Form as RouterForm, useActionData, useNavigation } from "react-router";
import { SectionCard } from "~/components/ui/SectionCard";
import { registerUser } from "~/services/auth";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { createSession, sessionCookie } from "~/services/session";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "注册 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await getCurrentUser(request, db);
  if (user)
    throw redirect("/me");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const fd = await request.formData();
  const username = String(fd.get("username") ?? "");
  const password = String(fd.get("password") ?? "");
  const password2 = String(fd.get("password2") ?? "");

  if (password !== password2) {
    return { error: "两次输入的密码不一致" };
  }

  try {
    const user = await registerUser(db, env, username, password);
    // 注册即登录，省一步
    const token = await createSession(db, user.id);
    return redirect("/me", {
      headers: { "Set-Cookie": sessionCookie(token) },
    });
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "注册失败，请稍后再试" };
  }
}

export default function Register() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  return (
    // 定位交给外层 div：SectionCard 刻意不透传 className / style，
    // 但注册卡要窄、要居中，所以宽度与外边距在这一层给
    // min(420px, 100%)：显式兜底窄屏（Task 10）——原先只写 420，
    // 依赖「外层 Content padding 恰好小于 420」的巧合，现在不依赖了
    <div style={{ maxWidth: "min(420px, 100%)", margin: "48px auto" }}>
      <SectionCard>
        <Title level={3}>注册</Title>
        <Paragraph type="secondary">
          注册即送
          {" "}
          <strong>10 万元</strong>
          {" "}
          模拟本金，每日签到还能继续领。
          用真实基金数据练手，亏了不心疼。
        </Paragraph>

        {actionData?.error && (
          <Alert
            type="error"
            message={actionData.error}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <RouterForm method="post">
          <Form.Item
            label="用户名"
            layout="vertical"
            extra="3-20 位字母、数字、下划线或中文"
            style={{ marginBottom: 16 }}
          >
            <Input name="username" size="large" placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            layout="vertical"
            extra="至少 6 位"
            style={{ marginBottom: 16 }}
          >
            <Input.Password
              name="password"
              size="large"
              placeholder="密码"
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item label="确认密码" layout="vertical" style={{ marginBottom: 24 }}>
            <Input.Password
              name="password2"
              size="large"
              placeholder="再输一次密码"
              autoComplete="new-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            注册并开盘
          </Button>
        </RouterForm>

        <Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          已有账号？
          <a href="/login">去登录</a>
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          提示：本站不发邮件，忘记密码需联系管理员重置，请记好密码。
        </Paragraph>
      </SectionCard>
    </div>
  );
}
