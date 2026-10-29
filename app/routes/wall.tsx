import type { Route } from "./+types/wall";
import type { FeedbackStatus } from "~/domain/feedback";
import type { FeedbackCard } from "~/services/feedback-service";
import { LikeOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Input,
  message,
  Modal,
  Select,
  Space,
  Tabs,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatusBadge } from "~/components/ui/StatusBadge";
import {
  FEEDBACK_DETAIL_MAX,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TITLE_MAX,
  feedbackStatusTone,
  statusFilterFromParam,
} from "~/domain/feedback";
import { pageMeta } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import {
  createFeedback,
  listFeedback,
  moderateFeedback,
  unvoteFeedback,
  voteFeedback,
} from "~/services/feedback-service";
import { getCurrentUser, requireAdmin, requireUser } from "~/services/guard";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({
    title: "需求墙",
    description: "提交产品功能建议、为想要的功能投票，主理人定期排期处理",
    path: "/wall",
  });
}

/** 展示用日期（YYYY-MM-DD）。+8h 后取 UTC 分量，SSR 与浏览器结果一致 */
function fmtDate(ms: number): string {
  const d = new Date(ms + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  // 游客可浏览（公开页，与 /leaderboard 同级）；登录态只用来开提交/投票按钮
  const me = await getCurrentUser(request, db);
  const url = new URL(request.url);
  const filter = statusFilterFromParam(url.searchParams.get("status"));
  // listFeedback 要用 me.id 判 votedByMe，只能串行
  const items = await listFeedback(db, me?.id ?? null, filter);
  return { me, items, filter };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db } = getAppContext(context);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  // 权限在业务 try 外（plan.tsx 纪律）：requireUser 对未登录抛重定向，不该被吞
  const user = await requireUser(request, db);

  // admin 状态流转：requireAdmin 也在 try 外，403 不许变 200
  if (intent === "moderate") {
    await requireAdmin(request, db);
    try {
      const status = String(fd.get("status") ?? "");
      // Object.hasOwn 而非 in：普通对象字面量会被 "toString" in 绕过原型链
      if (!Object.hasOwn(FEEDBACK_STATUS_LABELS, status))
        return { error: "未知状态" };
      await moderateFeedback(
        db,
        Number(fd.get("feedbackId")),
        status as FeedbackStatus,
        String(fd.get("statusNote") ?? ""),
      );
      return { ok: true, message: "已更新状态" };
    }
    catch {
      return { error: "状态更新失败，请重试" };
    }
  }

  try {
    if (intent === "create") {
      await createFeedback(
        db,
        user.id,
        String(fd.get("title") ?? ""),
        String(fd.get("detail") ?? ""),
      );
      return { ok: true, message: "已提交，感谢你的建议" };
    }
    if (intent === "vote") {
      // 重复投幂等；需求不存在时 FK 报错落 catch，文案兜成人话
      await voteFeedback(db, user.id, Number(fd.get("feedbackId")));
      return { ok: true };
    }
    if (intent === "unvote") {
      await unvoteFeedback(db, user.id, Number(fd.get("feedbackId")));
      return { ok: true };
    }
    return { error: "未知操作" };
  }
  catch (err) {
    // create 的校验/限频文案本身是人话，原样回显；vote/unvote 的底层
    // FK 错误对用户无意义，统一兜成「刷新重试」
    if (intent === "create")
      return { error: err instanceof Error ? err.message : "操作失败" };
    return { error: "操作失败，请刷新页面后重试" };
  }
}

/** 筛选 tab：全部 + 四态（标签从 domain 查，别在组件里再写一份） */
const FILTER_KEYS = ["all", "pending", "planned", "done", "rejected"] as const;
const FILTER_LABELS: Record<(typeof FILTER_KEYS)[number], string> = {
  all: "全部",
  ...FEEDBACK_STATUS_LABELS,
};

/** 单条需求行 */
function FeedbackRow({
  item,
  meId,
  isAdmin,
  onModerate,
}: {
  item: FeedbackCard;
  meId: number | null;
  isAdmin: boolean;
  onModerate: (item: FeedbackCard) => void;
}) {
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const busy = fetcher.state !== "idle";

  /** 投票/撤销；游客先去登录（带回跳，登录后回到本页） */
  function toggleVote() {
    if (meId === null) {
      void navigate("/login?redirectTo=/wall");
      return;
    }
    fetcher.submit(
      { intent: item.votedByMe ? "unvote" : "vote", feedbackId: String(item.id) },
      { method: "post" },
    );
  }

  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0 md:px-6 [border-bottom-style:solid]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{item.title}</span>
            <StatusBadge tone={feedbackStatusTone(item.status)}>
              {FEEDBACK_STATUS_LABELS[item.status]}
            </StatusBadge>
          </div>
          {item.detail && <p className="mt-1 text-sm text-muted">{item.detail}</p>}
          {item.statusNote && (
            <p className="mt-1 text-xs text-tertiary">
              主理人：
              {item.statusNote}
            </p>
          )}
          <div className="mt-1 font-num text-xs text-tertiary">
            {item.username}
            {" "}
            ·
            {" "}
            {fmtDate(item.createdAt)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isAdmin && (
            <Button size="small" onClick={() => onModerate(item)}>
              处理
            </Button>
          )}
          <Button
            size="small"
            icon={<LikeOutlined />}
            type={item.votedByMe ? "primary" : "default"}
            disabled={busy}
            onClick={toggleVote}
          >
            {item.voteCount}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Wall({ loaderData }: Route.ComponentProps) {
  const { me, items, filter } = loaderData;
  const isAdmin = me?.role === "admin";
  const mainFetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  // 筛选写进 URL（?status=done 可分享），loader 按它服务端过滤；本组件只写不读
  const [, setSearchParams] = useSearchParams();
  const [messageApi, holder] = message.useMessage();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  // admin 处理弹窗：目标 + 表单态
  const [target, setTarget] = useState<FeedbackCard | null>(null);
  const [modStatus, setModStatus] = useState<FeedbackStatus>("pending");
  const [modNote, setModNote] = useState("");
  /**
   * 最近一次经 mainFetcher 提交的 intent。用 ref 而非把 target 塞进
   * effect deps——后者会让「打开弹窗」这个状态变化重跑 effect，
   * 上一轮的 success 数据把刚打开的弹窗当场关掉（评审 Critical #1）。
   */
  const lastIntentRef = useRef<"create" | "moderate" | null>(null);

  /** 任一提交成功 → 关抽屉/弹窗 + toast；modal 场景的错误也走 toast */
  useEffect(() => {
    if (mainFetcher.state !== "idle" || !mainFetcher.data)
      return;
    if ("ok" in mainFetcher.data && mainFetcher.data.ok) {
      setDrawerOpen(false);
      setTarget(null);
      if ("message" in mainFetcher.data && mainFetcher.data.message)
        void messageApi.success(mainFetcher.data.message);
      lastIntentRef.current = null;
    }
    else if ("error" in mainFetcher.data && lastIntentRef.current === "moderate") {
      // 抽屉里的 create 错误由内联 Alert 展示；moderate 的错误弹窗内没有
      // Alert 位，用 toast 兜底
      void messageApi.error(mainFetcher.data.error);
      lastIntentRef.current = null;
    }
  }, [mainFetcher.state, mainFetcher.data, messageApi]);

  // 抽屉内 Alert 只认 create 自己的错误——渲染期读 ref，天然滤掉
  // moderate 留下的 error 残留（评审 Minor #2）
  const submitErr = lastIntentRef.current === "create" && mainFetcher.data && "error" in mainFetcher.data
    ? mainFetcher.data.error
    : null;

  function openCreate() {
    if (!me) {
      void navigate("/login?redirectTo=/wall");
      return;
    }
    setTitle("");
    setDetail("");
    setDrawerOpen(true);
  }

  function openModerate(item: FeedbackCard) {
    setTarget(item);
    setModStatus(item.status);
    setModNote(item.statusNote);
  }

  function submitCreate() {
    lastIntentRef.current = "create";
    mainFetcher.submit(
      { intent: "create", title, detail },
      { method: "post" },
    );
  }

  function submitModerate() {
    if (!target)
      return;
    lastIntentRef.current = "moderate";
    mainFetcher.submit(
      { intent: "moderate", feedbackId: String(target.id), status: modStatus, statusNote: modNote },
      { method: "post" },
    );
  }

  return (
    <>
      {holder}
      <Space direction="vertical" size="large" className="w-full">
        <div>
          <Title level={3} className="mb-1">
            需求墙
          </Title>
          <Paragraph type="secondary" className="mb-0">
            想要什么功能，在这里提出来、为想要的需求投票；主理人定期把高票需求排上日程。
            每人每天最多提交 3 条。
          </Paragraph>
        </div>

        <SectionCard
          extra={(
            <Button type="primary" onClick={openCreate}>
              提需求
            </Button>
          )}
          className="animate-fade-up"
        >
          <Tabs
            activeKey={filter}
            onChange={(key) => {
              // 服务端过滤：写进 URL，链接可分享（?status=done 直接看已完成）
              setSearchParams(key === "all" ? {} : { status: key });
            }}
            items={FILTER_KEYS.map(key => ({
              key,
              label: FILTER_LABELS[key],
              children: (
                <div className="-mx-4 -mb-2 md:-mx-6">
                  {items.length === 0
                    ? (
                        <div className="py-6">
                          <EmptyState description="这里还空着——第一条需求由你来提">
                            <Button type="primary" onClick={openCreate}>
                              提第一条需求
                            </Button>
                          </EmptyState>
                        </div>
                      )
                    : items.map(item => (
                        <FeedbackRow
                          key={item.id}
                          item={item}
                          meId={me?.id ?? null}
                          isAdmin={isAdmin}
                          onModerate={openModerate}
                        />
                      ))}
                </div>
              ),
            }))}
          />
        </SectionCard>
      </Space>

      {/* 提交需求抽屉：标题必填 + 详情选填，maxlength 与服务端同上限 */}
      <Drawer
        title="提需求"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" className="w-full">
          {submitErr && <Alert type="error" showIcon message={submitErr} />}
          <Input
            placeholder="一句话说清想要什么"
            showCount
            maxLength={FEEDBACK_TITLE_MAX}
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <Input.TextArea
            placeholder="补充背景与期望效果（可留空）"
            showCount
            maxLength={FEEDBACK_DETAIL_MAX}
            rows={4}
            value={detail}
            onChange={e => setDetail(e.target.value)}
          />
          <Button
            type="primary"
            block
            disabled={title.trim().length === 0}
            loading={mainFetcher.state !== "idle"}
            onClick={submitCreate}
          >
            提交
          </Button>
        </Space>
      </Drawer>

      {/* admin 状态流转弹窗（内联管理，/admin 后台保持只读） */}
      <Modal
        title="处理需求"
        open={target !== null}
        onCancel={() => setTarget(null)}
        onOk={submitModerate}
        okText="保存"
        confirmLoading={mainFetcher.state !== "idle"}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" className="w-full">
          {target && (
            <Paragraph type="secondary" className="mb-0">
              {target.title}
            </Paragraph>
          )}
          <Select
            className="w-full"
            value={modStatus}
            onChange={v => setModStatus(v)}
            options={(Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[]).map(s => ({
              value: s,
              label: FEEDBACK_STATUS_LABELS[s],
            }))}
          />
          <Input
            placeholder="备注（可选，会展示在需求卡上）"
            maxLength={200}
            value={modNote}
            onChange={e => setModNote(e.target.value)}
          />
        </Space>
      </Modal>
    </>
  );
}
