/**
 * `AdminNotReady` 与只读持仓列表的归属地；旧 PortfolioSummary 已随 admin
 * 页改版退役（ux-polish）。
 */
import type { HoldingView } from "~/services/portfolio-service";
import { Tag, Typography } from "antd";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionCard } from "~/components/ui/SectionCard";
import { HoldingList, sharesAndNavNote } from "./HoldingList";

const { Paragraph } = Typography;

/** 持仓列表（只读版，公开页用） */
export function HoldingListReadonly({ holdings }: { holdings: HoldingView[] }) {
  if (holdings.length === 0) {
    return <EmptyState description="暂无持仓" />;
  }
  // 份额与估值时点必须露出，理由与条件渲染的取舍都在 sharesAndNavNote 里
  return <HoldingList holdings={holdings} renderNote={sharesAndNavNote} />;
}

/** 主理人还没注册时的引导提示 */
export function AdminNotReady({ adminName }: { adminName: string }) {
  return (
    <SectionCard>
      <EmptyState
        description={(
          <div>
            <Paragraph>
              管理员账号
              {" "}
              <Tag>{adminName}</Tag>
              {" "}
              还没注册，公开示范盘暂时为空。
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              用该用户名注册即成为主理人，其组合会自动对所有访客公开。
            </Paragraph>
          </div>
        )}
      />
    </SectionCard>
  );
}
