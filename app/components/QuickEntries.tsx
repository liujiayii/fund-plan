import {
  FieldTimeOutlined,
  LineChartOutlined,
  ProfileOutlined,
} from "@ant-design/icons";
import { Col, Row } from "antd";
import { Link } from "react-router";
import { COLOR } from "~/theme";

/** 腰部功能入口。不加徽标数字——入口的职责就只是入口（KISS） */
const ENTRIES = [
  { to: "/me/profit", label: "收益明细", icon: <LineChartOutlined /> },
  { to: "/me/orders", label: "交易记录", icon: <ProfileOutlined /> },
  { to: "/me/dca", label: "定投计划", icon: <FieldTimeOutlined /> },
] as const;

/**
 * 「我的」页腰部三入口。整块可点（支付宝「我的」同款观感），
 * 图标走主色蓝——这是导航不是收益，不用涨红（与签到按钮同一条色彩纪律）。
 */
export function QuickEntries() {
  return (
    <Row gutter={[16, 16]}>
      {ENTRIES.map(e => (
        <Col xs={8} key={e.to}>
          <Link
            to={e.to}
            style={{
              display: "block",
              textAlign: "center",
              padding: "16px 0",
              color: COLOR.textPrimary,
            }}
          >
            <div style={{ fontSize: 22, color: COLOR.primary }}>{e.icon}</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{e.label}</div>
          </Link>
        </Col>
      ))}
    </Row>
  );
}
