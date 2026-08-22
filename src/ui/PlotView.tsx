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
    const targetXTicks = width < 420 ? 5 : width < 760 ? 8 : 12;
    const targetYTicks = height < 280 ? 5 : height < 520 ? 8 : 12;
    const xInterval = Math.max(Number(heatmapMeta.xTickInterval ?? 1), Math.ceil(xLabels.length / Math.max(1, targetXTicks)));
    const yInterval = Math.max(Number(heatmapMeta.yTickInterval ?? 1), Math.ceil(yLabels.length / Math.max(1, targetYTicks)));
    xAxisLabelPatch.formatter = heatmapFormatter(xLabels, xInterval);
    yAxisLabelPatch.formatter = heatmapFormatter(yLabels, yInterval);
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
        width: "92%",
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
    if (Array.isArray(option.series)) {
      next.series = option.series.map((series) => {
        if (!series || typeof series !== "object") return series;
        const item = series as Record<string, unknown>;
        const points = Array.isArray(item.data) ? item.data.length : 0;
        return points >= 8_000
          ? { ...item, progressive: 4_000, progressiveThreshold: 8_000, animation: false }
          : item;
      });
    }
    if (visualMapPresent) {
      next.visualMap = {
        ...asRecord(option.visualMap),
        show: true,
        right: dense ? 4 : 10,
        top: "middle",
        itemWidth: dense ? 8 : 10,
        itemHeight: dense ? 104 : 152,
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

function optionSeries(chart: PlotChart): Array<Record<string, unknown>> {
  const series = asRecord(chart.option).series;
  return Array.isArray(series)
    ? series.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function plotPointCount(chart: PlotChart): number {
  return optionSeries(chart).reduce((total, series) => total + (Array.isArray(series.data) ? series.data.length : 0), 0);
}

function preferredDevicePixelRatio(chart: PlotChart): number {
  const native = Math.max(1, window.devicePixelRatio || 1);
  const points = plotPointCount(chart);
  if (chart.type === "heatmap" && points >= 12_000) return Math.min(1.5, native);
  if (chart.type === "heatmap" && points >= 4_000) return Math.min(1.75, native);
  return Math.min(2, native);
}

function responsiveLayoutSignature(chart: PlotChart, width: number, height: number): string {
  const compact = width > 0 && height > 0 && (width < 180 || height < 88);
  const widthTier = width < 420 ? "narrow" : width < 760 ? "medium" : "wide";
  const densityTier = width < 560 || height < 360 ? "dense" : "roomy";
  const heightTier = height < 280 ? "short" : height < 520 ? "medium" : "tall";
  return `${chart.type}:${compact ? "compact" : "full"}:${widthTier}:${densityTier}:${heightTier}`;
}

export function PlotView({ chart, className, style }: { chart: PlotChart; className?: string; style?: CSSProperties }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const chartRef = useRef(chart);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const layoutSignatureRef = useRef("");
  const rendererDprRef = useRef(0);
  chartRef.current = chart;

  const createInstance = () => {
    const container = containerRef.current;
    if (!container) return null;
    const dpr = preferredDevicePixelRatio(chartRef.current);
    rendererDprRef.current = dpr;
    const instance = echarts.init(container, undefined, { renderer: "canvas", devicePixelRatio: dpr });
    instanceRef.current = instance;
    layoutSignatureRef.current = "";
    return instance;
  };

  const render = (forceOption = false) => {
    const container = containerRef.current;
    let instance = instanceRef.current;
    if (!container) return;
    const desiredDpr = preferredDevicePixelRatio(chartRef.current);
    if (instance && Math.abs(desiredDpr - rendererDprRef.current) > 0.01) {
      instance.dispose();
      instanceRef.current = null;
      instance = createInstance();
      forceOption = true;
    }
    if (!instance) instance = createInstance();
    if (!instance) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const signature = responsiveLayoutSignature(chartRef.current, width, height);

    // Ordinary panel resizing is cheap: resize the existing canvas only.  Rebuild the
    // responsive option only when the chart changes or crosses a layout breakpoint.
    instance.resize({ width, height, animation: { duration: 0 } });
    if (forceOption || signature !== layoutSignatureRef.current) {
      layoutSignatureRef.current = signature;
      instance.setOption(prepareOption(chartRef.current, width, height) as never, { notMerge: true, lazyUpdate: true, silent: true });
    }
  };

  const scheduleResize = () => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      render(false);
    });
    // Android WebView can report the new viewport one beat after orientationchange.
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      render(false);
    }, 120);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    createInstance();
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", scheduleResize, { passive: true });
    window.addEventListener("orientationchange", scheduleResize, { passive: true });
    // The chart-dependent effect below performs the single initial setOption call.
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("orientationchange", scheduleResize);
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => render(true), [chart]);

  return <div ref={containerRef} className={["plot-view", className].filter(Boolean).join(" ")} style={style} role="img" aria-label="交互式图表（支持缩放与悬停）" />;
}
