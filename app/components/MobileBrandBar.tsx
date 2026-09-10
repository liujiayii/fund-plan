import { Logo } from "~/components/ui/Logo";
import { UserMenu } from "~/components/ui/UserMenu";

/**
 * 移动端顶部品牌胶囊（spec §4.3）：Logo + 站名 + 登录态，高 48，玻璃。
 * 768px+ 由 .fp-mobile 隐藏（侧栏接管品牌与登录态）。
 * sticky 钉顶：内容从胶囊底下穿过去，玻璃才「看得见」。
 */
export function MobileBrandBar({ user }: { user: { username: string; role: string } | null }) {
  return (
    <header className="fp-brandbar fp-mobile fp-glass sticky top-2 z-20 mx-3 mb-3 flex h-12 items-center justify-between rounded-full px-4">
      <a href="/" className="flex items-center gap-2 font-bold text-ink no-underline">
        <Logo size={24} />
        模拟基金
      </a>
      <UserMenu user={user} compact />
    </header>
  );
}
