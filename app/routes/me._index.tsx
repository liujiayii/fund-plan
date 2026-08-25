import type { Route } from "./+types/me._index";
import {
  Alert,
  Button,
  Col,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useFetcher } from "react-router";
import { HoldingList, sharesAndNavNote } from "~/components/HoldingList";
import { OrderList } from "~/components/OrderList";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { CHECKIN_MAX_CENTS } from "~/domain/checkin";
import { centsToYuan } from "~/domain/money";
import { doCheckin, getCheckinStatus } from "~/services/checkin-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { getOrders, getPortfolio } from "~/services/portfolio-service";
import { COLOR, pnlColor } from "~/theme";

const { Title, Text, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "我的仪表盘 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  const [portfolio, checkinStatus, orders] = await Promise.all([
    getPortfolio(db, user.id),
    getCheckinStatus(db, user.id),
    getOrders(db, user.id, 5),
  ]);

  return { user, portfolio, checkinStatus, orders };
}

/** 签到 action */
export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  try {
    const r = await doCheckin(db, user.id);
    return {
      ok: true,
      message: `签到成功！连签第 ${r.streak} 天，领取 ${centsToYuan(r.reward)} 元`,
    };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "签到失败" };
  }
}

export default function MeIndex({ loaderData }: Route.ComponentProps) {
  const { user, portfolio, checkinStatus, orders } = loaderData;
  const { summary, holdings } = portfolio;
  const fetcher = useFetcher<typeof action>();
  const signing = fetcher.state === "submitting";

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          {user.username}
          {" "}
          的模拟盘
          {user.role === "admin" && <Tag color="blue" style={{ marginLeft: 8 }}>主人</Tag>}
        </Title>
        {user.role === "admin" && (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            你的盘是公开示范盘，所有访客都能在
            {" "}
            <a href="/master">/master</a>
            {" "}
            围观。
          </Paragraph>
        )}
      </div>

      {/* 资产总览。⚠️ 期二会在这里加「资产走势曲线」与「收益（截至 X 日）」，
          本期只做视觉，不动数据来源 */}
      <SectionCard>
        <Row gutter={[24, 16]}>
          <Col xs={12} md={6}>
            <StatBig
              label="总资产"
              value={centsToYuan(summary.totalAssetCents)}
              suffix="元"
            />
          </Col>
          <Col xs={12} md={6}>
            <StatBig
              label="持仓市值"
              value={centsToYuan(summary.marketValueCents)}
              suffix="元"
              size={24}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatBig
              label="可用现金"
              value={centsToYuan(summary.cashCents)}
              suffix="元"
              size={24}
            />
          </Col>
          <Col xs={12} md={6}>
            <StatBig
              label="浮动盈亏"
              value={`${summary.totalPnlCents > 0 ? "+" : ""}${centsToYuan(summary.totalPnlCents)}`}
              suffix="元"
              size={24}
              color={pnlColor(summary.totalPnlCents)}
              extra={`收益率 ${(summary.totalPnlRate * 100).toFixed(2)}%`}
            />
          </Col>
        </Row>
      </SectionCard>

      {/* 每日签到 */}
      <SectionCard title="每日签到领本金">
        {fetcher.data?.ok && (
          <Alert type="success" showIcon message={fetcher.data.message} style={{ marginBottom: 16 }} />
        )}
        {fetcher.data?.error && (
          <Alert type="error" showIcon message={fetcher.data.error} style={{ marginBottom: 16 }} />
        )}

        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={8}>
            <StatBig label="当前连签" value={checkinStatus.streak} suffix="天" size={24} />
          </Col>
          <Col xs={24} md={8}>
            {/* ⚠️ 签到金额用主色蓝而非涨红：这是「领取本金」的操作引导，
                不是投资收益。用红色会让人误以为赚了钱 */}
            <StatBig
              label={checkinStatus.checkedToday ? "明天可领" : "今天可领"}
              value={centsToYuan(checkinStatus.nextReward)}
              suffix="元"
              size={24}
              color={COLOR.primary}
            />
            <Progress
              percent={Math.round((checkinStatus.nextReward / CHECKIN_MAX_CENTS) * 100)}
              size="small"
              showInfo={false}
              style={{ marginTop: 8 }}
              // ⚠️ strokeColor 必须显式传，不能删。
              // antd 在 percent >= 100 且未显式传 status 时会自动切成
              // status="success"（antd/lib/progress/progress.js:66-68），
              // 进度条变**绿** —— 而绿色在本项目专属「跌」。
              // 连签封顶正是 percent === 100，会渲染出一条绿色进度条，读作亏损。
              strokeColor={COLOR.primary}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              连签递增，每天 +50 元，封顶 500 元
            </Text>
          </Col>
          <Col xs={24} md={8}>
            <StatBig
              label="累计签到入金"
              value={centsToYuan(checkinStatus.totalCheckin)}
              suffix="元"
              size={24}
            />
            <fetcher.Form method="post" style={{ marginTop: 12 }}>
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                block
                loading={signing}
                disabled={checkinStatus.checkedToday}
              >
                {checkinStatus.checkedToday ? "今日已签到" : "立即签到"}
              </Button>
            </fetcher.Form>
          </Col>
        </Row>
      </SectionCard>

      {/* 持仓速览 */}
      <SectionCard title="我的持仓" extra={<a href="/me/holdings">管理持仓 →</a>}>
        {holdings.length === 0
          ? (
              <EmptyState description="还没有持仓">
                <Button type="primary" href="/funds">
                  去挑一只基金
                </Button>
              </EmptyState>
            )
          : (
              <HoldingList holdings={holdings} renderNote={sharesAndNavNote} />
            )}
      </SectionCard>

      {/* 最近订单 */}
      <SectionCard title="最近订单" extra={<a href="/me/orders">全部订单 →</a>}>
        {orders.length === 0
          ? (
              <EmptyState description="还没有交易记录" />
            )
          : (
              <OrderList orders={orders} />
            )}
      </SectionCard>
    </Space>
  );
}
