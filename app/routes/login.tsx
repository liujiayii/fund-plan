import type { Route } from "./+types/login";
import { Alert, Button, Form, Input, Typography } from "antd";
import { redirect, Form as RouterForm, useActionData, useNavigation } from "react-router";
import { SectionCard } from "~/components/ui/SectionCard";
import { loginUser } from "~/services/auth";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { createSession, sessionCookie } from "~/services/session";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "登录 · 模拟基金" }];
}

/** 已登录的话直接送去仪表盘，别让人重复登录 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await getCurrentUser(request, db);
  if (user)
    throw redirect("/me");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const fd = await request.formData();
  const username = String(fd.get("username") ?? "");
  const password = String(fd.get("password") ?? "");
  const redirectTo = String(fd.get("redirectTo") ?? "/me");

  if (!username || !password) {
    return { error: "请填写用户名和密码" };
  }

  const user = await loginUser(db, username, password);
  if (!user) {
    // 刻意不区分「用户不存在」与「密码错误」，避免用户名枚举
    return { error: "用户名或密码不正确" };
  }

  const token = await createSession(db, user.id);
  // 只允许跳回站内路径，防开放重定向
  const safeTo = redirectTo.startsWith("/") ? redirectTo : "/me";
  return redirect(safeTo, {
    headers: { "Set-Cookie": sessionCookie(token) },
  });
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  // 从 URL 取登录后要跳回的地址（由 requireUser 附加）
  const redirectTo
    = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("redirectTo") ?? "/me"
      : "/me";

  return (
    // 定位交给外层 div：SectionCard 刻意不透传 className / style，
    // 但登录卡要窄、要居中，所以宽度与外边距在这一层给
    <div style={{ maxWidth: 420, margin: "48px auto" }}>
      <SectionCard>
        <Title level={3}>登录</Title>
        <Paragraph type="secondary">登录后即可管理自己的模拟盘、定投与签到。</Paragraph>

        {actionData?.error && (
          <Alert
            type="error"
            message={actionData.error}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <RouterForm method="post">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <Form.Item label="用户名" layout="vertical" style={{ marginBottom: 16 }}>
            <Input name="username" size="large" placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" layout="vertical" style={{ marginBottom: 24 }}>
            <Input.Password
              name="password"
              size="large"
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
            登录
          </Button>
        </RouterForm>

        <Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: "center" }}>
          还没有账号？
          <a href="/register">立即注册，送 10 万模拟本金</a>
        </Paragraph>
      </SectionCard>
    </div>
  );
}
