import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Form as RouterForm, redirect, useActionData, useNavigation } from 'react-router';
import type { Route } from './+types/register';
import { registerUser } from '~/services/auth';
import { getAppContext } from '~/services/context';
import { getCurrentUser } from '~/services/guard';
import { createSession, sessionCookie } from '~/services/session';

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: '注册 · 模拟基金' }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await getCurrentUser(request, db);
  if (user) throw redirect('/me');
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const fd = await request.formData();
  const username = String(fd.get('username') ?? '');
  const password = String(fd.get('password') ?? '');
  const password2 = String(fd.get('password2') ?? '');

  if (password !== password2) {
    return { error: '两次输入的密码不一致' };
  }

  try {
    const user = await registerUser(db, env, username, password);
    // 注册即登录，省一步
    const token = await createSession(db, user.id);
    return redirect('/me', {
      headers: { 'Set-Cookie': sessionCookie(token) },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : '注册失败，请稍后再试' };
  }
}

export default function Register({ }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === 'submitting';

  return (
    <Card style={{ maxWidth: 420, margin: '48px auto' }}>
      <Title level={3}>注册</Title>
      <Paragraph type="secondary">
        注册即送 <strong>10 万元</strong> 模拟本金，每日签到还能继续领。
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

      <Paragraph style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
        已有账号？<a href="/login">去登录</a>
      </Paragraph>
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        提示：本站不发邮件，忘记密码需联系管理员重置，请记好密码。
      </Paragraph>
    </Card>
  );
}
