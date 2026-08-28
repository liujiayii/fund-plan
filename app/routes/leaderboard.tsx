import type { Route } from "./+types/leaderboard";
import type { LeaderboardEntry } from "~/domain/leaderboard";
import { Space, Tabs, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { getLeaderboard } from "~/services/leaderboard-service";
import { COLOR } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "收益排行榜 · 模拟基金" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  // 游客也可看（公开页，与 /master 同级）；已登录则带上 id 用于钉「我的排名」
  const [me, lb] = await Promise.all([
    getCurrentUser(request, db),
    getLeaderboard(db),
  ]);
  return { me, lb };
}

/** 名次徽章：前三金/银/铜色，其余灰 */
function RankBadge({ rank }: { rank: number }) {
  const color = rank === 1 ? "#f5a623" : rank === 2 ? "#a0a0a0" : rank === 3 ? "#b07840" : undefined;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 12,
        background: color ?? "transparent",
        color: color ? "#fff" : COLOR.textSecondary,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {rank}
    </span>
  );
}

/** 单行榜单条目 */
function LeaderRow({
  entry,
  meId,
}: {
  entry: LeaderboardEntry;
  meId: number | null;
}) {
  const isMe = meId !== null && entry.userId === meId;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 0",
        borderBottom: `1px solid ${COLOR.border}`,
        background: isMe ? "rgba(22,119,255,0.06)" : undefined,
      }}
    >
      <RankBadge rank={entry.rank} />
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontWeight: 500, color: COLOR.textPrimary }}>
          {entry.username}
          {isMe && <Tag color="blue" style={{ marginLeft: 8 }}>我</Tag>}
        </div>
        <div style={{ fontSize: 12, color: COLOR.textSecondary, marginTop: 2 }}>
          总资产
          {" "}
          {fmtYuan(entry.totalAssetCents)}
          {" "}
          元
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <PnlText cents={entry.totalPnlCents} size={14} />
        <div style={{ marginTop: 2 }}>
          <PnlText rate={entry.totalPnlRate} size={12} />
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard({ loaderData }: Route.ComponentProps) {
  const { me, lb } = loaderData;
  const meId = me?.id ?? null;

  /** 自己的条目（可能不在榜上：没成交过 / 没登录） */
  const mine
    = meId === null ? null : lb.byRate.find(e => e.userId === meId) ?? null;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          收益排行榜
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          总收益 = 总资产 − 累计入金（初始本金 + 签到奖励）。已清仓落袋的收益也保留在榜上，
          只签到不买基金刷不了榜。
        </Paragraph>
      </div>

      <SectionCard>
        {lb.byRate.length === 0
          ? (
              <EmptyState description="还没有人开过单">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  注册后买第一只基金，就能上榜了
                </Typography.Text>
              </EmptyState>
            )
          : (
              <Tabs
                defaultActiveKey="rate"
                items={[
                  {
                    key: "rate",
                    label: "收益率榜",
                    children: lb.byRate.map(e => (
                      <LeaderRow key={e.userId} entry={e} meId={meId} />
                    )),
                  },
                  {
                    key: "pnl",
                    label: "总收益榜",
                    children: lb.byPnl.map(e => (
                      <LeaderRow key={e.userId} entry={e} meId={meId} />
                    )),
                  },
                ]}
              />
            )}
      </SectionCard>

      {/* 已登录且不在榜单前排（前三名）时：底部钉一行「我的排名」。
          前三名本身已在榜单前排高亮，再渲染卡片会重复出现两次；
          未上榜（没成交过）时保留引导空态，形成引导闭环 */}
      {meId !== null && (mine === null || mine.rank > 3) && (
        <SectionCard title="我的排名">
          {mine
            ? (
                <LeaderRow entry={mine} meId={meId} />
              )
            : (
                <EmptyState description="还没有上榜——下一单就能上榜" />
              )}
        </SectionCard>
      )}
    </Space>
  );
}
