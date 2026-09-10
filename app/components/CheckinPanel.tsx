import type { FetcherWithComponents } from "react-router";
import { Alert, Button, Progress, Typography } from "antd";
import { fmtYuan } from "~/components/ui/format";
import { StatBig } from "~/components/ui/StatBig";
import { CHECKIN_MAX_CENTS } from "~/domain/checkin";
import { COLOR } from "~/theme";

const { Text } = Typography;

/** 签到 action 的返回形状（me._index 的 action：成功 { ok, message } / 失败 { error }） */
type CheckinActionData = { ok: boolean; message: string; error?: undefined } | { error: string; ok?: undefined; message?: undefined };

export interface CheckinPanelProps {
  status: {
    streak: number;
    checkedToday: boolean;
    nextReward: number;
    totalCheckin: number;
  };
  /** me._index 的签到 fetcher（宿主创建，桌面卡与窄屏井共用同一个） */
  fetcher: FetcherWithComponents<CheckinActionData | undefined>;
  /**
   * 紧凑形态（窄屏总览卡底部的一条井）：一行「连签 N 天 · 今日可领 X 元」+ 按钮。
   * 桌面独立卡用完整形态：三个数字 + 进度条 + 大按钮
   */
  compact?: boolean;
}

/**
 * 每日签到面板（liquid-glass spec §5.1）：从 /me 独立整卡收进总览旁 / 总览底。
 * 桌面与窄屏双渲染两种形态（.fp-desktop / .fp-mobile 显隐），
 * 同一个 fetcher、同一个 action，无逻辑分叉。
 *
 * ⚠️ Progress 的 strokeColor 必须显式传：antd 在 percent >= 100 且未传 status
 * 时自动切 success 变绿，而绿在本项目专属「跌」（原 me._index 注释）。
 * 签到金额用主色而非涨色：这是「领取本金」的操作引导，不是投资收益。
 */
export function CheckinPanel({ status, fetcher, compact }: CheckinPanelProps) {
  const signing = fetcher.state === "submitting";
  const percent = Math.round((status.nextReward / CHECKIN_MAX_CENTS) * 100);
  const button = (
    <fetcher.Form method="post">
      <Button
        type="primary"
        size={compact ? "middle" : "large"}
        htmlType="submit"
        block={!compact}
        loading={signing}
        disabled={status.checkedToday}
      >
        {status.checkedToday ? "今日已签到" : "立即签到"}
      </Button>
    </fetcher.Form>
  );

  const feedback = (
    <>
      {fetcher.data?.ok && (
        <Alert type="success" showIcon message={fetcher.data.message} className="mb-3" />
      )}
      {fetcher.data?.error && (
        <Alert type="error" showIcon message={fetcher.data.error} className="mb-3" />
      )}
    </>
  );

  if (compact) {
    return (
      <div className="mt-4 rounded-[12px] bg-well p-3">
        {feedback}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-muted">
            连签
            {" "}
            <span className="font-num text-ink">{status.streak}</span>
            {" "}
            天 ·
            {" "}
            {status.checkedToday ? "明天可领" : "今日可领"}
            {" "}
            <span className="font-num text-primary">{fmtYuan(status.nextReward)}</span>
            {" "}
            元
          </div>
          {button}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {feedback}
      <StatBig label="当前连签" value={status.streak} suffix="天" size={24} />
      <div>
        <StatBig
          label={status.checkedToday ? "明天可领" : "今天可领"}
          value={fmtYuan(status.nextReward)}
          suffix="元"
          size={24}
          color={COLOR.primary}
        />
        <Progress percent={percent} size="small" showInfo={false} className="mt-2" strokeColor={COLOR.primary} />
        <Text type="secondary" className="text-xs">连签递增，每天 +50 元，封顶 500 元</Text>
      </div>
      <StatBig label="累计签到入金" value={fmtYuan(status.totalCheckin)} suffix="元" size={24} />
      <div className="mt-auto">{button}</div>
    </div>
  );
}
