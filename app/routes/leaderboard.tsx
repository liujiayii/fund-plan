import type { Route } from "./+types/leaderboard";
import type { LeaderboardEntry } from "~/domain/leaderboard";
import { Space, Tabs, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { splitPodium } from "~/domain/leaderboard";
import { pageMeta } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import { getCurrentUser } from "~/services/guard";
import { getLeaderboard } from "~/services/leaderboard-service";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({
    title: "收益排行榜",
    description: "全站模拟盘收益率 / 总收益双榜，游客免登录围观",
    path: "/leaderboard",
  });
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

/** 当前榜的排序口径：英雄数字跟 tab 走，别两榜都把收益率撑成主角 */
type RankMetric = "rate" | "pnl";

/**
 * 名次色——页面局部装饰，不进 theme.ts。
 * 只当「赛道彩条」用：左边 4px 竖杠 + 浅洗底 + 号码布颜色。
 * 金偏暖、银贴冰川冰调、铜偏陶。禁止再做成实心圆奖牌。
 */
const PLACE: Record<number, { bar: string; wash: string; bib: string }> = {
  1: {
    bar: "border-l-[#F5C454]",
    wash: "bg-[#F5C454]/10",
    bib: "text-[#F5C454]",
  },
  2: {
    bar: "border-l-[#C9D6E2]",
    wash: "bg-[#C9D6E2]/10",
    bib: "text-[#C9D6E2]",
  },
  3: {
    bar: "border-l-[#CD8A54]",
    wash: "bg-[#CD8A54]/10",
    bib: "text-[#CD8A54]",
  },
};

/** 涨跌色：条件类互斥，别跟 text-ink 同挂 */
function pnlTone(v: number): string {
  return v > 0 ? "text-rise" : v < 0 ? "text-fall" : "text-flat";
}

function fmtRate(rate: number): string {
  return `${rate > 0 ? "+" : ""}${(rate * 100).toFixed(2)}%`;
}

function fmtSignedYuan(cents: number): string {
  return `${cents > 0 ? "+" : ""}${fmtYuan(cents)} 元`;
}

/** 号码布：01 / 02 / 03，Space Grotesk 的形体本身就是名次 */
function bib(rank: number): string {
  return String(rank).padStart(2, "0");
}

/**
 * 前三名次卡：终榜条带，不是领奖台柱。
 * featured = 并列领先的那一档（通常是第一），全宽、数字更大；
 * 其余前三进下方网格，窄屏一律竖叠——三列矮柱是上一版挤爆/重叠的根。
 */
function TopSpot({
  entry,
  meId,
  metric,
  featured,
}: {
  entry: LeaderboardEntry;
  meId: number | null;
  metric: RankMetric;
  featured: boolean;
}) {
  const isMe = meId !== null && entry.userId === meId;
  const place = PLACE[entry.rank] ?? PLACE[3];
  const heroIsRate = metric === "rate";
  const hero = heroIsRate ? fmtRate(entry.totalPnlRate) : fmtSignedYuan(entry.totalPnlCents);
  const heroTone = pnlTone(heroIsRate ? entry.totalPnlRate : entry.totalPnlCents);
  const sub = heroIsRate ? fmtSignedYuan(entry.totalPnlCents) : fmtRate(entry.totalPnlRate);
  const subTone = pnlTone(heroIsRate ? entry.totalPnlCents : entry.totalPnlRate);

  return (
    <div
      className={`flex min-w-0 flex-col gap-3 rounded-2xl border-l-4 [border-left-style:solid] ${place.bar} ${place.wash} ${
        featured
          ? "px-4 py-4 md:flex-row md:items-center md:gap-5 md:px-5 md:py-5"
          : "px-4 py-3.5"
      }`}
    >
      <span
        className={`shrink-0 font-num leading-none ${place.bib} ${
          featured ? "text-[36px] md:text-[44px] md:w-14" : "text-[28px]"
        }`}
      >
        {bib(entry.rank)}
      </span>

      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium text-ink ${featured ? "text-[16px] md:text-[17px]" : "text-[15px]"}`}>
          {entry.username}
          {isMe && <Tag className="ml-2">我</Tag>}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          总资产
          {" "}
          {fmtYuan(entry.totalAssetCents)}
          {" "}
          元
        </div>
      </div>

      {/* 英雄数字跟当前 tab 口径；副值用另一口径——两榜切换时主角对调 */}
      <div className={featured ? "md:text-right" : ""}>
        <div className={`font-num leading-none ${heroTone} ${
          featured ? "text-[28px] md:text-[32px]" : "text-[22px]"
        }`}
        >
          {hero}
        </div>
        <div className={`mt-1 font-num text-[13px] leading-none ${subTone}`}>
          {sub}
        </div>
      </div>
    </div>
  );
}

/**
 * 前三名：终榜条带。
 *
 * 完全抛弃 2026-09-15 的奥林匹克三柱（高度水印 / 圆奖牌 / CSS order / scale）。
 * 那套的病根是「三列 flex + 视觉缩放」——并列第一会压叠，窄屏柱宽 ~90px
 * 数字折行。本版按 competition ranking 切两层：
 *   1. 领先档（含全部并列第一）全宽条带纵向堆
 *   2. 其余 rank ≤ 3 进 md 双列网格；< md 竖叠，永不并排挤
 * 每条一口井（洗底，不是玻璃），外卡才是玻璃——宪法「一卡多格」。
 */
function Podium({
  leads,
  rest,
  meId,
  metric,
}: {
  leads: LeaderboardEntry[];
  rest: LeaderboardEntry[];
  meId: number | null;
  metric: RankMetric;
}) {
  if (leads.length === 0)
    return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {leads.map(e => (
        <TopSpot
          key={e.userId}
          entry={e}
          meId={meId}
          metric={metric}
          featured
        />
      ))}
      {rest.length > 0 && (
        // 两人并排才开双列；只剩一人（并列第一挤掉一格）别让它在桌面占半宽空着
        <div className={rest.length === 2 ? "grid grid-cols-1 gap-2 md:grid-cols-2" : "flex flex-col gap-2"}>
          {rest.map(e => (
            <TopSpot
              key={e.userId}
              entry={e}
              meId={meId}
              metric={metric}
              featured={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单行榜单条目（第 4 名起，以及底部「我的排名」） */
function LeaderRow({
  entry,
  meId,
}: {
  entry: LeaderboardEntry;
  meId: number | null;
}) {
  const isMe = meId !== null && entry.userId === meId;
  return (
    // 自己的条目冰雾高亮：bg-primary/6 = 主色 6% 透明度
    // ⚠️ 单边边框的正确姿势是 border-b + [border-bottom-style:solid]：
    //   border-b 只出宽度不出 style，但千万别用 border-solid 补——它把 solid
    //   应用到四边，没给宽度的三边走初始值 medium（=3px），整行被 3px 浅灰
    //   框住（PR #76 上线后实测踩坑，Playwright 计算样式取证）
    //
    // px-4 md:px-6：跟卡片 body 的 16/24 对齐。行从卡片内容盒负边距拉满
    // （见 ListTape），再在行内补回同样的左右 padding——左右呼吸对称，
    // hover 高亮也能顶到玻璃内缘。旧版只有 py，右侧数字贴死右缘。
    //
    // 名次不再塞进 32×32 盒子居中：盒子左边的空比数字本身还宽，
    // 视觉上就是「左边有留白、右边没有」。改成左对齐等宽数字列。
    //
    // hover 底色只给非本人的行：本人的 bg-primary/6 高亮若再叠 hover 底
    // 会被盖掉（产物同优先级、后者居后），悬停自己的行不该丢自己的高亮
    // （CodeRabbit PR #79 修正）；hover 用井底而非页面底——页面底比玻璃还深，
    // 悬停会成黑洞（宪法 §2.6）；transition-colors 全行保留
    <div
      className={`flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 md:px-6 [border-bottom-style:solid] transition-colors ${isMe ? "bg-primary/6" : "hover:bg-well"}`}
    >
      <span className="w-7 shrink-0 font-num text-[13px] text-muted">
        {entry.rank}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="font-medium text-ink">
          {entry.username}
          {isMe && <Tag className="ml-2">我</Tag>}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          总资产
          {" "}
          {fmtYuan(entry.totalAssetCents)}
          {" "}
          元
        </div>
      </div>
      <div className="shrink-0 text-right">
        <PnlText cents={entry.totalPnlCents} size={14} />
        <div className="mt-0.5">
          <PnlText rate={entry.totalPnlRate} size={12} />
        </div>
      </div>
    </div>
  );
}

/**
 * 第 4 名起的名单带。负边距把行拉到卡片内容盒边缘，
 * 与 antd Card body 桌面 24 / 窄屏 16（responsive.css）对齐。
 */
function ListTape({
  entries,
  meId,
}: {
  entries: LeaderboardEntry[];
  meId: number | null;
}) {
  if (entries.length === 0)
    return null;
  return (
    <div className="-mx-4 md:-mx-6">
      {entries.map(e => <LeaderRow key={e.userId} entry={e} meId={meId} />)}
    </div>
  );
}

export default function Leaderboard({ loaderData }: Route.ComponentProps) {
  const { me, lb } = loaderData;
  const meId = me?.id ?? null;

  /** 自己的条目（可能不在榜上：没成交过 / 没登录） */
  const mine
    = meId === null ? null : lb.byRate.find(e => e.userId === meId) ?? null;

  // 两榜各自切一次：领先档完整吃进条带，名单带只拿剩下的。
  // 切分必须在 Tabs 外做——items.children 里写 IIFE 是为了躲 lint 的副作用。
  const rateBoard = splitPodium(lb.byRate);
  const pnlBoard = splitPodium(lb.byPnl);

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
                    children: (
                      <>
                        <Podium leads={rateBoard.leads} rest={rateBoard.rest} meId={meId} metric="rate" />
                        <ListTape entries={rateBoard.tape} meId={meId} />
                      </>
                    ),
                  },
                  {
                    key: "pnl",
                    label: "总收益榜",
                    children: (
                      <>
                        <Podium leads={pnlBoard.leads} rest={pnlBoard.rest} meId={meId} metric="pnl" />
                        <ListTape entries={pnlBoard.tape} meId={meId} />
                      </>
                    ),
                  },
                ]}
              />
            )}
      </SectionCard>

      {/* 已登录且不在榜单前排（前三名）时：底部钉一行「我的排名」。
          前三名本身已在终榜条带高亮，再渲染卡片会重复出现两次；
          未上榜（没成交过）时保留引导空态，形成引导闭环。
          交错进场：第 2 卡延迟 60ms（animate-delay 写法的坑见 uno.config.ts） */}
      {meId !== null && (mine === null || mine.rank > 3) && (
        <SectionCard title="我的排名" className="animate-fade-up animate-delay-[60ms]">
          {mine
            ? (
                // 单行卡不走 ListTape 负边距：外卡 body 自己就是左右呼吸
                <div className="-mx-4 md:-mx-6">
                  <LeaderRow entry={mine} meId={meId} />
                </div>
              )
            : (
                <EmptyState description="还没有上榜——下一单就能上榜" />
              )}
        </SectionCard>
      )}
    </Space>
  );
}
