import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "~/db/client";
import { account, feedback, feedbackVote, session, transactions, user } from "~/db/schema";
import { action } from "~/routes/wall";
import { registerUser } from "~/services/auth";
import {
  createFeedback,
  listFeedback,
  moderateFeedback,
  unvoteFeedback,
  voteFeedback,
} from "~/services/feedback-service";
import { createSession, sessionCookie } from "~/services/session";
import { CloudflareContext } from "../../workers/app";

/**
 * 需求服务集成测试（真实 workerd + 真实 D1，模板同 watchlist.test.ts）。
 * 覆盖：提交/限频/投票幂等/撤销/权限流转/级联删除/列表排序与筛选。
 */

/** 每用例前清空相关表（registerUser 会写 user/session/account/transactions） */
async function resetAll() {
  const db = getDb(env.DB);
  for (const t of [feedbackVote, feedback, transactions, session, account, user])
    await db.delete(t);
}

/** 注册一个用户，返回其 id */
async function seedUser(name = "alice") {
  return (await registerUser(getDb(env.DB), env, name, "hunter2")).id;
}

/** 预置一条需求，返回 id */
async function seedFeedback(userId: number, title = "希望支持定投暂停") {
  return createFeedback(getDb(env.DB), userId, title, "出差三个月想暂停");
}

beforeEach(resetAll);

describe("createFeedback", () => {
  it("提交成功并落库，初始状态 pending", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    const id = await createFeedback(db, userId, "  希望支持定投暂停  ", "  详情  ");
    const row = await db.query.feedback.findFirst({ where: eq(feedback.id, id) });
    expect(row).toBeDefined();
    // service 层负责 trim
    expect(row!.title).toBe("希望支持定投暂停");
    expect(row!.detail).toBe("详情");
    expect(row!.status).toBe("pending");
    expect(row!.statusNote).toBe("");
  });

  it("标题超 50 字被拒，文案可读", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    await expect(
      createFeedback(db, userId, "一".repeat(51), ""),
    ).rejects.toThrow("50");
  });

  it("同日第 4 条被拒（限频 3 条），跨自然日由 beijingDayStartMs 保证", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    await seedFeedback(userId, "需求一");
    await seedFeedback(userId, "需求二");
    await seedFeedback(userId, "需求三");
    await expect(
      createFeedback(db, userId, "需求四", ""),
    ).rejects.toThrow("上限");
  });

  it("限频只算自己的，别人的不占额度", async () => {
    const db = getDb(env.DB);
    const a = await seedUser("alice");
    const b = await seedUser("bob");
    for (const i of [1, 2, 3])
      await seedFeedback(a, `A的需求${i}`);
    // bob 第一次提交不受 alice 3 条影响
    await expect(
      createFeedback(db, b, "B的需求", ""),
    ).resolves.toBeDefined();
  });
});

describe("voteFeedback / unvoteFeedback", () => {
  it("投票生效，重复投幂等不报错", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    const fid = await seedFeedback(userId);
    await voteFeedback(db, userId, fid);
    await voteFeedback(db, userId, fid); // 幂等
    const votes = await db.select().from(feedbackVote);
    expect(votes).toHaveLength(1);
  });

  it("撤销后票没了，没投过也撤销静默成功", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    const fid = await seedFeedback(userId);
    await unvoteFeedback(db, userId, fid); // 没投过，不抛
    await voteFeedback(db, userId, fid);
    await unvoteFeedback(db, userId, fid);
    expect(await db.select().from(feedbackVote)).toHaveLength(0);
  });
});

describe("moderateFeedback", () => {
  it("admin 流转状态并写入备注与时间戳", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    const fid = await seedFeedback(userId);
    await expect(moderateFeedback(db, fid, "planned", "下个版本排期")).resolves.toBe(true);
    const row = await db.query.feedback.findFirst({ where: eq(feedback.id, fid) });
    expect(row!.status).toBe("planned");
    expect(row!.statusNote).toBe("下个版本排期");
    expect(row!.statusUpdatedAt).not.toBeNull();
  });

  it("id 不存在返回 false，路由据此回失败而非假成功（CodeRabbit Minor #3）", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser();
    await seedFeedback(userId);
    await expect(moderateFeedback(db, 99999, "done", "查无此需求")).resolves.toBe(false);
  });
});

describe("listFeedback", () => {
  it("票数降序，票数相同按时间降序；带作者名与票数", async () => {
    const db = getDb(env.DB);
    const author = await seedUser("author");
    const voter = await seedUser("voter");
    const oldId = await seedFeedback(author, "老需求");
    const newId = await seedFeedback(author, "新需求");
    await voteFeedback(db, voter, oldId); // 老需求 1 票，新需求 0 票

    const list = await listFeedback(db, null, "all");
    expect(list.map(i => i.id)).toEqual([oldId, newId]); // 票数优先于时间
    expect(list[0].voteCount).toBe(1);
    expect(list[0].username).toBe("author");
  });

  it("votedByMe 只在 viewerId 投过时为 true，游客恒 false", async () => {
    const db = getDb(env.DB);
    const author = await seedUser("author");
    const viewer = await seedUser("viewer");
    const fid = await seedFeedback(author);
    await voteFeedback(db, viewer, fid);

    const asViewer = await listFeedback(db, viewer, "all");
    expect(asViewer[0].votedByMe).toBe(true);
    const asGuest = await listFeedback(db, null, "all");
    expect(asGuest[0].votedByMe).toBe(false);
  });

  it("status 筛选生效", async () => {
    const db = getDb(env.DB);
    const author = await seedUser("author");
    const fid = await seedFeedback(author, "待评估的需求");
    await moderateFeedback(db, fid, "done", "已上线");
    await seedFeedback(author, "还没处理的");

    const done = await listFeedback(db, null, "done");
    expect(done).toHaveLength(1);
    expect(done[0].title).toBe("待评估的需求");
    const all = await listFeedback(db, null, "all");
    expect(all).toHaveLength(2);
  });
});

describe("级联删除", () => {
  it("删用户后需求与票一起没了", async () => {
    const db = getDb(env.DB);
    const author = await seedUser("author");
    const voter = await seedUser("voter");
    const fid = await seedFeedback(author);
    await voteFeedback(db, voter, fid);
    // seedUser 返回的就是 id 数字，直接作删用户的条件
    await db.delete(user).where(eq(user.id, author));
    expect(await db.select().from(feedback)).toHaveLength(0);
    expect(await db.select().from(feedbackVote)).toHaveLength(0);
  });
});

/** 仿 plan-import.test.ts：伪造 CloudflareContext 直调 wall 的 action（接线层） */
function fakeContext(): unknown {
  return {
    get: (key: unknown) =>
      key === CloudflareContext
        ? { env, ctx: { waitUntil: () => {} } }
        : undefined,
  };
}

function post(fd: Record<string, string>, token: string): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fd))
    body.append(k, v);
  return new Request("https://x.dev/wall", {
    method: "POST",
    body,
    headers: { Cookie: sessionCookie(token) },
  });
}

describe("wall action 权限接线", () => {
  it("非 admin 调 moderate：403，且库内状态未被改动", async () => {
    const db = getDb(env.DB);
    const userId = await seedUser("alice");
    const token = await createSession(db, userId);
    const fid = await seedFeedback(userId);

    try {
      await action({
        request: post(
          { intent: "moderate", feedbackId: String(fid), status: "done", statusNote: "越权" },
          token,
        ),
        context: fakeContext(),
        params: {},
      } as never);
      expect.unreachable("应该 403");
    }
    catch (thrown) {
      expect((thrown as Response).status).toBe(403);
    }
    // 403 抛在业务 try 外（plan.tsx 纪律），状态流转不应发生
    const row = await db.query.feedback.findFirst({ where: eq(feedback.id, fid) });
    expect(row!.status).toBe("pending");
    expect(row!.statusNote).toBe("");
  });

  it("admin moderate 不存在的 id：返回失败提示而非假成功（CodeRabbit Minor #3）", async () => {
    const db = getDb(env.DB);
    // 测试环境 ADMIN_USERNAME=testadmin，注册同名用户即 admin
    const adminId = await seedUser("testadmin");
    const token = await createSession(db, adminId);

    const res = await action({
      request: post(
        { intent: "moderate", feedbackId: "99999", status: "done", statusNote: "查无此需求" },
        token,
      ),
      context: fakeContext(),
      params: {},
    } as never);
    expect(res).toEqual({ error: "需求不存在，请刷新页面后重试" });
  });
});
