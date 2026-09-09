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

/**
 * 名次徽章：前三金/银/铜色，其余灰。
 * 金银铜是页面局部装饰色，不是全站 token——用任意值写死在此处，
 * 别塞进 theme.ts（那里只放跨页复用的语义色）。
 * 颜色分支刻意互斥（medal 里带全自己的 text-*），避免 text-white 与
 * text-muted 同挂一个元素、输赢看产物 CSS 里的先后顺序。
 */
function RankBadge({ rank }: { rank: number }) {
  const medal
    = rank === 1
      ? "bg-[#f5a623] text-white"
      : rank === 2
        ? "bg-[#a0a0a0] text-white"
        : rank === 3
          ? "bg-[#b07840] text-white"
          : "text-muted";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-xl text-[13px] font-semibold ${medal}`}
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
    // 自己的条目淡蓝高亮：bg-primary/6 = 主色 6% 透明度（原 rgba(22,119,255,0.06)）
    // ⚠️ 单边边框的正确姿势是 border-b + [border-bottom-style:solid]：
    //   border-b 只出宽度不出 style，但千万别用 border-solid 补——它把 solid
    //   应用到四边，没给宽度的三边走初始值 medium（=3px），整行被 3px 浅灰
    //   框住（PR #76 上线后实测踩坑，Playwright 计算样式取证）
    <div
      // hover 底色只给非本人的行：本人的 bg-primary/6 高亮若再叠 hover:bg-page
      // 会被盖掉（产物同优先级、后者居后），悬停自己的行不该丢自己的高亮
      // （CodeRabbit PR #79 修正）；transition-colors 全行保留，bg 固定时无副作用
      className={`flex items-center gap-3 border-b border-line py-3 [border-bottom-style:solid] transition-colors ${isMe ? "bg-primary/6" : "hover:bg-page"}`}
    >
      <RankBadge rank={entry.rank} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="font-medium text-ink">
          {entry.username}
          {isMe && <Tag color="blue" className="ml-2">我</Tag>}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          总资产
          {" "}
          {fmtYuan(entry.totalAssetCents)}
          {" "}
          元
        </div>
      </div>
      <div className="text-right">
        <PnlText cents={entry.totalPnlCents} size={14} />
        <div className="mt-0.5">
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
    <Space direction="vertical" size="large" className="w-full">
      <div>
        <Title level={3} className="mb-1">
          收益排行榜
        </Title>
        <Paragraph type="secondary" className="mb-0">
          总收益 = 总资产 − 累计入金（初始本金 + 签到奖励）。已清仓落袋的收益也保留在榜上，
          只签到不买基金刷不了榜。
        </Paragraph>
      </div>

      {/* animate-fade-up：区块进场淡入（首卡无延迟） */}
      <SectionCard className="animate-fade-up">
        {lb.byRate.length === 0
          ? (
              <EmptyState description="还没有人开过单">
                <Typography.Text type="secondary" className="text-xs">
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
          未上榜（没成交过）时保留引导空态，形成引导闭环。
          交错进场：第 2 卡延迟 60ms（animate-delay 写法的坑见 uno.config.ts） */}
      {meId !== null && (mine === null || mine.rank > 3) && (
        <SectionCard title="我的排名" className="animate-fade-up animate-delay-[60ms]">
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
