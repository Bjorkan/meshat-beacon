// Tree-shaken ECharts registration. Import `echarts` from here (never the `echarts` barrel) so the
// bundle only pulls the chart types + components the Stats page actually uses. We deliberately avoid
// the `echarts-for-react` wrapper (it was hit by a supply-chain attack 2026-05-19); EChart.tsx wraps
// the core API directly instead.
import * as echarts from 'echarts/core';
import {
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
} from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
  DataZoomComponent,
  MarkLineComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  GraphChart,
  AriaComponent,
  HeatmapChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
  DataZoomComponent,
  MarkLineComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export { echarts };
export type EChartsInstance = ReturnType<typeof echarts.init>;
export type EChartsOption = Parameters<EChartsInstance['setOption']>[0];
