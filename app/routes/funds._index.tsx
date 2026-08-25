import type { Route } from "./+types/funds._index";
import type { FundSearchItem } from "~/services/fund-data";
import { Button, Card, Empty, Input, Space, Table, Tag, Typography } from "antd";
import { Form as RouterForm, useNavigation } from "react-router";
import { getAppContext } from "~/services/context";
import { searchFunds } from "~/services/fund-data";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return [{ title: "基金搜索 · 模拟基金" }];
}

/** 首屏给几个常见基金做引导，省得用户面对空页面不知道搜什么 */
const SUGGESTED = [
  { code: "000001", name: "华夏成长混合" },
  { code: "110022", name: "易方达消费行业股票" },
  { code: "161725", name: "招商中证白酒指数" },
  { code: "005827", name: "易方达蓝筹精选混合" },
  { code: "270042", name: "广发纳斯达克100指数" },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  void db;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q)
    return { q, results: [] as FundSearchItem[] };

  const results = await searchFunds(env, q);
  return { q, results };
}

export default function FundsIndex({ loaderData }: Route.ComponentProps) {
  const { q, results } = loaderData;
  const nav = useNavigation();
  const searching = nav.state === "loading";

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Title level={3}>基金搜索</Title>
        <Paragraph type="secondary">
          输入基金代码或名称，数据来自东方财富公开接口。点进详情可看真实净值曲线与费率。
        </Paragraph>
        <RouterForm method="get">
          <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
            <Input
              name="q"
              size="large"
              defaultValue={q}
              placeholder="如 000001 或 华夏成长"
              allowClear
            />
            <Button type="primary" size="large" htmlType="submit" loading={searching}>
              搜索
            </Button>
          </Space.Compact>
        </RouterForm>
      </Card>

      {q
        ? (
            <Card title={`「${q}」的搜索结果（${results.length} 条）`}>
              {results.length === 0
                ? (
                    <Empty description="没搜到，换个关键词试试" />
                  )
                : (
                    <Table
                      rowKey="code"
                      dataSource={results}
                      pagination={false}
                      size="middle"
                      columns={[
                        { title: "代码", dataIndex: "code", width: 120 },
                        { title: "名称", dataIndex: "name" },
                        {
                          title: "类型",
                          dataIndex: "type",
                          width: 160,
                          render: (t: string) => (t ? <Tag>{t}</Tag> : "—"),
                        },
                        {
                          title: "操作",
                          width: 120,
                          render: (_: unknown, r: FundSearchItem) => (
                            <a href={`/funds/${r.code}`}>查看详情</a>
                          ),
                        },
                      ]}
                    />
                  )}
            </Card>
          )
        : (
            <Card title="热门基金">
              <Space wrap>
                {SUGGESTED.map(f => (
                  <Button key={f.code} href={`/funds/${f.code}`}>
                    {f.name}
                    （
                    {f.code}
                    ）
                  </Button>
                ))}
              </Space>
            </Card>
          )}
    </Space>
  );
}
