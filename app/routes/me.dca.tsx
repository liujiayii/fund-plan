import type { Route } from "./+types/me.dca";
import { Button, Space, Typography } from "antd";
import { useState } from "react";
import { DcaPlanFormModal } from "~/components/DcaPlanFormModal";
import { DcaPlanList } from "~/components/DcaPlanList";
import { DcaPlanRowActions } from "~/components/DcaPlanRowActions";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtYuan } from "~/components/ui/format";
import { NavButton } from "~/components/ui/NavButton";
import { SectionCard } from "~/components/ui/SectionCard";
import { StatBig } from "~/components/ui/StatBig";
import { yuanToCents } from "~/domain/money";
import { pageMeta } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import {
  createDcaPlan,
  deleteDcaPlan,
  toggleDcaPlan,
  updateDcaPlan,
} from "~/services/dca-service";
import { searchFunds } from "~/services/fund-data";
import { requireUser } from "~/services/guard";
import { getDcaPlans } from "~/services/portfolio-service";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "我的定投", path: "/me/dca", index: false });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);

  // ?fund= 过滤：/me 与持仓详情页的定投 tab 懒加载共用本 loader。
  // getDcaPlans 本就吃可选 fundCode，零 service 改动。
  // 空串（手输裸 ?fund=）视同未过滤——`??` 不吃空串会把 eq(fundCode, "") 查成
  // 空列表吓到用户，`||` 与 me.orders 的 `if (fundCode)` 口径对齐（评审修正）
  const fundCode = new URL(request.url).searchParams.get("fund");
  const plans = await getDcaPlans(db, user.id, fundCode || undefined);

  // 过滤指示要显示基金名（where 回调风格与本文件 action 一致）
  let fundFilter: { code: string; name: string } | null = null;
  if (fundCode) {
    const f = await db.query.fund.findFirst({
      where: (f, { eq }) => eq(f.code, fundCode),
    });
    fundFilter = { code: fundCode, name: f?.name ?? fundCode };
  }
  return { plans, fundFilter };
}

/**
 * create/update 共用的定投字段解析（金额/频率/日子）。
 * fundCode 只属于 create、id 只属于 update，由各自分支取。
 */
function parseScheduleFields(fd: FormData): {
  amountCents: number;
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
} | { error: string } {
  const amount = String(fd.get("amount") ?? "");
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0)
    return { error: "请输入正确的金额" };
  const frequency = String(fd.get("frequency") ?? "monthly") as
    | "daily"
    | "weekly"
    | "monthly";
  const dayOfWeek = fd.get("dayOfWeek") ? Number(fd.get("dayOfWeek")) : null;
  const dayOfMonth = fd.get("dayOfMonth") ? Number(fd.get("dayOfMonth")) : null;
  return { amountCents: yuanToCents(amount), frequency, dayOfWeek, dayOfMonth };
}

/**
 * 定投四 intent 的统一 action（create/update/toggle/delete）。
 * 消费方：本页、MeTabsPanels 的 DcaPanel、DcaFundPanel（基金/持仓页抽屉）、
 * DcaPlanRowActions / DcaPlanFormModal——全部显式指到这里，一个真相。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { db, env } = getAppContext(context);
  const user = await requireUser(request, db);

  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  try {
    if (intent === "create") {
      const fundCode = String(fd.get("fundCode") ?? "").trim();
      const fields = parseScheduleFields(fd);
      if ("error" in fields)
        return { error: fields.error };
      if (!/^\d{6}$/.test(fundCode))
        return { error: "请输入 6 位基金代码" };

      // 基金可能还没入库（用户没点过详情页），这里顺手拉一次
      const exists = await db.query.fund.findFirst({
        where: (f, { eq }) => eq(f.code, fundCode),
      });
      if (!exists) {
        const found = await searchFunds(env, fundCode);
        if (found.length === 0) {
          return { error: `没找到基金 ${fundCode}，请先在基金页搜索确认` };
        }
        return {
          error: `请先访问 /funds/${fundCode} 查看一次该基金，系统会自动收录后再来创建定投`,
        };
      }

      await createDcaPlan(db, {
        userId: user.id,
        fundCode,
        ...fields,
      });
      return { ok: true, message: "定投计划已创建" };
    }

    if (intent === "update") {
      const id = Number(fd.get("id"));
      const fields = parseScheduleFields(fd);
      if ("error" in fields)
        return { error: fields.error };
      await updateDcaPlan(db, user.id, id, fields);
      return { ok: true, message: "计划已更新，下次执行按新计划排期" };
    }

    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      const status = String(fd.get("status")) as "active" | "paused";
      await toggleDcaPlan(db, user.id, id, status);
      return { ok: true, message: status === "active" ? "已启用" : "已暂停" };
    }

    if (intent === "delete") {
      const id = Number(fd.get("id"));
      await deleteDcaPlan(db, user.id, id);
      return { ok: true, message: "计划已删除" };
    }

    return { error: "未知操作" };
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : "操作失败" };
  }
}

/**
 * 我的定投页（深链 /me/dca、/me/dca?fund=）。
 *
 * 页面本体只剩骨架：统计、列表、新建入口——表单弹窗与行内操作全部走
 * 共享组件（DcaPlanFormModal / DcaPlanRowActions），与 /me 的定投 tab
 * （MeTabsPanels.DcaPanel 懒加载本路由 loader）、基金/持仓页的定投抽屉
 * （DcaFundPanel）一份真相。
 */
export default function MeDca({ loaderData }: Route.ComponentProps) {
  const { plans, fundFilter } = loaderData;
  const [createOpen, setCreateOpen] = useState(false);

  const totalInvested = plans.reduce((s, p) => s + p.totalInvested, 0);
  const activeCount = plans.filter(p => p.status === "active").length;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Title level={3} style={{ marginBottom: 0 }}>
          我的定投
        </Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建定投计划
        </Button>
      </Space>

      {/* 来自 ?fund= 深链时旁挂返回入口；过滤口径由 URL 与列表内容自明 */}
      {fundFilter && (
        <NavButton size="small" to={`/me/holdings/${fundFilter.code}`}>
          ← 返回持仓详情
        </NavButton>
      )}

      {/* animate-fade-up：区块进场淡入（首卡无延迟） */}
      <SectionCard className="animate-fade-up">
        {/* [16,16]：统计行间距降档，窄屏折行后不撑高 */}
        <Space size={[16, 16]} wrap>
          <StatBig label="计划总数" value={plans.length} suffix="个" size={24} />
          <StatBig label="执行中" value={activeCount} suffix="个" size={24} />
          <StatBig
            label="累计投入"
            value={fmtYuan(totalInvested)}
            suffix="元"
            size={24}
          />
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          系统每天北京时间
          {" "}
          <Typography.Text strong>10:00</Typography.Text>
          {" "}
          扫描到期的定投计划并自动下单，
          当晚 20:30 按当日净值撮合确认。现金不足时该期跳过，不影响其他计划。
        </Paragraph>
      </SectionCard>

      {/* 交错进场：第 2 卡延迟 60ms（animate-delay 写法的坑见 uno.config.ts） */}
      <SectionCard title="计划列表" className="animate-fade-up animate-delay-[60ms]">
        {plans.length === 0
          ? (
              <EmptyState description="还没有定投计划">
                <Button type="primary" onClick={() => setCreateOpen(true)}>
                  创建第一个计划
                </Button>
              </EmptyState>
            )
          : (
              <DcaPlanList
                plans={plans}
                renderActions={p => <DcaPlanRowActions plan={p} />}
              />
            )}
      </SectionCard>

      {/* 条件渲染 = 每次打开全新实例，表单初始值不用手动重置 */}
      {createOpen && (
        <DcaPlanFormModal
          open
          onClose={() => setCreateOpen(false)}
          defaultFundCode={fundFilter?.code}
        />
      )}
    </Space>
  );
}
