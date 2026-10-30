import type { Announcement } from "~/domain/announcement";
import { NotificationOutlined } from "@ant-design/icons";
import { Alert } from "antd";
import {
  ANNOUNCEMENT_ELEMENT_ID,
  buildDismissRecord,
  buildNoticeDismissScript,
  DISMISS_STORAGE_KEY,
  NOTICE_OFF_CLASS,
} from "~/domain/announcement";

/**
 * 全站公告横幅（设计 §2；形态经主人三轮验收定为 antd Alert warning 卡）。
 *
 * 显隐模型：SSR 恒渲染，显隐全靠 <html> 上的 fp-notice-off 类（CSS 控制）——
 * 「已关闭」记忆在浏览器 localStorage（按 version + 关闭时刻记，冷却期内不再
 * 出现，冷却天数由 admin 配置；admin 改内容版本变化，冷却立刻失效重新出现）。
 * 内联脚本在横幅之后同步执行，冷却中的用户首帧前就藏好，零闪烁零 CLS；
 * 游客页整页边缘缓存里存的是「横幅 + 脚本」，开关是个体浏览器的事，与缓存兼容。
 *
 * 栅格与 main 完全同源（max-w-[1120px] mx-auto px-6），横幅永远和正文对齐；
 * 间距（mt-4）挂在 Alert 自身——antd 关闭后 Alert 卸载、间距随之消失，
 * 外层容器不留死空间。
 */
export function AnnouncementBar({ notice }: { notice: Announcement | null }) {
  if (!notice || !notice.enabled || notice.zh.length === 0)
    return null;

  // 关闭动作：写记忆（版本|时刻，供冷却判断）+ 挂类。antd 的 closable 随后
  // 会把 Alert 播放收起动画并卸载；挂类让外层容器立刻隐藏。localStorage 在
  // 隐私模式等场景可能抛错，吞掉即可——大不了这条浏览器每次都看到横幅
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, buildDismissRecord(notice.version));
    }
    catch {}
    document.documentElement.classList.add(NOTICE_OFF_CLASS);
  };

  return (
    <div
      id={ANNOUNCEMENT_ELEMENT_ID}
      data-version={String(notice.version)}
      data-cooldown={String(notice.cooldownDays)}
      className="fp-announcement mx-auto w-full max-w-[1120px] px-6"
    >
      {/* warning 语义色（琥珀）点题「公告/注意」；喇叭图标与导航「公告」同款。
          zh/en 支持 \n 换行（whitespace-pre-line），en 留空时不出 description */}
      <Alert
        className="mt-4"
        type="warning"
        showIcon
        icon={<NotificationOutlined />}
        title={<span className="whitespace-pre-line">{notice.zh}</span>}
        description={notice.en.length > 0
          ? <span className="whitespace-pre-line">{notice.en}</span>
          : undefined}
        closable
        onClose={dismiss}
      />
      {/* 首帧前隐藏脚本：全文静态串（domain 纯函数产出，有单测），无用户输入 */}
      <script
        // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- 静态内联脚本，见上注释
        dangerouslySetInnerHTML={{ __html: buildNoticeDismissScript() }}
      />
    </div>
  );
}
