import type { PeriodReturns } from "~/domain/performance";
import { Col, Row } from "antd";
import { COLOR, pnlColor } from "~/theme";

const CARDS: { label: string; key: keyof PeriodReturns }[] = [
  { label: "近 1 周", key: "w1" },
  { label: "近 1 月", key: "m1" },
  { label: "近 3 月", key: "m3" },
  { label: "近 6 月", key: "m6" },
  { label: "近 1 年", key: "y1" },
  { label: "今年来", key: "ytd" },
  { label: "成立来", key: "all" },
];

export interface PeriodReturnGridProps {
  returns: PeriodReturns;
}

/**
 * Renders a responsive grid of period-return cards.
 *
 * @param returns - Period return values for each displayed interval
 * @returns The rendered period-return card grid
 */
export function PeriodReturnGrid({ returns }: PeriodReturnGridProps) {
  return (
    <Row gutter={[12, 12]}>
      {CARDS.map((c) => {
        const v = returns[c.key];
        return (
          <Col xs={8} md={6} key={c.key}>
            <div
              style={{
                background: COLOR.bg,
                borderRadius: 8,
                padding: "12px 8px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 12, color: COLOR.textSecondary }}>{c.label}</div>
              <div
                className="font-num"
                style={{
                  fontSize: 18,
                  marginTop: 4,
                  color: v === null ? COLOR.textSecondary : pnlColor(v),
                }}
              >
                {v === null ? "—" : `${v > 0 ? "+" : ""}${((v / 10000) * 100).toFixed(2)}%`}
              </div>
            </div>
          </Col>
        );
      })}
    </Row>
  );
}
