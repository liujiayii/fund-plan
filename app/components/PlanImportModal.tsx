import type { PlanImportRow } from "~/services/plan-import";
import { Alert, Button, Input, InputNumber, Modal, Select, Table } from "antd";
import { useMemo, useState } from "react";
import { fmtYuan } from "~/components/ui/format";
import { centsToYuan, yuanToCents } from "~/domain/money";
import { PLAN_FUND_CATALOG } from "~/domain/plan-catalog";

/** 提交给 action 的一行 */
export interface CommitRow {
  alias: string;
  fundCode: string;
  amountCents: number;
}

/** 预览表里可编辑的行 */
interface EditableRow {
  alias: string;
  amountCents: number;
  fundCode: string | null;
  /** 选中代码的基金全称：核对用，档案没拉过时为 null */
  fundName: string | null;
  /** 代码来自品种池的确定命中：这类行只读，避免在 52 条里手滑选错 */
  fromCatalog: boolean;
  notices: string[];
}

export interface PlanImportModalProps {
  open: boolean;
  onClose: () => void;
  /** action 的 parse 结果；null 表示还没解析 */
  preview: { periodDate: string | null; warnings: string[]; rows: PlanImportRow[] } | null;
  /** 解析中 / 提交中 */
  parsing: boolean;
  submitting: boolean;
  /** action 返回的错误 */
  error: string | null;
  /** 提交成功后的结果 */
  done: { placed: number; totalCents: number } | null;
  /** 主理人的可用现金（分），游客/未取到时为 null */
  cashCents: number | null;
  onParse: (text: string) => void;
  onCommit: (periodDate: string, rows: CommitRow[]) => void;
  /** 回到粘贴步骤（丢掉本次预览） */
  onReset: () => void;
}

/**
 * 「录入本期」弹窗：粘贴 → 预览 → 确认。
 *
 * 三个状态都由页面传进来，组件本身不发请求——这样 fetcher 的生命周期
 * 留在 `/plan` 里，Modal 可以单独渲染（与 PlanBuysCard 的分工一致）。
 *
 * 金额用 InputNumber 的「元」，转分仍走 `yuanToCents`（Decimal）——
 * 精度铁律不因为是 UI 层就开口子。
 */
export function PlanImportModal({
  open,
  onClose,
  preview,
  parsing,
  submitting,
  error,
  done,
  cashCents,
  onParse,
  onCommit,
  onReset,
}: PlanImportModalProps) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  /**
   * 预览变化时重置可编辑副本：上一次改过的金额不该被带到新一期。
   *
   * 用「渲染期调整 state」而不是 useEffect——这是 React 官方认可的派生写法
   * （同一次渲染内会立刻用新 state 重渲染），也避免 `react/set-state-in-effect`
   * 那条告警（effect 里同步 setState 会多一次无谓渲染）。
   */
  const [lastPreview, setLastPreview] = useState(preview);
  if (preview !== lastPreview) {
    setLastPreview(preview);
    setRows((preview?.rows ?? []).map(r => ({
      alias: r.alias,
      amountCents: r.amountCents,
      fundCode: r.selectedCode,
      fundName: r.selectedName,
      fromCatalog: r.selectedCode !== null,
      notices: r.notices,
    })));
  }

  /**
   * 下拉选项是全表（螺丝钉品种池），**不随行变化**。
   * 这是「猜不中时」唯一的自救手段：池外或简称变体没覆盖到，人工从 50 条里挑。
   */
  const catalogOptions = useMemo(
    () => PLAN_FUND_CATALOG.map(i => ({
      value: i.otcCode,
      label: `${i.otcCode} ${i.alias}`,
    })),
    [],
  );

  const totalCents = useMemo(
    () => rows.reduce((s, r) => s + r.amountCents, 0),
    [rows],
  );
  const missing = rows.filter(r => r.fundCode === null).length;
  const invalidAmount = rows.some(r => r.amountCents <= 0);
  const overCash = cashCents !== null && totalCents > cashCents;
  const canCommit
    = preview !== null
      && preview.periodDate !== null
      && rows.length > 0
      && missing === 0
      && !invalidAmount
      && !overCash
      && !submitting;

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function submit() {
    if (!preview?.periodDate)
      return;
    onCommit(
      preview.periodDate,
      rows.map(r => ({
        alias: r.alias,
        fundCode: r.fundCode!,
        amountCents: r.amountCents,
      })),
    );
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="录入本期定投计划"
      width={860}
      destroyOnHidden
      footer={done
        ? [<Button key="close" type="primary" onClick={onClose}>关闭</Button>]
        : preview
          ? [
              <Button key="cancel" onClick={onClose}>取消</Button>,
              <Button
                key="ok"
                type="primary"
                loading={submitting}
                disabled={!canCommit}
                onClick={submit}
              >
                确认下单
              </Button>,
            ]
          : null}
    >
      {done
        ? (
            <Alert
              type="success"
              showIcon
              message={`已下单 ${done.placed} 笔，合计 ${fmtYuan(done.totalCents)} 元`}
              description="本页数据已刷新为本期；日历里下周同一时间再来一次即可。"
            />
          )
        : (
            <div className="flex flex-col gap-4">
              {preview === null
                ? (
                    <>
                      <Input.TextArea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        rows={9}
                        placeholder={"把公众号回复整段粘进来，例如：\n时间：2026年10月20日\n\n品种：\n• 中证白酒，1239元"}
                      />
                      <div>
                        <Button
                          type="primary"
                          loading={parsing}
                          disabled={text.trim() === ""}
                          onClick={() => onParse(text)}
                        >
                          解析
                        </Button>
                      </div>
                    </>
                  )
                : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-muted">
                          期次
                          {" "}
                          <strong className="text-ink">{preview.periodDate ?? "未识别"}</strong>
                        </span>
                        <Button type="link" size="small" onClick={onReset}>
                          重新粘贴
                        </Button>
                      </div>

                      {preview.warnings.map(w => (
                        <Alert key={w} type="warning" showIcon message={w} />
                      ))}

                      <Table<EditableRow>
                        size="small"
                        rowKey="alias"
                        pagination={false}
                        locale={{ emptyText: "这一期没有要提交的品种，点「重新粘贴」再来一次" }}
                        dataSource={rows}
                        columns={[
                          { title: "原文品种", dataIndex: "alias", width: 150 },
                          {
                            title: "对应基金",
                            width: 330,
                            // 第三个参数就是行下标：别用 rows.indexOf(r) 反查，
                            // 旧对象引用会返回 -1，用户的编辑被静默丢掉
                            render: (_, r, index) => {
                              // 命中品种池就是确定的：只读展示。
                              // 52 条里有 5 个带「红利」的，下拉一屏扫过去很容易点错，
                              // 而这是整个流程最不该出错的地方。要改就改 plan-catalog。
                              if (r.fromCatalog) {
                                return (
                                  <div className="leading-tight">
                                    <span className="font-num text-[13px] text-ink">{r.fundCode}</span>
                                    <span className="ml-1.5 text-[12px] text-muted">{r.alias}</span>
                                    {r.fundName && (
                                      <div className="text-[11px] text-tertiary">{r.fundName}</div>
                                    )}
                                  </div>
                                );
                              }

                              // 池外才有交互：给人兜底，总比整批卡死强
                              return (
                                <Select
                                  className="w-full"
                                  showSearch
                                  value={r.fundCode ?? undefined}
                                  placeholder="品种池里没有，请手选"
                                  optionFilterProp="label"
                                  status={r.fundCode === null ? "error" : undefined}
                                  options={catalogOptions}
                                  onChange={(code) => {
                                    updateRow(index, {
                                      fundCode: code,
                                      // 换了代码就丢掉旧全称，避免显示成上一只的名字
                                      fundName: code === r.fundCode ? r.fundName : null,
                                    });
                                  }}
                                />
                              );
                            },
                          },
                          {
                            title: "金额（元）",
                            width: 120,
                            render: (_, r, index) => (
                              <InputNumber
                                className="w-full"
                                min={0}
                                precision={2}
                                status={r.amountCents <= 0 ? "error" : undefined}
                                // 分 → 元走 centsToYuan（Decimal），不在这里开口子
                                value={Number(centsToYuan(r.amountCents))}
                                onChange={(v) => {
                                  updateRow(index, {
                                    amountCents: yuanToCents(typeof v === "number" ? v : 0),
                                  });
                                }}
                              />
                            ),
                          },
                          {
                            title: "提示",
                            render: (_, r) => (
                              <span className="text-[12px] text-muted">
                                {r.notices.join("；")}
                              </span>
                            ),
                          },
                          {
                            // 这期不买某只：删掉这一行，别逼人把金额改成 0（那会触发校验）
                            title: "",
                            width: 56,
                            render: (_v, _r, index) => (
                              <Button
                                type="text"
                                size="small"
                                danger
                                onClick={() => setRows(prev => prev.filter((_, i) => i !== index))}
                              >
                                删除
                              </Button>
                            ),
                          },
                        ]}
                      />

                      <div className="flex items-center justify-between">
                        <span className="text-[13px]">
                          合计
                          {" "}
                          <strong>{fmtYuan(totalCents)}</strong>
                          {" "}
                          元
                          {cashCents !== null && (
                            <span className="ml-2 text-muted">
                              可用
                              {" "}
                              {fmtYuan(cashCents)}
                              {" "}
                              元
                            </span>
                          )}
                        </span>
                        {missing > 0 && (
                          <span className="text-[12px] text-fall">
                            还有
                            {" "}
                            {missing}
                            {" "}
                            只未选基金
                          </span>
                        )}
                        {invalidAmount && (
                          <span className="text-[12px] text-fall">有金额为 0 的行</span>
                        )}
                        {overCash && (
                          <span className="text-[12px] text-fall">金额超过可用现金</span>
                        )}
                      </div>
                    </>
                  )}

              {error !== null && <Alert type="error" showIcon message={error} />}
            </div>
          )}
    </Modal>
  );
}
