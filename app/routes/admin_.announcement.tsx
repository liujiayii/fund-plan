import type { Route } from "./+types/admin_.announcement";
import { Alert, Button, Form, Input, InputNumber, Space, Switch, Typography } from "antd";
import { useFetcher } from "react-router";
import {
  ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS,
  ANNOUNCEMENT_MAX_CHARS,
  ANNOUNCEMENT_MAX_COOLDOWN_DAYS,
  validateAnnouncementInput,
} from "~/domain/announcement";
import { pageMeta } from "~/domain/seo";
import { toBeijing } from "~/domain/trading-calendar";
import {
  readAnnouncement,
  saveAnnouncement,
} from "~/services/announcement-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "公告 · 管理后台", path: "/admin", index: false });
}

/**
 * 公告编辑（全站横幅的唯一写入口，设计 §3）。
 *
 * 刻意独立成页而不放进 /admin：后台是「纯只读的排查工具」，这里是运营
 * 写操作，混进去会破坏那条设计承诺。文件名 admin_. 尾下划线断开嵌套，
 * 同 admin_.users.$id.tsx。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  await requireAdmin(request, db);
  return { notice: await readAnnouncement(env) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  // 权限必须在 try 之外：requireAdmin 抛的是 403 Response，
  // 掉进业务 catch 会变成 200 + { ok:false }，等于把拦截吞掉（plan.tsx 同款纪律）
  await requireAdmin(request, db);

  const fd = await request.formData();
  const rawCooldown = fd.get("cooldownDays");
  const input = {
    enabled: fd.get("enabled") === "1",
    zh: String(fd.get("zh") ?? ""),
    en: String(fd.get("en") ?? ""),
    // ⚠️ 缺失/空串不能 Number() 直转——Number(null)/Number("") 都是 0，
    // 会把「没填」静默存成 0 天。显式走 NaN 通道交给校验拒绝
    // （CodeRabbit PR #114；正常表单永远带该字段，缺失即请求被篡改）
    cooldownDays: rawCooldown === null || rawCooldown === "" ? Number.NaN : Number(rawCooldown),
  };

  const invalid = validateAnnouncementInput(input);
  if (invalid)
    return { error: invalid };

  try {
    await saveAnnouncement(env, input);
    return { ok: true, message: "公告已保存，游客页几分钟内收敛生效" };
  }
  catch (err) {
    // 保存失败必须明确报错（主操作不是旁路缓存），不能静默吞掉
    return { error: err instanceof Error ? err.message : "保存失败" };
  }
}

interface FormValues {
  enabled: boolean;
  zh: string;
  en: string;
  cooldownDays: number;
}

export default function AdminAnnouncement({ loaderData }: Route.ComponentProps) {
  const { notice } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const submitting = fetcher.state === "submitting";
  const [form] = Form.useForm<FormValues>();

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>全站公告</Title>

      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        顶部通栏横幅，全站可见；中英文两行同时展示，英文可留空。
        每次保存版本号都会变化——已关闭过的用户会重新看到新公告。
        游客页有边缘缓存，内容变更几分钟内收敛生效。
      </Paragraph>

      {fetcher.data?.ok && <Alert type="success" showIcon message={fetcher.data.message} closable />}
      {fetcher.data?.error && <Alert type="error" showIcon message={fetcher.data.error} closable />}

      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{
          enabled: notice?.enabled ?? false,
          zh: notice?.zh ?? "",
          en: notice?.en ?? "",
          cooldownDays: notice?.cooldownDays ?? ANNOUNCEMENT_DEFAULT_COOLDOWN_DAYS,
        }}
        onFinish={values =>
          fetcher.submit(
            {
              enabled: values.enabled ? "1" : "0",
              zh: values.zh,
              en: values.en,
              cooldownDays: String(values.cooldownDays),
            },
            { method: "post" },
          )}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Space align="center">
            <Form.Item name="enabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
            <Text>{notice?.enabled ? "当前已开启" : "当前已关闭"}</Text>
          </Space>

          <Form.Item
            name="zh"
            label="中文内容（支持换行）"
            rules={[{ max: ANNOUNCEMENT_MAX_CHARS, message: `不能超过 ${ANNOUNCEMENT_MAX_CHARS} 字` }]}
          >
            <Input.TextArea
              showCount
              maxLength={ANNOUNCEMENT_MAX_CHARS}
              autoSize={{ minRows: 6, maxRows: 16 }}
            />
          </Form.Item>

          <Form.Item
            name="cooldownDays"
            label="关闭后冷却（天）"
            extra={`用户点关闭后 N 天内不再显示，之后自动重现；0 表示仅当前页面生效。默认 1 天，可设 0~${ANNOUNCEMENT_MAX_COOLDOWN_DAYS}`}
            rules={[{ required: true, message: "必填" }]}
          >
            <InputNumber
              min={0}
              max={ANNOUNCEMENT_MAX_COOLDOWN_DAYS}
              precision={0}
              style={{ width: 120 }}
            />
          </Form.Item>

          <Form.Item
            name="en"
            label="English（可留空）"
            rules={[{ max: ANNOUNCEMENT_MAX_CHARS, message: `Max ${ANNOUNCEMENT_MAX_CHARS} chars` }]}
          >
            <Input.TextArea
              showCount
              maxLength={ANNOUNCEMENT_MAX_CHARS}
              autoSize={{ minRows: 4, maxRows: 10 }}
            />
          </Form.Item>

          <div>
            <Button type="primary" htmlType="submit" loading={submitting}>保存</Button>
            {notice && (
              <Text type="secondary" style={{ marginLeft: 12 }}>
                线上版本
                {" "}
                {notice.version}
                {" · 更新于 "}
                {toBeijing(new Date(notice.updatedAt)).format("YYYY-MM-DD HH:mm")}
              </Text>
            )}
          </div>
        </Space>
      </Form>
    </Space>
  );
}
