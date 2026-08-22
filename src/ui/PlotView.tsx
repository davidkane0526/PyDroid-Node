import { useEffect, useRef, type CSSProperties } from "react";
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
type HeatmapMeta = {
  xLabels?: string[];
  yLabels?: string[];
  xTickInterval?: number;
  yTickInterval?: number;
};
type ChartOption = Record<string, unknown> & {
  __pydroidScientificNotation?: boolean;
  __pydroidHeatmapMeta?: HeatmapMeta;
};

const UI_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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

function asRecord(value: unknown): AxisOption {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AxisOption : {};
}

function mapAxis(
  axis: unknown,
  compact: boolean,
  scientific: boolean,
  axisLabelPatch: AxisOption,
  fontSize: number,
): unknown {
  if (Array.isArray(axis)) return axis.map((item) => mapAxis(item, compact, scientific, axisLabelPatch, fontSize));
  if (!axis || typeof axis !== "object") return axis;
  const current = axis as AxisOption;
  const type = String(current.type ?? "value");
  const currentLabel = asRecord(current.axisLabel);
  if (compact) {
    return {
      ...current,
      name: "",
      axisLabel: { ...currentLabel, show: false },
      axisTick: { ...asRecord(current.axisTick), show: false },
      splitLine: { ...asRecord(current.splitLine), show: false },
      axisLine: { ...asRecord(current.axisLine), show: false },
    };
  }
  const label: AxisOption = {
    ...currentLabel,
    color: currentLabel.color ?? "#475569",
    fontFamily: UI_FONT,
    fontSize,
    hideOverlap: true,
    ...axisLabelPatch,
  };
  if (scientific && (type === "value" || type === "log")) label.formatter = scientificLabel;
  return {
    ...current,
    nameTextStyle: { fontFamily: UI_FONT, fontSize: Math.max(10, fontSize), ...asRecord(current.nameTextStyle) },
    axisLabel: label,
  };
}

function hasText(value: unknown): boolean {
  return Boolean(String(asRecord(value).text ?? "").trim());
}

function heatmapFormatter(labels: string[], interval: number) {
  const safeInterval = Math.max(1, Math.trunc(interval || 1));
  return (_label: string, index: number) => index % safeInterval === 0 ? labels[index] ?? "" : "";
}

function prepareOption(chart: PlotChart, width: number, height: number): Record<string, unknown> {
  const source = chart.option as ChartOption;
  const scientific = source.__pydroidScientificNotation !== false;
  const heatmapMeta = source.__pydroidHeatmapMeta;
  const { __pydroidScientificNotation: _scientificMarker, __pydroidHeatmapMeta: _heatmapMarker, ...option } = source;
  const compact = width > 0 && height > 0 && (width < 180 || height < 88);
  const dense = width > 0 && (width < 560 || height < 360);
  const fontSize = compact ? 8 : width < 420 ? 9 : width < 760 ? 10 : 11;
  const titlePresent = hasText(option.title);
  const legendPresent = Boolean(option.legend);
  const visualMapPresent = Boolean(option.visualMap);
  const xAxisLabelPatch: AxisOption = compact ? {} : { interval: "auto", margin: dense ? 6 : 8 };
  const yAxisLabelPatch: AxisOption = compact ? {} : { interval: "auto", margin: dense ? 6 : 8 };

  if (chart.type === "heatmap" && heatmapMeta) {
    const xLabels = heatmapMeta.xLabels ?? [];
    const yLabels = heatmapMeta.yLabels ?? [];
    xAxisLabelPatch.formatter = heatmapFormatter(xLabels, Number(heatmapMeta.xTickInterval ?? 1));
    yAxisLabelPatch.formatter = heatmapFormatter(yLabels, Number(heatmapMeta.yTickInterval ?? 1));
    xAxisLabelPatch.overflow = "truncate";
    xAxisLabelPatch.ellipsis = "…";
    yAxisLabelPatch.overflow = "truncate";
    yAxisLabelPatch.ellipsis = "…";
  }

  const next: Record<string, unknown> = {
    ...option,
    animation: false,
    backgroundColor: "#ffffff",
    textStyle: { fontFamily: UI_FONT, fontSize },
    xAxis: mapAxis(option.xAxis, compact, scientific, xAxisLabelPatch, fontSize),
    yAxis: mapAxis(option.yAxis, compact, scientific, yAxisLabelPatch, fontSize),
  };

  if (compact) {
    next.title = undefined;
    next.legend = undefined;
    next.tooltip = { show: false };
    // A hidden visualMap still performs heatmap color mapping. Removing it made node thumbnails a flat blue block.
    next.visualMap = chart.type === "heatmap" && option.visualMap
      ? { ...asRecord(option.visualMap), show: false, calculable: false }
      : undefined;
    next.dataZoom = undefined;
    next.grid = { left: 2, right: 2, top: 2, bottom: 2, containLabel: false };
    if (Array.isArray(option.series)) {
      next.series = option.series.map((series) => {
        if (!series || typeof series !== "object") return series;
        const item = series as Record<string, unknown>;
        return { ...item, showSymbol: false, symbolSize: 2 };
      });
    }
    return next;
  }

  if (titlePresent) {
    next.title = {
      ...asRecord(option.title),
      top: 4,
      left: "center",
      textStyle: {
        fontFamily: UI_FONT,
        fontSize: width < 420 ? 12 : width < 760 ? 14 : 16,
        fontWeight: 650,
        overflow: "truncate",
        width: Math.max(120, width - 36),
        ...asRecord(asRecord(option.title).textStyle),
      },
    };
  }

  if (legendPresent) {
    next.legend = {
      ...asRecord(option.legend),
      top: titlePresent ? 30 : 6,
      left: "center",
      width: Math.max(100, width - 72),
      textStyle: { fontFamily: UI_FONT, fontSize, ...asRecord(asRecord(option.legend).textStyle) },
      pageTextStyle: { fontFamily: UI_FONT, fontSize: Math.max(9, fontSize - 1), ...asRecord(asRecord(option.legend).pageTextStyle) },
    };
  }

  if (chart.type === "heatmap") {
    if (visualMapPresent) {
      next.visualMap = {
        ...asRecord(option.visualMap),
        show: true,
        right: dense ? 4 : 10,
        top: "middle",
        itemWidth: dense ? 8 : 10,
        itemHeight: Math.max(72, Math.min(dense ? 116 : 168, height - (titlePresent ? 96 : 72))),
        textStyle: { fontFamily: UI_FONT, fontSize: Math.max(9, fontSize - 1), ...asRecord(asRecord(option.visualMap).textStyle) },
      };
    }
    next.grid = {
      ...asRecord(option.grid),
      left: dense ? 16 : 22,
      right: visualMapPresent ? (dense ? 72 : 96) : 18,
      top: titlePresent ? 46 : 18,
      bottom: dense ? 20 : 24,
      containLabel: true,
    };
    if (heatmapMeta) {
      next.tooltip = {
        ...asRecord(option.tooltip),
        trigger: "item",
        confine: true,
        appendToBody: false,
        textStyle: { fontFamily: UI_FONT, fontSize: Math.max(10, fontSize) },
        formatter: (item: { value?: unknown }) => {
          const value = Array.isArray(item?.value) ? item.value : [];
          const c = Number(value[0]);
          const r = Number(value[1]);
          const z = value[2];
          const x = heatmapMeta.xLabels?.[c] ?? c;
          const y = heatmapMeta.yLabels?.[r] ?? r;
          const number = typeof z === "number" ? z : Number(z);
          const formatted = Number.isFinite(number) ? String(Number(number.toPrecision(7))) : "NaN";
          return `${String(y)} · ${String(x)}<br/><b>${formatted}</b>`;
        },
      };
    }
  } else {
    next.grid = {
      ...asRecord(option.grid),
      left: dense ? 16 : 24,
      right: dense ? 14 : 22,
      top: titlePresent && legendPresent ? 62 : titlePresent ? 46 : legendPresent ? 36 : 18,
      bottom: dense ? 18 : 24,
      containLabel: true,
    };
    if (option.tooltip) next.tooltip = { ...asRecord(option.tooltip), confine: true, appendToBody: false };
  }

  return next;
}

export function PlotView({ chart, className, style }: { chart: PlotChart; className?: string; style?: CSSProperties }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const chartRef = useRef(chart);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  chartRef.current = chart;

  const render = () => {
    const container = containerRef.current;
    const instance = instanceRef.current;
    if (!container || !instance) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    instance.setOption(prepareOption(chartRef.current, width, height) as never, true);
    instance.resize({ width, height });
  };

  const scheduleResize = () => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        render();
      });
    });
    // Android WebView can report the new viewport one beat after orientationchange.
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      render();
    }, 120);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = echarts.init(containerRef.current, undefined, {
      renderer: "canvas",
      devicePixelRatio: Math.min(3, Math.max(1, window.devicePixelRatio || 1)),
    });
    instanceRef.current = instance;
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", scheduleResize, { passive: true });
    window.addEventListener("orientationchange", scheduleResize, { passive: true });
    render();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("orientationchange", scheduleResize);
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(render, [chart]);

  return <div ref={containerRef} className={["plot-view", className].filter(Boolean).join(" ")} style={style} role="img" aria-label="交互式图表（支持缩放与悬停）" />;
}
