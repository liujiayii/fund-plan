import type { DcaPlanView } from "~/services/portfolio-service";
import { Button, Dropdown, message, Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { DcaPlanFormModal } from "~/components/DcaPlanFormModal";

/** /me/dca action 的返回形状 */
interface ActionData {
  ok?: boolean;
  message?: string;
  error?: string;
}

export interface DcaPlanRowActionsProps {
  plan: DcaPlanView;
}

/**
 * 定投计划行内「···」操作：修改 / 暂停·启用 / 删除（2026-09-09 随「修改」抽出）。
 *
 * 此前 me.dca、MeTabsPanels.DcaPanel、DcaFundPanel 三处各抄一份下拉，
 * 这次收拢为唯一实现——toggle/delete 用组件自己的 fetcher 提交到
 * /me/dca 的 action，toast 反馈；「修改」内嵌 DcaPlanFormModal（编辑模式，
 * 条件渲染保证每次打开预填值取自最新 plan）。
 *
 * 提交完成后 react-router 自动 revalidate：宿主页面的 loader 与面板的
 * fetcher.load 全部刷新，列表所见即最新（MeTabsPanels 的 stale-while-
 * revalidate 同一机制）。
 */
export function DcaPlanRowActions({ plan }: DcaPlanRowActionsProps) {
  const fetcher = useFetcher<typeof import("~/routes/me.dca").action>();
  const submitting = fetcher.state !== "idle";

  // 修改弹窗开合；条件渲染 DcaPlanFormModal——每次打开都是新实例，
  // 金额/频率预填值天然取自当前 plan，不用手动同步
  const [editOpen, setEditOpen] = useState(false);

  // toggle/delete 结果 toast（notifiedRef 按 data 对象判重，同 OrderActions 套路）
  const notifiedRef = useRef<ActionData | null>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (!d || d === notifiedRef.current)
      return;
    notifiedRef.current = d;
    if (d.ok) {
      message.success(d.message ?? "操作成功");
    }
    else if (d.error) {
      message.error(d.error);
    }
  }, [fetcher.data]);

  const submit = (data: Record<string, string>) =>
    fetcher.submit(data, { method: "post", action: "/me/dca" });

  return (
    <>
      <Dropdown
        menu={{
          items: [
            { key: "edit", label: "修改" },
            { key: "toggle", label: plan.status === "active" ? "暂停" : "启用" },
            { key: "delete", label: "删除", danger: true },
          ],
          onClick: ({ key }) => {
            if (key === "edit") {
              setEditOpen(true);
            }
            else if (key === "toggle") {
              submit({
                intent: "toggle",
                id: String(plan.id),
                status: plan.status === "active" ? "paused" : "active",
              });
            }
            else if (key === "delete") {
              // 两步进删除（点行内直接删太容易误触）
              Modal.confirm({
                title: "确定删除这个定投计划？",
                content: "已产生的订单和持仓不受影响。",
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => submit({ intent: "delete", id: String(plan.id) }),
              });
            }
          },
        }}
      >
        <Button size="small" disabled={submitting}>
          ···
        </Button>
      </Dropdown>

      {editOpen && (
        <DcaPlanFormModal plan={plan} open onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}
