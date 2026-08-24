import { Card, Typography, Space, Button } from 'antd';
import type { Route } from './+types/_index';

const { Title, Paragraph } = Typography;

/** 首页元信息 */
export function meta(_: Route.MetaArgs) {
  return [
    { title: '模拟基金 · 定投系统' },
    { name: 'description', content: '用真实基金数据玩模拟盘：申购赎回、定投、签到领本金' },
  ];
}

/**
 * 占位首页。Task 24 会替换为「主人示范盘总览 + 注册引导」。
 * 现阶段只验证脚手架渲染与 antd 样式生效。
 */
export default function Index() {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Title level={2}>模拟基金 · 定投系统</Title>
        <Paragraph type="secondary">
          用真实东方财富数据玩模拟盘：真实 T+1 撮合、真实赎回费率阶梯、
          每日签到领本金。围观主人的示范盘，或注册开自己的盘。
        </Paragraph>
        <Space>
          <Button type="primary" href="/register">
            注册开盘
          </Button>
          <Button href="/master">围观主人的盘</Button>
        </Space>
      </Card>
    </Space>
  );
}
