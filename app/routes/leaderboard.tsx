import type { Route } from "./+types/leaderboard";
import type { LeaderboardEntry } from "~/domain/leaderboard";
import { Space, Tabs, Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
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

/**
 * 前三名奖牌元数据：徽章底色 / 台身高度 / 水印字号，全部按名次递减——
 * 「高度即名次」是领奖台的全部形态语言。
 * 金银铜是页面局部装饰色（CLAUDE.md 规约允许任意值），不入 theme.ts
 * （那里只放跨页复用的语义色）；2026-09-15 随领奖台重做微调色相：
 * 金偏暖、银带冰调（贴冰川主题）、铜偏陶。
 * 水印字号用 text-[Npx] 任意值而非 text-3xl 档位类——档位类会连
 * line-height 一起设，与 leading-none 的胜负看产物排序，不赌。
 */
const MEDAL: Record<number, { badge: string; pedestal: string; watermark: string }> = {
  1: {
    badge: "bg-[#F5C454]",
    pedestal: "min-h-[56px] md:min-h-[76px]",
    watermark: "text-[#F5C454] text-[30px] md:text-[48px]",
  },
  2: {
    badge: "bg-[#C9D6E2]",
    pedestal: "min-h-[40px] md:min-h-[52px]",
    watermark: "text-[#C9D6E2] text-[24px] md:text-[36px]",
  },
  3: {
    badge: "bg-[#CD8A54]",
    pedestal: "min-h-[28px] md:min-h-[34px]",
    watermark: "text-[#CD8A54] text-[20px] md:text-[30px]",
  },
};

/**
 * 列表行名次徽章（4+ 名）：纯灰数字。
 * 前三名上领奖台不再进列表——competition ranking 保证 slice(3) 的名次
 * 恒 ≥ 4（前三名必占前三位），旧金银铜分支已随旧领奖台退役，勿加回。
 */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-muted">
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
    // 自己的条目紫雾高亮：bg-primary/6 = 主色 6% 透明度
    // ⚠️ 单边边框的正确姿势是 border-b + [border-bottom-style:solid]：
    //   border-b 只出宽度不出 style，但千万别用 border-solid 补——它把 solid
    //   应用到四边，没给宽度的三边走初始值 medium（=3px），整行被 3px 浅灰
    //   框住（PR #76 上线后实测踩坑，Playwright 计算样式取证）
    <div
      // px-3（2026-09-15）：行内容与内容盒两缘的对称呼吸——曾只有 py，
      // 右侧盈亏数字贴死卡片右缘（实测右缘 gap 0px），左侧徽章盒里又自带
      // 空隙，整行看着左宽右挤；补横向 padding 两边对齐
      // hover 底色只给非本人的行：本人的 bg-primary/6 高亮若再叠 hover 底
      // 会被盖掉（产物同优先级、后者居后），悬停自己的行不该丢自己的高亮
      // （CodeRabbit PR #79 修正）；hover 用井底而非页面底——页面底比玻璃还深，
      // 悬停会成黑洞（宪法 §2.6）；transition-colors 全行保留
      className={`flex items-center gap-3 border-b border-line px-3 py-3 [border-bottom-style:solid] transition-colors ${isMe ? "bg-primary/6" : "hover:bg-well"}`}
    >
      <RankBadge rank={entry.rank} />
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
      <div className="text-right">
        <PnlText cents={entry.totalPnlCents} size={14} />
        <div className="mt-0.5">
          <PnlText rate={entry.totalPnlRate} size={12} />
        </div>
      </div>
    </div>
  );
}

/**
 * 前三领奖台：奥林匹克三柱（2026-09-15 重做）。
 * - **高度即名次**：柱底对齐（items-end），台身（名次水印区）按金/银/铜
 *   递减，冠军的内容天然站得最高——「领奖台」的形态直译。
 *   ⚠️ 旧版用 `md:scale-105` 强调金牌——那是原生 scale 属性（不改布局），
 *   卡片视觉溢出随视口变宽线性放大，线上两并列第一实测压叠 4.7px、
 *   左缘还捅进卡片内边距 8.3px。transform 类强调在 flex 排版里是事故，勿回魂。
 * - 每柱一口井（bg-well，宪法「一卡多格」），不各自玻璃。
 * - 桌面视觉顺序银-金-铜（CSS order），数据数组保持 1/2/3；并列第一时
 *   两根金柱 order 同值相邻居中、共享最高台（competition ranking 的自然
 *   呈现）。移动端按 DOM 序金-银-铜从左到右（矮柱横排，顺位阅读优先）。
 * - 台身里沉一枚名次色水印（东京奥运领奖台正面大数字的形态语言），
 *   Space Grotesk 的数字形体正好当奖杯刻字。
 * - 移动端仍三柱横排（组件的灵魂形态），内容压缩：小徽章、砍总资产行、
 *   金额与率拆两行。不足三人时只渲染现有人数。
 */
function Podium({ entries, meId }: { entries: LeaderboardEntry[]; meId: number | null }) {
  const top = entries.slice(0, 3);
  return (
    <div className="mb-5 flex items-end gap-2 md:gap-3">
      {top.map((e) => {
        const isMe = meId !== null && e.userId === meId;
        const m = MEDAL[e.rank] ?? MEDAL[3]; // 防御：前三名次理论必在表内
        // 桌面 order：金居中、银居左、铜居右
        const order = e.rank === 1
          ? "md:order-2"
          : e.rank === 2 ? "md:order-1" : "md:order-3";
        return (
          <div
            key={e.userId}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 pt-4 md:gap-1.5 md:px-3 md:pt-5 ${isMe ? "bg-primary-bg" : "bg-well"} ${order}`}
          >
            {/* 奖牌徽章：圆形实底奖牌 + 深海墨字（亮底深字，与全站
                colorTextLightSolid 同语言——白字在金底上对比不及格），
                白描边当奖牌缘。
                ⚠️ 描边用 border 而非 ring——本项目 uno 关了 preflights.reset，
                而 Wind4 的 ring/border-style 都靠 reset 里的变量基础层：
                ring 类在这里是死类（box-shadow 全零透明），border-* 也只出
                宽度、style 走未定义的 --un-border-style 回退 none（实测 0px）。
                [border-style:solid] 显式补上；四边都有 2px 宽度，无「无宽度的
                边走 medium」副作用（border-b 那个坑见 CLAUDE.md）。border-box
                下描边不撑尺寸（实测 44px 不变） */}
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border-2 [border-style:solid] border-white/50 text-xs font-semibold font-num text-on-primary md:h-11 md:w-11 md:text-lg ${m.badge}`}
            >
              {e.rank}
            </span>
            <div className="w-full truncate text-center text-[13px] font-medium text-ink md:text-[15px]">
              {e.username}
              {isMe && <Tag className="ml-1 md:ml-2">我</Tag>}
            </div>
            {/* 总资产仅桌面——移动端柱宽 ~90px，三行文字挤不下，信息让位数字
                （完整数字下面列表行与「我的排名」都有） */}
            <div className="hidden text-xs text-muted md:block">
              总资产
              {" "}
              {fmtYuan(e.totalAssetCents)}
              {" "}
              元
            </div>
            {/* 数字：992+ 一行两段；更窄（移动三矮柱与 768~991 窄柱）拆两行——
                PnlText 是 nowrap 倾向的 inline-flex，一行两段在窄柱里装不下，
                「元」字会被 flex 收缩挤到第二行（768 实测该块 50px 两行）。
                断点用 lg（=antd lg 992，uno 已防御性对齐）：992 下柱宽 ~269px，
                size 16 两段 ~170px 才放得下 */}
            <div className="w-full text-center lg:hidden">
              <PnlText cents={e.totalPnlCents} size={12} />
              <div className="mt-0.5"><PnlText rate={e.totalPnlRate} size={11} /></div>
            </div>
            <div className="hidden lg:block">
              <PnlText cents={e.totalPnlCents} rate={e.totalPnlRate} size={16} />
            </div>
            {/* 台身：名次水印沉底（items-end 贴台面），高度即名次 */}
            <div className={`mt-2 flex w-full items-end justify-center pb-1.5 ${m.pedestal}`}>
              <span className={`font-num leading-none opacity-25 ${m.watermark}`}>
                {e.rank}
              </span>
            </div>
          </div>
        );
      })}
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
                    // 前三上领奖台，第 4 名起仍是列表行
                    children: (
                      <>
                        <Podium entries={lb.byRate} meId={meId} />
                        {lb.byRate.slice(3).map(e => <LeaderRow key={e.userId} entry={e} meId={meId} />)}
                      </>
                    ),
                  },
                  {
                    key: "pnl",
                    label: "总收益榜",
                    children: (
                      <>
                        <Podium entries={lb.byPnl} meId={meId} />
                        {lb.byPnl.slice(3).map(e => <LeaderRow key={e.userId} entry={e} meId={meId} />)}
                      </>
                    ),
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
