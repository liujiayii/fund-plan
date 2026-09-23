import type { Route } from "./+types/admin_.users.$id";
import { Tag, Typography } from "antd";
import { NavButton } from "~/components/ui/NavButton";
import { UserPortfolioReadonly } from "~/components/UserPortfolioReadonly";
import { pageMeta } from "~/domain/seo";
import { toBeijing } from "~/domain/trading-calendar";
import { getUserDetail } from "~/services/admin-service";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireAdmin } from "~/services/guard";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "用户详情 · 管理后台", path: "/admin", index: false });
}
/**
 * admin 看某个用户的盘：只读。IA 对齐 /me（钱 → 仓 → tabs），
 * 只读铁律不变——全页没有任何操作按钮。盘面本体在 UserPortfolioReadonly。
 *
 * ⚠️ 文件名里的 `admin_.` 尾下划线是刻意的：断开与 admin.tsx 的嵌套。
 * 此前叫 admin.users.$id.tsx（点号串联=嵌套路由），但 admin.tsx 是普通
 * 页面组件没有 <Outlet/>，嵌套子路由永远渲染不出来——整页访问时 title
 * 换了正文却还是列表页（PR #34 起就坏，SPA 化后症状放大成「URL 变了
 * 内容不变」）。改名后两条路由各自整屏渲染，互不包裹。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  await requireAdmin(request, db);

  const id = Number(params.id);
  // 非数字 id（如 /admin/users/abc）与不存在的用户一并 404
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("用户不存在", { status: 404 });
  }

  // 详情包（组合/订单/在途/定投）与收益三件套互不依赖，一波并行。
  // 用户不存在时 getProfitDetail 只是空序列，多查几条换掉串行的一跳往返划算
  const [detail, profit] = await Promise.all([
    getUserDetail(db, id),
    getProfitDetail(db, id),
  ]);
  if (!detail) {
    throw new Response("用户不存在", { status: 404 });
  }

  return { detail, profit };
}

export default function AdminUserDetail({ loaderData }: Route.ComponentProps) {
  const { detail, profit } = loaderData;
  const { user } = detail;

  return (
    <UserPortfolioReadonly
      detail={detail}
      profit={profit}
      header={(
        <>
          <div>
            <Title level={3} style={{ marginBottom: 4 }}>
              {user.username}
              {" 的盘"}
              {user.role === "admin" && <Tag style={{ marginLeft: 8 }}>主理人</Tag>}
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              注册于
              {" "}
              {toBeijing(new Date(user.createdAt)).format("YYYY-MM-DD")}
              {" "}
              ·
              管理员只读视图，与用户自己的 /me 同口径
            </Paragraph>
          </div>
          {/* 返回列表的入口放标题区下方，排查问题时在多个用户间跳转是高频动作 */}
          <NavButton to="/admin">← 返回用户列表</NavButton>
        </>
      )}
    />
  );
}
