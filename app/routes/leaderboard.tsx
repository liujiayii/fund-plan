import type { Route } from "./+types/leaderboard";
import type { LeaderboardEntry } from "~/domain/leaderboard";
import { Space, Tabs, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtRate, fmtSignedYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { isOlympicPodium, splitPodium } from "~/domain/leaderboard";
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
 * 终榜条带的名次色——四人及以上并列第一才走条带。
 * 金偏暖、银贴冰川冰调、铜偏陶。页面局部装饰，不进 theme.ts。
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

/**
 * 奥林匹克三柱元数据：奖牌底 / 台身高度 / 水印字号按名次递减——
 * 「高度即名次」是领奖台的全部形态语言。
 * 金银铜是页面局部装饰色，不入 theme.ts。
 * 水印用 text-[Npx] 而非 text-3xl——档位类会连 line-height 一起设。
 *
 * ⚠️ 描边用 border 而非 ring——本项目 uno 关了 preflights.reset，
 * Wind4 的 ring 是死类（box-shadow 全零透明），border-* 也只出宽度、
 * style 走未定义的 --un-border-style 回退 none。四边都有 2px 时
 * [border-style:solid] 补上无 medium 副作用。禁止 md:scale-* 强调金牌——
 * 原生 scale 不改布局，并列第一曾视觉压叠 4.7px。
 */
const MEDAL: Record<number, {
  ped: string;
  pedH: string;
  watermark: string;
  badge: string;
  drop: string;
}> = {
  1: {
    ped: "fp-podium-ped--gold",
    pedH: "min-h-[56px] md:min-h-[96px]",
    watermark: "text-[#F5C454] text-[32px] md:text-[56px]",
    badge: "fp-podium-medal--gold",
    drop: "fp-podium-drop--1",
  },
  2: {
    ped: "fp-podium-ped--silver",
    pedH: "min-h-[40px] md:min-h-[58px]",
    watermark: "text-[#C9D6E2] text-[24px] md:text-[40px]",
    badge: "bg-[#C9D6E2]",
    drop: "fp-podium-drop--2",
  },
  3: {
    ped: "fp-podium-ped--bronze",
    pedH: "min-h-[28px] md:min-h-[40px]",
    watermark: "text-[#CD8A54] text-[20px] md:text-[32px]",
    badge: "bg-[#CD8A54]",
    drop: "fp-podium-drop--3",
  },
};

/** 涨跌色：条件类互斥，别跟 text-ink 同挂 */
function pnlTone(v: number): string {
  return v > 0 ? "text-rise" : v < 0 ? "text-fall" : "text-flat";
}

/** 盈亏金额带符号、带「元」（本页金额一律带单位，否则与百分比混读） */
function signedYuan(cents: number): string {
  return `${fmtSignedYuan(cents)} 元`;
}

/**
 * 副值行：投入收益率。这是榜单上**唯一**能展示的「比率 + 分母」组合——
 * 分母（累计买入金额）是本人投出去的钱，不是钱包余额，可以公示。
 * 没有成交过（分母 0）时显示「—」，绝不用 0.00% 冒充。
 *
 * ⚠️ 这里曾经显示的是「总资产 X 元」。撤掉它有两个理由：
 *  1. **隐私**：资产规模属于钱包信息，基金类产品从不公示他人的总资产/余额；
 *  2. **无用**：模拟盘人人 500 万本金起步，这个数字既无区分度又挤占信息密度，
 *     而它挤掉的位置正好能放一个真有信息量的比率。
 */
function InvestedRate({ rate }: { rate: number | null }) {
  if (rate === null) {
    return <span className="text-tertiary">投入收益率 —</span>;
  }
  return (
    <>
      投入收益率
      {" "}
      <span className={pnlTone(rate)}>{fmtRate(rate)}</span>
    </>
  );
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
  const hero = heroIsRate ? fmtRate(entry.totalPnlRate) : signedYuan(entry.totalPnlCents);
  const heroTone = pnlTone(heroIsRate ? entry.totalPnlRate : entry.totalPnlCents);
  const sub = heroIsRate ? signedYuan(entry.totalPnlCents) : fmtRate(entry.totalPnlRate);
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
        {/* 副值：投入收益率。这里原先是「总资产 X 元」——见 InvestedRate 的注释 */}
        <div className="mt-0.5 font-num text-xs text-muted">
          <InvestedRate rate={entry.investedPnlRate} />
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
 * 前三名：典礼聚光奥林匹克三柱（2026-09-16 定稿）。
 *
 * 领先档 + 其余前三合计 ≤ 3 才走三柱（三柱最多站 3 人）。
 * 四人并列第一 / 1/2/3/3 / 1/2/2/2 都跌回终榜条带（isOlympicPodium）。
 * splitPodium 的切分口径不动。
 *
 * 三柱底对齐、桌面视觉序银-金-铜（CSS order），高度即名次。
 * 禁止 scale。每柱一口井，外卡才是玻璃——宪法「一卡多格」。
 * 戏全给 rank=1：软椭球体积光 + 金冰台身 + 金属脊 + 三件克制动效。
 * 狭屏改「冠军通栏 + 银铜并排」，从根上折断 90px 挤爆。
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

  if (!isOlympicPodium(leads, rest)) {
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

  const cols = [...leads, ...rest];
  const goldCount = leads.length;
  const n = cols.length;
  // 窄屏：
  //   经典三人（单金+银铜）→ 冠军通栏 + 银铜并排
  //   两金+铜 / 三金 / 两金无铜 → 全竖叠（半宽并排会把 18px 英雄数字挤爆）
  //   两人及以下（单金 / 金+银 / 金+铜）直接 flex，别让第二根掉半宽空着
  const classicThree = goldCount === 1 && n === 3;
  const stackMobile = goldCount > 1 && n >= 2;
  // 1/2/2 时第二根银要 md:order-3，否则两银都 order-1、金被挤到最右。
  // 只有恰好三人时才 reorder：两人台套 1/2/3 的 order 会把唯一冠军挤到最右。
  const reorderDesktop = goldCount === 1 && n === 3;
  const firstSilver = cols.find(c => c.rank === 2);

  return (
    // pt-5：奖牌掉落 translateY(-20px) 的进场余量；overflow 裁体积光伸出的部分
    <div className="relative mb-5 overflow-hidden pt-5">
      {/* 体积光椭球：并列第一铺满整台，单冠军打中间 */}
      <div
        className={`fp-podium-spot ${goldCount > 1 ? "fp-podium-spot--tied" : ""}`}
        aria-hidden
      />
      <div className={`relative z-[1] gap-2 md:flex md:flex-row md:items-end md:gap-3 ${
        stackMobile
          ? "flex flex-col"
          : classicThree
            ? "grid grid-cols-2 items-end"
            : "flex items-end"
      }`}
      >
        {cols.map((e) => {
          const isMe = meId !== null && e.userId === meId;
          const m = MEDAL[e.rank] ?? MEDAL[3];
          const isGold = e.rank === 1;
          // 桌面 order 只在恰好三人、单冠军时把金居中：
          //   1/2/3 → 银左金中铜右
          //   1/2/2 → 第一根银左、金中、第二根银右
          // 两人台 / 并列第一不 reorder（两人套 2/1 会把冠军挤到最右）
          const order = !reorderDesktop
            ? ""
            : e.rank === 1
              ? "md:order-2"
              : e.rank === 2
                ? (e === firstSilver ? "md:order-1" : "md:order-3")
                : "md:order-3";
          // 经典三人窄屏：冠军通栏，银铜并排
          const mobileSpan = classicThree && isGold ? "col-span-2 mb-2 md:mb-0" : "";
          const heroIsRate = metric === "rate";
          const hero = heroIsRate ? fmtRate(e.totalPnlRate) : signedYuan(e.totalPnlCents);
          const heroTone = pnlTone(heroIsRate ? e.totalPnlRate : e.totalPnlCents);
          const sub = heroIsRate ? signedYuan(e.totalPnlCents) : fmtRate(e.totalPnlRate);
          const subTone = pnlTone(heroIsRate ? e.totalPnlCents : e.totalPnlRate);

          return (
            <article
              key={e.userId}
              className={`relative flex w-full min-w-0 flex-col items-center rounded-2xl md:flex-1 ${
                isGold ? "fp-podium-col--gold" : isMe ? "bg-primary-bg" : "bg-well"
              } ${order} ${mobileSpan}`}
            >
              <span className="fp-podium-ridge" aria-hidden />
              {/* 奖牌：圆形实底 + 深海墨字（亮底深字）。
                  描边用 border 而非 ring——ring 在本项目是死类，见 MEDAL 注释 */}
              <span
                className={`fp-podium-drop ${m.drop} mt-3 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 [border-style:solid] border-white/50 text-xs font-semibold font-num text-on-primary md:mt-5 md:h-11 md:w-11 md:text-lg ${m.badge}`}
              >
                {e.rank}
              </span>
              <div className="mt-1.5 w-full truncate px-2 text-center text-[13px] font-medium text-ink md:mt-2 md:text-[15px]">
                {e.username}
                {isMe && <Tag className="ml-1 md:ml-2">我</Tag>}
              </div>
              {/* 副值：投入收益率（移动端柱宽不够，这行让位给数字——与原先
                  「总资产仅桌面」同一取舍）。桌面/移动都有的英雄数字才是主角 */}
              <div className="mt-0.5 hidden text-xs text-muted md:block">
                <InvestedRate rate={e.investedPnlRate} />
              </div>
              {/* 英雄数字跟当前 tab 口径；副值用另一口径。
                  窄柱拆两行：PnlText 是 nowrap 倾向的 inline-flex，
                  一行两段在 ~90px 里会把「元」挤到第二行 */}
              <div className={`mt-2 font-num leading-none ${heroTone} ${
                isGold ? "text-[18px] md:text-[22px]" : "text-[14px] md:text-[18px]"
              }`}
              >
                {hero}
              </div>
              <div className={`mt-1 font-num text-[11px] leading-none md:text-[13px] ${subTone}`}>
                {sub}
              </div>
              {/* 台身：名次水印沉底，高度即名次 */}
              <div className={`fp-podium-ped ${m.ped} mt-3 flex w-full items-end justify-center pb-1.5 ${m.pedH}`}>
                <span className={`font-num leading-none opacity-25 ${m.watermark}`}>
                  {e.rank}
                </span>
              </div>
            </article>
          );
        })}
      </div>
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
        <div className="mt-0.5 font-num text-xs text-muted">
          <InvestedRate rate={entry.investedPnlRate} />
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
        {/* 分母必须写在页面上：同一个「收益率」在本站有多个口径，
            不写分母就会出现「正收益 0.00%」这种读不通的观感（2026-09-18 审计）。
            另：榜单只公示收益与比率，不公示任何人的总资产与余额 */}
        <Paragraph type="secondary" className="mb-0 mt-1 text-xs">
          收益率 = 总收益 ÷ 累计入金（账户口径，分母含没投出去的闲置现金）；
          投入收益率 = 总收益 ÷ 累计买入金额（分母只算真投进基金的钱，更贴近选基能力）。
          榜单只公示收益数字，不公示任何人的资产与余额。
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
                defaultActiveKey="pnl"
                items={[
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
                ]}
              />
            )}
      </SectionCard>

      {/* 已登录且不在榜单前排（前三名）时：底部钉一行「我的排名」。
          前三名本身已在领奖台/条带高亮，再渲染卡片会重复出现两次；
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
