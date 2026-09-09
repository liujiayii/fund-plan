import type { ReactNode } from "react";
import { Logo } from "~/components/ui/Logo";
import { CARD_SHADOW, PRIMARY_GRADIENT } from "~/theme";

/**
 * Renders a responsive split-screen container for authentication forms.
 *
 * The container includes a branded panel on medium and larger screens and centers
 * the supplied form content in a constrained card area. The branded panel is
 * hidden on narrow screens.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="animate-fade-up mt-12 flex overflow-hidden rounded-2xl"
      style={{ boxShadow: CARD_SHADOW, maxWidth: 880, margin: "48px auto" }}
    >
      {/* 左屏：品牌面板。窄屏整块隐藏（hidden 工具类，responsive.css §9 兜底） */}
      <aside
        className="fp-auth-panel relative hidden flex-col justify-between overflow-hidden md:flex"
        style={{ background: PRIMARY_GRADIENT, color: "#fff", padding: 40, width: 340, minWidth: 340 }}
      >
        {/* 装饰曲线（与首页 hero 同语言，spec §6.1「处处重复」） */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full"
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,160 C80,140 140,90 220,95 C300,100 350,50 400,40 L400,200 L0,200 Z"
            fill="#fff"
            opacity="0.08"
          />
        </svg>
        <div className="relative z-10 flex items-center gap-2 font-bold">
          <Logo size={28} />
          模拟基金
        </div>
        <div className="relative z-10">
          <h2 className="m-0 text-2xl font-bold">用真数据，练真盘感</h2>
          <p className="mt-2 mb-0 text-sm leading-6 opacity-90">
            真实 T+1 撮合 · FIFO 阶梯赎回费 · 自动定投，不亏真钱把规则吃透。
          </p>
        </div>
      </aside>
      {/* 右屏：表单区 */}
      <div className="flex flex-1 items-center justify-center bg-card" style={{ padding: "40px 32px" }}>
        <div style={{ width: "min(360px, 100%)" }}>{children}</div>
      </div>
    </div>
  );
}
