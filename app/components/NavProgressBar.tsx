import { useEffect, useState } from "react";
import { useNavigation } from "react-router";
import { COLOR } from "~/theme";
import "../styles/nav-progress.css";

/**
 * 全局导航进度条（NProgress 风格的零依赖替代）。
 *
 * 背景：大陆访问 Cloudflare 链路慢（实测 TTFB 中位 1.7~2.9s，绕 AMS 时 4~5s，
 * 见 docs/china-access.md），SPA 导航期间旧页面毫无反馈，用户会以为没点上
 * 而反复点击。本组件在任意 loader/导航 pending 时于视口顶部显示一条细进度条。
 *
 * 不用 NProgress 依赖：它依赖 DOM 手动操作且样式需额外定制，30 行内可自绘。
 * 只覆盖 SPA 导航——表单提交（useFetcher）已各自有按钮 loading，互不重复；
 * 游客整页跳转（/ 与 /master 的原生 <a>）由浏览器标签页自带 spinner 反馈。
 *
 * SSR 恒为 idle 且 shown 初始 false，渲染 opacity:0 的空壳，与客户端首帧一致，
 * 无 hydration 分歧。
 */
export function NavProgressBar() {
  const navigation = useNavigation();
  const active = navigation.state !== "idle";

  // 展示与活动解耦：起跳延迟 150ms，快速导航（本地 dev / 命中缓存的回访）
  // 一闪而过时不闪条；一旦显示过，本次导航内保持显示直到 idle 再淡出。
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (active) {
      // 直接传函数引用（e18e/prefer-timer-args）：免掉箭头包一层的额外分配
      const show = () => setShown(true);
      const timer = setTimeout(show, 150);
      // 150ms 内导航就结束 → 清掉定时器，条从未出现过，零闪烁
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react/set-state-in-effect -- shown 是「active 连续保持 ≥150ms」的时间派生态，无法从 props/render 期纯推导；idle 时立即重置是刻意行为
    setShown(false);
  }, [active]);

  return (
    <div
      aria-hidden="true"
      className="fp-nav-progress"
      style={{
        backgroundColor: COLOR.primary,
        opacity: shown ? 1 : 0,
        // 隐藏时暂停动画：空闲期零 CPU；下次导航从暂停处继续，对不确定型动画无感知
        animationPlayState: shown ? "running" : "paused",
      }}
    />
  );
}
