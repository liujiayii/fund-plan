import type { Db } from "~/db/client";
import type { FeedbackStatus, StatusFilter } from "~/domain/feedback";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { feedback, feedbackVote, user } from "~/db/schema";
import {
  beijingDayStartMs,
  DAILY_SUBMIT_LIMIT,

  isSubmitBlocked,

  validateFeedbackInput,
} from "~/domain/feedback";

/**
 * 需求墙服务：提交（限频）/列表（票数聚合）/投票（幂等）/状态流转。
 *
 * 票数不冗余存储：LEFT JOIN + GROUP BY 一次取回，查询数与需求条数无关
 * （对齐 listUsersOverview 反 N+1 纪律）。viewer 已投集合单独一条查询、
 * 内存判 votedByMe，不给列表多加一次逐条查询。
 */

/** 需求卡片视图：直接喂 wall.tsx 渲染 */
export interface FeedbackCard {
  id: number;
  title: string;
  detail: string;
  status: FeedbackStatus;
  statusNote: string;
  statusUpdatedAt: number | null;
  createdAt: number;
  username: string;
  voteCount: number;
  /** 当前 viewer 是否投过（游客恒 false） */
  votedByMe: boolean;
}

/**
 * 提交需求。校验/限频不过抛 Error（message 为可直接展示的人话文案），
 * 返回新需求 id。
 */
export async function createFeedback(
  db: Db,
  userId: number,
  title: string,
  detail: string,
): Promise<number> {
  const t = title.trim();
  const d = detail.trim();
  const invalid = validateFeedbackInput(t, d);
  if (invalid)
    throw new Error(invalid);

  // 限频：数「北京时间今天 0 点起」本人已提交的条数（索引 idx_feedback_user_created）
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        gte(feedback.createdAt, beijingDayStartMs(Date.now())),
      ),
    );
  if (isSubmitBlocked(Number(rows[0]?.n ?? 0)))
    throw new Error(`今日提交已达上限（${DAILY_SUBMIT_LIMIT} 条）`);

  const [row] = await db
    .insert(feedback)
    .values({ userId, title: t, detail: d, createdAt: Date.now() })
    .returning({ id: feedback.id });
  return row.id;
}

/**
 * 列需求（含作者名、票数、viewer 已投标记）。
 * 排序：票数 desc → 提交时间 desc，在 SQL 完成。
 */
export async function listFeedback(
  db: Db,
  viewerId: number | null,
  filter: StatusFilter,
): Promise<FeedbackCard[]> {
  const rows = await db
    .select({
      id: feedback.id,
      title: feedback.title,
      detail: feedback.detail,
      status: feedback.status,
      statusNote: feedback.statusNote,
      statusUpdatedAt: feedback.statusUpdatedAt,
      createdAt: feedback.createdAt,
      username: user.username,
      voteCount: sql<number>`count(${feedbackVote.userId})`,
    })
    .from(feedback)
    .innerJoin(user, eq(user.id, feedback.userId))
    .leftJoin(feedbackVote, eq(feedbackVote.feedbackId, feedback.id))
    .where(filter === "all" ? undefined : eq(feedback.status, filter))
    .groupBy(feedback.id)
    .orderBy(
      desc(sql`count(${feedbackVote.userId})`),
      desc(feedback.createdAt),
    );

  // viewer 的全部投票一条查询拉回，内存判 votedByMe（不逐条 EXISTS）
  const mine = new Set<number>();
  if (viewerId !== null) {
    const voted = await db
      .select({ feedbackId: feedbackVote.feedbackId })
      .from(feedbackVote)
      .where(eq(feedbackVote.userId, viewerId));
    for (const v of voted)
      mine.add(v.feedbackId);
  }

  return rows.map(r => ({
    ...r,
    status: r.status as FeedbackStatus,
    voteCount: Number(r.voteCount),
    votedByMe: mine.has(r.id),
  }));
}

/** 投票。复合主键 + onConflictDoNothing：重复投幂等静默 */
export async function voteFeedback(
  db: Db,
  userId: number,
  feedbackId: number,
): Promise<void> {
  await db
    .insert(feedbackVote)
    .values({ feedbackId, userId, createdAt: Date.now() })
    .onConflictDoNothing();
}

/** 撤销投票。没投过也静默成功（幂等） */
export async function unvoteFeedback(
  db: Db,
  userId: number,
  feedbackId: number,
): Promise<void> {
  await db
    .delete(feedbackVote)
    .where(
      and(eq(feedbackVote.userId, userId), eq(feedbackVote.feedbackId, feedbackId)),
    );
}

/** admin 状态流转：写状态 + 备注 + 流转时间 */
export async function moderateFeedback(
  db: Db,
  feedbackId: number,
  status: FeedbackStatus,
  statusNote: string,
): Promise<void> {
  await db
    .update(feedback)
    .set({
      status,
      statusNote: statusNote.trim(),
      statusUpdatedAt: Date.now(),
    })
    .where(eq(feedback.id, feedbackId));
}
