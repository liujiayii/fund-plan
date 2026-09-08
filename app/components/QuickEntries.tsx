import type { ReactNode } from "react";
import {
  FieldTimeOutlined,
  LineChartOutlined,
  ProfileOutlined,
} from "@ant-design/icons";
import { Col, Row } from "antd";
import { Link } from "react-router";
import { COLOR } from "~/theme";

/** 一个功能入口的定义：目标、标签、副标题小字、图标 */
export interface QuickEntryItem {
  to: string;
  label: string;
  /** 副标题小字（灰色 11px），交代入口里能看到什么 */
  sub: string;
  icon: ReactNode;
}

/** /me 腰部三入口（全局口径，不带 ?fund= 过滤） */
export const ME_QUICK_ENTRIES: QuickEntryItem[] = [
  { to: "/me/profit", label: "收益明细", sub: "每日收益一览", icon: <LineChartOutlined /> },
  { to: "/me/orders", label: "交易记录", sub: "申购赎回全记录", icon: <ProfileOutlined /> },
  { to: "/me/dca", label: "定投计划", sub: "自动下单管理", icon: <FieldTimeOutlined /> },
];

/**
 * 腰部功能入口（圆底图标 + 副标题）。整块可点（支付宝「我的」同款观感）。
 * 图标走主色蓝——这是导航不是收益，不用涨红（与签到按钮同一条色彩纪律）。
 *
 * entries 由调用方传入：/me 用 ME_QUICK_ENTRIES 全局三入口；
 * 持仓详情页传带 ?fund= 过滤的版本（交易记录/定投只看这只基金）。
 * 原 me.holdings_.$code 里的私有复制版 HoldingQuickEntries 已并入本组件。
 */
export function QuickEntries({ entries }: { entries: QuickEntryItem[] }) {
  return (
    <Row gutter={[16, 16]}>
      {entries.map(e => (
        <Col xs={8} key={e.to}>
          <Link
            to={e.to}
            style={{ display: "block", textAlign: "center", padding: "8px 0", color: COLOR.textPrimary }}
          >
            {/* 浅蓝圆底 + 主色图标：给图标一个「容器」，比裸图标更有分量 */}
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: COLOR.primaryBg,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: COLOR.primary,
              }}
            >
              {e.icon}
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{e.label}</div>
            <div style={{ fontSize: 11, color: COLOR.textSecondary, marginTop: 2 }}>{e.sub}</div>
          </Link>
        </Col>
      ))}
    </Row>
  );
}
