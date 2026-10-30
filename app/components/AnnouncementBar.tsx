import type { Announcement } from "~/domain/announcement";
import { NotificationOutlined } from "@ant-design/icons";
import { Alert } from "antd";
import { useEffect, useRef } from "react";
import {
  ANNOUNCEMENT_ELEMENT_ID,
  buildDismissRecord,
  buildNoticeDismissScript,
  DISMISS_STORAGE_KEY,
  NOTICE_OFF_CLASS,
  shouldHideForVersion,
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
 * SPA 版本变化重估（CodeRabbit PR #114 指正）：关闭类挂在 <html> 上整个文档
 * 生命周期有效，而 root loader 每次 SPA 导航都会重新校验——拿到新版公告时
 * 必须按同一套规则重估显隐，否则新版横幅要整页刷新才见天日。重估走
 * domain 的 shouldHideForVersion（与内联脚本同一份判定，不另写一份）。
 *
 * 栅格：通栏铺满内容区（fp-main 全宽 + px-6），刻意不与正文列对齐——
 * 2026-10-30 主人要求横幅比主体内容更宽。间距（mt-4）挂在 Alert 自身——
 * antd 关闭后 Alert 卸载、间距随之消失，外层容器不留死空间。
 */
export function AnnouncementBar({ notice }: { notice: Announcement | null }) {
  const version = notice?.version;
  const cooldownDays = notice?.cooldownDays;
  const prevVersion = useRef<number | null>(null);

  // 版本/冷却变化时重估显隐：localStorage 里的关闭记录对着新版本重新判定，
  // 该藏则藏（幂等）、该现则摘类。挂载时也跑一次，与内联脚本的判定对账
  useEffect(() => {
    if (version === undefined || cooldownDays === undefined)
      return;
    if (prevVersion.current === version)
      return;
    prevVersion.current = version;

    let record: string | null = null;
    try {
      record = localStorage.getItem(DISMISS_STORAGE_KEY);
    }
    catch {}
    const html = document.documentElement;
    if (shouldHideForVersion(record, version, cooldownDays)) {
      html.classList.add(NOTICE_OFF_CLASS);
    }
    else {
      html.classList.remove(NOTICE_OFF_CLASS);
    }
  }, [version, cooldownDays]);

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
      className="fp-announcement w-full px-6"
    >
      {/* warning 语义色（琥珀）点题「公告/注意」；喇叭图标与导航「公告」同款。
          zh/en 支持 \n 换行（whitespace-pre-line），en 留空时不出 description。
          key=版本：版本变化强制重挂 Alert，清掉 antd 内部的关闭状态——
          否则旧版本里点过关闭，新版到了仍是被卸载的（CodeRabbit PR #114） */}
      <Alert
        key={notice.version}
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
