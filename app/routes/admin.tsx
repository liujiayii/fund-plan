import type { TableProps } from "antd";
import type { Route } from "./+types/admin";
import type { UserOverview } from "~/services/admin-service";
import { Input, Space, Table, Tag, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { fmtInt, fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { pageMeta } from "~/domain/seo";
import { toBeijing } from "~/domain/trading-calendar";
import { getAdminStats, listUsersOverview } from "~/services/admin-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "管理后台", path: "/admin", index: false });
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
  const [nameQuery, setNameQuery] = useState("");
  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q)
      return users;
    return users.filter(u => u.username.toLowerCase().includes(q));
  }, [users, nameQuery]);

  // 用 TableProps[...]["columns"] 收紧行类型，render 的 (value, record) 自动推断
  // 列序：先资产与订单（排查时最常对的数），现金 / 入金 / 角色靠后
  const columns: TableProps<UserOverview>["columns"] = [
    {
      title: "用户",
      dataIndex: "username",
      // 用户名即详情页入口
      render: (_, r) => <Link to={`/admin/users/${r.id}`}>{r.username}</Link>,
    },
    {
      // 选基收益率的分母。与「账户收益」并排，才能核对比率是不是
      // 收益金额 ÷ 累计买入额（闲钱不进这个分母）
      title: "累计买入",
      dataIndex: "investedCents",
      align: "right",
      render: v => fmtYuan(v),
    },
    {
      // ⚠️ 与排行榜「总收益」同口径：含现金、在途、已实现盈亏与全部费用。
      // 排查榜单数字时对的是这一列，不是下面的「持仓浮盈」。
      // 比率是选基收益率（÷ 累计买入），不再是旧的账户收益率（÷ 累计入金）
      title: "账户收益",
      dataIndex: "accountPnlCents",
      align: "right",
      render: (v, r) => <PnlText cents={v} rate={r.accountPnlRate ?? undefined} />,
    },
    {
      // PnlText 的 rate 可不传：只传 cents 就只渲染金额段（正负判色仍生效）。
      // 纯浮盈口径（市值 − 持仓成本），不含现金与已实现盈亏——列名必须写全
      title: "持仓浮盈",
      dataIndex: "holdingPnlCents",
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
      // 与排行榜「总资产」同口径（市值 + 现金 + 在途）
      title: "总资产",
      dataIndex: "totalAssetCents",
      align: "right",
      render: v => fmtYuan(v),
    },
    {
      title: "现金",
      dataIndex: "cashCents",
      align: "right",
      render: (v, r) =>
        // 有在途时标出来：pending 买单的钱已从现金扣、尚未变成份额，
        // 不标的话排查「现金为什么对不上」时会漏掉这一笔
        r.inFlightCents > 0
          ? (
              <Tooltip title={`另有申购中在途 ${fmtYuan(r.inFlightCents)} 元（已冻结，待撮合）`}>
                <span>{fmtYuan(v)}</span>
              </Tooltip>
            )
          : fmtYuan(v),
    },
    {
      // 总收益的对照基准（收益 = 总资产 − 累计入金）。
      // 它不再是收益率的分母——比率看的是「累计买入」
      title: "累计入金",
      dataIndex: "depositedCents",
      align: "right",
      render: v => fmtYuan(v),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 90,
      render: role =>
        role === "admin" ? <Tag>主理人</Tag> : <Tag>用户</Tag>,
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      width: 110,
      render: v => toBeijing(new Date(v)).format("YYYY-MM-DD"),
    },
    {
      // 登录访问才记；存量 / 从没带会话进过站的为 null，跟注册来源同一套 —
      title: "最后活跃",
      dataIndex: "lastActiveAt",
      width: 140,
      render: (v: number | null) =>
        v == null
          ? <Typography.Text type="secondary">—</Typography.Text>
          : toBeijing(new Date(v)).format("YYYY-MM-DD HH:mm"),
    },
    {
      // 注册来源：排查「这号是谁/是不是脚本」的第一手证据。
      // UA 全串太长，悬浮才展示；IP/地区常显。存量用户（加列之前注册）显示 —
      title: "注册来源",
      dataIndex: "registerIp",
      width: 170,
      render: (_, r) => {
        // 四字段全空才算「无记录」（存量用户）；IP 缺失但地区/UA 在时
        // 照常展示已有数据，IP 单独占位 —（评审修正：不能只看 registerIp）
        const hasSource
          = r.registerIp || r.registerUserAgent || r.registerCountry || r.registerCity;
        if (!hasSource)
          return <Typography.Text type="secondary">—</Typography.Text>;
        // 地区串：城市缺失退国家，都缺就只显 IP
        const region = [r.registerCity, r.registerCountry].filter(Boolean).join(" · ");
        return (
          <Tooltip title={r.registerUserAgent ?? "无 UA 记录"} placement="topLeft">
            <div className="text-xs leading-16px">
              <div className="font-num">{r.registerIp ?? "—"}</div>
              {region && <div className="text-muted">{region}</div>}
            </div>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>管理后台</Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          只读视图：排查用户问题与全局运行状况。点用户名进入其组合与订单。
          表里有两个收益口径：「账户收益」= 总资产 − 累计入金，与排行榜「总收益」
          同口径、可直接对账；「持仓浮盈」= 市值 − 持仓成本，只含当前持仓。
        </Paragraph>
      </div>

      {/* animate-fade-up：区块进场淡入（首卡无延迟） */}
      <SectionCard className="animate-fade-up">
        {/* 全局监控三格。主位是用户数（本页主题），其余次位 24 */}
        <Space size={[16, 16]} wrap>
          <StatBig label="注册用户" value={fmtInt(stats.users)} />
          <StatBig label="待撮合订单" value={fmtInt(stats.pendingOrders)} size={24} />
          <StatBig label="今日已撮合" value={fmtInt(stats.todayConfirmedOrders)} size={24} />
        </Space>
      </SectionCard>

      {/* 交错进场：第 2 卡延迟 60ms（animate-delay 写法的坑见 uno.config.ts） */}
      <SectionCard
        title={`用户（${filtered.length}${filtered.length === users.length ? "" : ` / ${users.length}`}）`}
        className="animate-fade-up animate-delay-[60ms]"
        extra={(
          <Input.Search
            allowClear
            placeholder="按用户名筛选"
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            className="w-[200px]"
          />
        )}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          pagination={false}
          size="middle"
          scroll={{ x: 1560 }}
        />
      </SectionCard>
    </Space>
  );
}
