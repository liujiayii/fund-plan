import { useMemo } from "react";
import { useAppTheme } from "~/components/ThemeProvider";
import { createAreaFill, createChartTheme } from "~/components/ui/chart-theme";

/** G2 的 React 封装会按 config 更新画布；只替换配色，不重挂区间与口径状态。 */
export function useChartTheme() {
  const { colors } = useAppTheme();
  return useMemo(() => ({
    colors,
    chartTheme: createChartTheme(colors),
    areaFill: createAreaFill(colors),
  }), [colors]);
}
