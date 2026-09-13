import type { Route } from "./+types/funds._index";
import type { FundSearchItem } from "~/services/fund-data";
import type { FundType, RankPeriod } from "~/services/rank-service";
import { Button, Input, Segmented, Space, Typography } from "antd";
import { Form as RouterForm, useNavigation, useSearchParams } from "react-router";
import { EmptyState } from "~/components/ui/EmptyState";
import { FundListItem } from "~/components/ui/FundListItem";
import { NavButton } from "~/components/ui/NavButton";
import { PnlText } from "~/components/ui/PnlText";
import { SectionCard } from "~/components/ui/SectionCard";
import { navToDisplay } from "~/domain/money";
import { pageMeta } from "~/domain/seo";
import { getAppContext } from "~/services/context";
import { searchFunds } from "~/services/fund-data";
import {
  FUND_TYPE_OPTIONS,
  getFundRank,
  RANK_PERIOD_OPTIONS,

} from "~/services/rank-service";
import { COLOR } from "~/theme";

const { Title, Paragraph } = Typography;

export function meta(_: Route.MetaArgs) {
  return pageMeta({
    title: "发现基金",
    description: "搜索真实基金、看排行榜挑热门，用模拟盘练申购与定投",
    path: "/funds",
  });
}

/** 合法类型/周期，非法值回退默认 */
function parseType(v: string | null): FundType {
  return (["gp", "hh", "zs", "zq"] as const).includes(v as FundType) ? (v as FundType) : "hh";
}
function parsePeriod(v: string | null): RankPeriod {
  return (["1m", "3m", "1y"] as const).includes(v as RankPeriod) ? (v as RankPeriod) : "1m";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = getAppContext(context);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = parseType(url.searchParams.get("type"));
  const period = parsePeriod(url.searchParams.get("period"));

  // void db; // getFundRank 本地降级会用到 db —— 不再 void
  const [results, rank] = await Promise.all([
    q ? searchFunds(env, q) : Promise.resolve([] as FundSearchItem[]),
    getFundRank(db, env, type, period),
  ]);

  return { q, results, rank, type, period };
}

export default function FundsIndex({ loaderData }: Route.ComponentProps) {
  const { q, results, rank, type, period } = loaderData;
  const nav = useNavigation();
  const searching = nav.state === "loading";
  const [, setSearchParams] = useSearchParams();

  /** 切类型/周期：保留 q，写 URL 让 loader 重跑 */
  const onTabChange = (key: string, field: "type" | "period") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(field, key);
      return next;
    });
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 页标题出卡（liquid-glass spec §5.4）：标题直接压在色雾上 */}
      <div>
        <Title level={3} className="mb-1">发现基金</Title>
        <Paragraph type="secondary" className="mb-0">
          搜代码或名称，或看排行榜挑热门。数据来自东方财富公开接口。
        </Paragraph>
      </div>

      {/* 搜索：一张玻璃卡，输入框填充由 token 的 colorBgContainer = well 自带（计划偏差 7：
          井直接压在雾上看不见，所以外壳是玻璃） */}
      <SectionCard className="animate-fade-up">
        <RouterForm method="get">
          {/* 搜索提交时保留当前 type/period，避免切回默认 */}
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="period" value={period} />
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
      </SectionCard>

      {/* 类型 / 周期 Segmented 出卡：单份渲染（不再桌面/窄屏双渲染），
          Segmented 自带 trackBg = well 压在雾上可读；窄屏靠 fp-h-scroll 横滑 */}
      <div className="fp-h-scroll flex flex-wrap gap-4">
        <Segmented
          value={type}
          onChange={v => onTabChange(String(v), "type")}
          options={FUND_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
        />
        <Segmented
          value={period}
          onChange={v => onTabChange(String(v), "period")}
          options={RANK_PERIOD_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
        />
      </div>

      {/* 交错进场：第 N 卡延迟 (N-1)×60ms（animate-delay 写法的坑见 uno.config.ts）。
          搜索结果卡仅在 q 非空时渲染，缺失时后面排行卡的延迟出现空档，观感无碍 */}
      {q
        ? (
            <SectionCard title={`「${q}」的搜索结果（${results.length} 条）`} className="animate-fade-up animate-delay-[60ms]">
              {results.length === 0
                ? <EmptyState description="没搜到，换个关键词试试" />
                : (
                    results.map((r, i) => (
                      <FundListItem
                        key={r.code}
                        fundCode={r.code}
                        fundName={r.name}
                        fundType={r.type || undefined}
                        last={i === results.length - 1}
                        actions={(
                          <NavButton size="small" type="link" to={`/funds/${r.code}`}>
                            查看详情
                          </NavButton>
                        )}
                      />
                    ))
                  )}
            </SectionCard>
          )
        : null}

      <SectionCard
        title="基金排行榜"
        className="animate-fade-up animate-delay-[120ms]"
      >
        {rank.length === 0
          ? <EmptyState description="暂无排行数据，接口可能不可用" />
          : (
              <div>
                {rank.map((r, i) => (
                  <FundListItem
                    key={r.code}
                    fundCode={r.code}
                    fundName={r.name}
                    last={i === rank.length - 1}
                    primary={(
                      <span style={{ color: COLOR.textPrimary }}>
                        {r.unitNav > 0 ? navToDisplay(r.unitNav) : "—"}
                        <span style={{ fontSize: 11, color: COLOR.textSecondary, marginLeft: 6 }}>
                          {r.navDate}
                        </span>
                      </span>
                    )}
                    secondary={(
                      <span style={{ fontSize: 12 }}>
                        日涨跌
                        {" "}
                        <PnlText rate={r.growthRate / 10000} size={12} />
                        {r.periodRate !== null && (
                          <>
                            {" · 区间 "}
                            <PnlText rate={r.periodRate / 10000} size={12} />
                          </>
                        )}
                      </span>
                    )}
                    actions={(
                      <NavButton size="small" type="link" to={`/funds/${r.code}`}>
                        查看详情
                      </NavButton>
                    )}
                  />
                ))}
              </div>
            )}
      </SectionCard>
    </Space>
  );
}
