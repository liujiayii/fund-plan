import type { TableProps } from "antd";
import type { Route } from "./+types/admin";
import type { UserOverview } from "~/services/admin-service";
import { Space, Table, Tag, Typography } from "antd";
import { Link } from "react-router";
import { fmtInt, fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { toBeijing } from "~/domain/trading-calendar";
import { getAdminStats, listUsersOverview } from "~/services/admin-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "管理后台 · 模拟基金" }];
}

/** admin 只读后台：全局统计 + 用户列表。写操作一概没有（见设计文档非目标） */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  await requireAdmin(request, db);

  const [stats, users] = await Promise.all([
    getAdminStats(db),
    listUsersOverview(db),
  ]);
  return { stats, users };
}

export default function AdminIndex({ loaderData }: Route.ComponentProps) {
  const { stats, users } = loaderData;

  // 用 TableProps[...]["columns"] 收紧行类型，render 的 (value, record) 自动推断
  const columns: TableProps<UserOverview>["columns"] = [
    {
      title: "用户",
      dataIndex: "username",
      // 用户名即详情页入口（Task 5 落地前点击为 404，属预期）
      render: (_, r) => <Link to={`/admin/users/${r.id}`}>{r.username}</Link>,
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 90,
      render: role =>
        role === "admin" ? <Tag color="blue">主理人</Tag> : <Tag>用户</Tag>,
    },
    {
      title: "现金",
      dataIndex: "cashCents",
      align: "right",
      render: v => fmtYuan(v),
    },
    {
      title: "持仓市值",
      dataIndex: "marketValueCents",
      align: "right",
      render: v => fmtYuan(v),
    },
    {
      // PnlText 的 rate 可不传：只传 cents 就只渲染金额段（正负判色仍生效）
      title: "浮动盈亏",
      dataIndex: "totalPnlCents",
      align: "right",
      render: v => <PnlText cents={v} />,
    },
    {
      title: "订单数",
      dataIndex: "orderCount",
      align: "right",
      width: 80,
      render: v => fmtInt(v),
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      width: 110,
      render: v => toBeijing(new Date(v)).format("YYYY-MM-DD"),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>管理后台</Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          只读视图：排查用户问题与全局运行状况。点用户名进入其组合与订单。
        </Paragraph>
      </div>

      <SectionCard>
        {/* 全局监控三格。主位是用户数（本页主题），其余次位 24 */}
        <Space size={[16, 16]} wrap>
          <StatBig label="注册用户" value={fmtInt(stats.users)} />
          <StatBig label="待撮合订单" value={fmtInt(stats.pendingOrders)} size={24} />
          <StatBig label="今日已撮合" value={fmtInt(stats.todayConfirmedOrders)} size={24} />
        </Space>
      </SectionCard>

      <SectionCard title={`用户（${users.length}）`}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          pagination={false}
          size="middle"
          scroll={{ x: 720 }}
        />
      </SectionCard>
    </Space>
  );
}
