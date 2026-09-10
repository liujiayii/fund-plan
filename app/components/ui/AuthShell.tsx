import type { ReactNode } from "react";
import { Logo } from "~/components/ui/Logo";

/**
 * 登录/注册分屏壳（liquid-glass spec §5.5）：一张玻璃大卡，左品牌面板透雾 + 门面高光
 * （宪法 §2.3 白名单：登录左屏），右表单区是井。
 * 窄屏左屏整块隐藏（hidden md:flex + responsive.css §9 .fp-auth-panel 兜底），
 * 品牌在场感由顶部品牌胶囊承担。
 * 玻璃上不再铺实色渐变大块（那是晨雾门面，宪法 §1 已作废）——品牌紫粉只以
 * 装饰曲线的描边与低透明填充出现。
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="fp-glass fp-glass-specular animate-fade-up relative mx-auto my-12 flex max-w-[880px] overflow-hidden rounded-[22px]">
      <aside className="fp-auth-panel relative hidden w-[340px] shrink-0 flex-col justify-between p-10 md:flex">
        {/* 装饰曲线（与 Logo 同语言）：主色描边 + 低透明填充 */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full"
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,160 C80,140 140,90 220,95 C300,100 350,50 400,40"
            stroke="var(--fp-primary)"
            strokeWidth="2"
            fill="none"
            opacity="0.5"
          />
          <path
            d="M0,160 C80,140 140,90 220,95 C300,100 350,50 400,40 L400,200 L0,200 Z"
            fill="var(--fp-primary)"
            opacity="0.10"
          />
        </svg>
        <div className="relative z-10 flex items-center gap-2 font-bold text-ink">
          <Logo size={28} />
          模拟基金
        </div>
        <div className="relative z-10">
          <h2 className="m-0 text-2xl font-bold text-ink">用真数据，练真盘感</h2>
          <p className="mt-2 mb-0 text-sm leading-6 text-muted">
            真实 T+1 撮合 · FIFO 阶梯赎回费 · 自动定投，不亏真钱把规则吃透。
          </p>
        </div>
      </aside>
      {/* 右屏：表单井（bg-well 不模糊，宪法 §3 玻璃里不叠玻璃） */}
      <div className="flex flex-1 items-center justify-center bg-well px-8 py-10">
        <div className="w-[min(360px,100%)]">{children}</div>
      </div>
    </div>
  );
}
