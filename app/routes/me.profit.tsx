import type { Route } from "./+types/me.profit";
import { Space, Typography } from "antd";
import { ProfitContent } from "~/components/ProfitContent";
import { pageMeta } from "~/domain/seo";
import { getProfitDetail } from "~/services/asset-service";
import { getAppContext } from "~/services/context";
import { requireUser } from "~/services/guard";

const { Title } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({ title: "收益明细", path: "/me/profit", index: false });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = getAppContext(context);
  const user = await requireUser(request, db);
  const detail = await getProfitDetail(db, user.id);
  return { detail };
}

/**
 * 收益明细页（深链 /me/profit）。
 *
 * 页面本体只剩标题——内容体全在共享组件 ProfitContent 里，与 /me 的
 * 「收益明细」tab（MeTabsPanels.ProfitPanel 懒加载本路由 loader）
 * 一份真相：摘要 + 资产走势 + 收益日历，口径含已实现盈亏与全部费用。
 */
export default function MeProfit({ loaderData }: Route.ComponentProps) {
  const { detail } = loaderData;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Title level={3} style={{ marginBottom: 0 }}>
        收益明细
      </Title>
      <ProfitContent detail={detail} />
    </Space>
  );
}
