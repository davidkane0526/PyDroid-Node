import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, BoxplotChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { PlotChart } from "../runtime";

echarts.use([
  LineChart,
  HeatmapChart,
  ScatterChart,
  BarChart,
  BoxplotChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  TitleComponent,
  DataZoomComponent,
  GraphicComponent,
  CanvasRenderer,
]);

type AxisOption = Record<string, unknown>;
type ChartOption = Record<string, unknown> & { __pydroidScientificNotation?: boolean };

function scientificLabel(value: unknown): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (number === 0) return "0";
  const absolute = Math.abs(number);
  if (absolute >= 1e4 || absolute < 1e-3) {
    return number.toExponential(2).replace("e+", "e").replace(/e(-?)0+(\d+)/, "e$1$2");
  }
  return String(Number(number.toPrecision(6)));
}

function mapAxis(axis: unknown, compact: boolean, scientific: boolean): unknown {
  if (Array.isArray(axis)) return axis.map((item) => mapAxis(item, compact, scientific));
  if (!axis || typeof axis !== "object") return axis;
  const current = axis as AxisOption;
  const type = String(current.type ?? "value");
  if (compact) {
    return {
      ...current,
      name: "",
      axisLabel: { ...(current.axisLabel as AxisOption | undefined), show: false },
      axisTick: { ...(current.axisTick as AxisOption | undefined), show: false },
      splitLine: { ...(current.splitLine as AxisOption | undefined), show: false },
      axisLine: { ...(current.axisLine as AxisOption | undefined), show: false },
    };
  }
  if (scientific && (type === "value" || type === "log")) {
    return {
      ...current,
      axisLabel: { ...(current.axisLabel as AxisOption | undefined), formatter: scientificLabel },
    };
  }
  return current;
}

function prepareOption(chart: PlotChart, compact: boolean): Record<string, unknown> {
  const source = chart.option as ChartOption;
  const scientific = source.__pydroidScientificNotation !== false;
  const { __pydroidScientificNotation: _marker, ...option } = source;
  const next: Record<string, unknown> = {
    ...option,
    backgroundColor: "#ffffff",
    xAxis: mapAxis(option.xAxis, compact, scientific),
    yAxis: mapAxis(option.yAxis, compact, scientific),
  };

  if (compact) {
    next.animation = false;
    next.title = undefined;
    next.legend = undefined;
    next.tooltip = { show: false };
    next.visualMap = undefined;
    next.dataZoom = undefined;
    next.grid = { left: 3, right: 3, top: 3, bottom: 3, containLabel: false };
    if (Array.isArray(option.series)) {
      next.series = option.series.map((series) => {
        if (!series || typeof series !== "object") return series;
        const item = series as Record<string, unknown>;
        return { ...item, showSymbol: false, symbolSize: 2 };
      });
    }
  }
  return next;
}

export function PlotView({ chart, className }: { chart: PlotChart; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const chartRef = useRef(chart);
  chartRef.current = chart;

  const render = () => {
    const container = containerRef.current;
    const instance = instanceRef.current;
    if (!container || !instance) return;
    const compact = container.clientWidth > 0 && container.clientWidth < 180;
    instance.setOption(prepareOption(chartRef.current, compact) as never, true);
    instance.resize();
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = echarts.init(containerRef.current);
    instanceRef.current = instance;
    const observer = new ResizeObserver(render);
    observer.observe(containerRef.current);
    render();
    return () => {
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(render, [chart]);

  return <div ref={containerRef} className={["plot-view", className].filter(Boolean).join(" ")} role="img" aria-label="交互式图表（支持缩放与悬停）" />;
}
