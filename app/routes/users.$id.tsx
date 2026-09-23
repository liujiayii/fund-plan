import type { Route } from "./+types/users.$id";
import { Typography } from "antd";
import { NavButton } from "~/components/ui/NavButton";
import { UserPortfolioReadonly } from "~/components/UserPortfolioReadonly";
import { pageMeta } from "~/domain/seo";
import { getUserDetail } from "~/services/admin-service";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";
import { canViewPublicPortfolio } from "~/services/portfolio-visibility";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "公开组合", path: "/users", index: false });
}

/**
 * 已登录用户看别人的公开组合。只读，与 admin 详情共用盘面组件。
 *
 * 双向开关：viewer 和 target 都必须 portfolio_public = 1。
 * 自己看自己不走这里（/me），未公开一律 403，不存在 404。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const me = await requireUser(request, db);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("用户不存在", { status: 404 });
  }

  const access = await canViewPublicPortfolio(db, me.id, id);
  if (!access.ok) {
    throw new Response(access.message, { status: access.status });
  }

  const [detail, profit] = await Promise.all([
    getUserDetail(db, id),
    getProfitDetail(db, id),
  ]);
  if (!detail) {
    throw new Response("用户不存在", { status: 404 });
  }

  return { detail, profit };
}

export default function PublicUserPortfolio({ loaderData }: Route.ComponentProps) {
  const { detail, profit } = loaderData;

  return (
    <UserPortfolioReadonly
      detail={detail}
      profit={profit}
      visibility="public"
      header={(
        <>
          <div>
            <Title level={3} style={{ marginBottom: 4 }}>
              {detail.user.username}
              {" 的组合"}
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              对方已公开组合。只读，不能代其下单或改设置。
            </Paragraph>
          </div>
          <NavButton to="/leaderboard">← 返回排行榜</NavButton>
        </>
      )}
    />
  );
}
