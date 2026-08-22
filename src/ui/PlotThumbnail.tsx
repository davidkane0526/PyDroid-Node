import { useEffect, useRef, type CSSProperties } from "react";
import type { PlotChart } from "../runtime";

type RecordValue = Record<string, unknown>;
type RGB = [number, number, number];

const FALLBACK_COLORS = ["#2563eb", "#14b8a6", "#8b5cf6"];

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hexRgb(color: string): RGB | null {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function interpolateColor(colors: string[], ratio: number): string {
  if (!colors.length) return "#2563eb";
  if (colors.length === 1) return colors[0];
  const position = Math.min(1, Math.max(0, ratio)) * (colors.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(colors.length - 1, leftIndex + 1);
  const left = hexRgb(colors[leftIndex]);
  const right = hexRgb(colors[rightIndex]);
  if (!left || !right) return colors[leftIndex];
  const t = position - leftIndex;
  const channel = (index: number) => Math.round(left[index] + (right[index] - left[index]) * t);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

function seriesList(chart: PlotChart): RecordValue[] {
  const series = asRecord(chart.option).series;
  if (!Array.isArray(series)) return [];
  return series.filter((item): item is RecordValue => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function drawHeatmap(ctx: CanvasRenderingContext2D, chart: PlotChart, width: number, height: number) {
  const option = asRecord(chart.option);
  const series = seriesList(chart)[0] ?? {};
  const data = Array.isArray(series.data) ? series.data : [];
  const xData = asRecord(option.xAxis).data;
  const yData = asRecord(option.yAxis).data;
  const xCount = Array.isArray(xData) ? Math.max(1, xData.length) : Math.max(1, Math.floor(Math.sqrt(data.length)));
  const yCount = Array.isArray(yData) ? Math.max(1, yData.length) : Math.max(1, Math.ceil(data.length / xCount));
  const visualMap = asRecord(option.visualMap);
  let min = finite(visualMap.min) ?? Number.POSITIVE_INFINITY;
  let max = finite(visualMap.max) ?? Number.NEGATIVE_INFINITY;
  const colorsRaw = asRecord(visualMap.inRange).color;
  const colors = Array.isArray(colorsRaw) ? colorsRaw.map(String) : ["#440154", "#31688e", "#1f9e89", "#6ece58", "#fde725"];

  const columns = Math.max(1, Math.min(xCount, 96));
  const rows = Math.max(1, Math.min(yCount, 48));
  const sums = new Float64Array(columns * rows);
  const counts = new Uint32Array(columns * rows);

  // Thumbnails are visual hints, not analytical surfaces. Bound source work so a very
  // large matrix never makes every visible workflow node walk the entire heatmap payload.
  const sourceStride = Math.max(1, Math.ceil(data.length / 24_000));
  for (let dataIndex = 0; dataIndex < data.length; dataIndex += sourceStride) {
    const item = data[dataIndex];
    if (!Array.isArray(item) || item.length < 3) continue;
    const x = finite(item[0]);
    const y = finite(item[1]);
    const value = finite(item[2]);
    if (x === null || y === null || value === null) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
    const bx = Math.min(columns - 1, Math.max(0, Math.floor((x / Math.max(1, xCount)) * columns)));
    const sourceRow = Math.min(rows - 1, Math.max(0, Math.floor((y / Math.max(1, yCount)) * rows)));
    // ECharts category Y index 0 is visually at the bottom; Canvas row 0 is at the top.
    const by = rows - 1 - sourceRow;
    const index = by * columns + bx;
    sums[index] += value;
    counts[index] += 1;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = Number.isFinite(min) ? min - 1 : 0;
    max = Number.isFinite(max) ? max + 1 : 1;
  }

  const cellWidth = width / columns;
  const cellHeight = height / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (!counts[index]) continue;
      const value = sums[index] / counts[index];
      ctx.fillStyle = interpolateColor(colors, (value - min) / (max - min));
      ctx.fillRect(column * cellWidth, row * cellHeight, Math.ceil(cellWidth + 0.5), Math.ceil(cellHeight + 0.5));
    }
  }
}

function sampleSeriesData(data: unknown, maxPoints: number): number[] {
  if (!Array.isArray(data) || !data.length) return [];
  const stride = Math.max(1, Math.ceil(data.length / Math.max(1, maxPoints)));
  const values: number[] = [];
  for (let index = 0; index < data.length; index += stride) {
    const item = data[index];
    const raw = Array.isArray(item) ? item[item.length - 1] : asRecord(item).value ?? item;
    const value = finite(raw);
    if (value !== null) values.push(value);
  }
  if ((data.length - 1) % stride !== 0) {
    const last = data[data.length - 1];
    const raw = Array.isArray(last) ? last[last.length - 1] : asRecord(last).value ?? last;
    const value = finite(raw);
    if (value !== null) values.push(value);
  }
  return values;
}

function drawCartesian(ctx: CanvasRenderingContext2D, chart: PlotChart, width: number, height: number) {
  const series = seriesList(chart).slice(0, 3);
  const maxPoints = chart.type === "scatter" ? 72 : chart.type === "bar" || chart.type === "histogram" ? 48 : 96;
  const sampledSeries = series.map((item) => sampleSeriesData(item.data, maxPoints));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const values of sampledSeries) {
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  if (min === max) { min -= 1; max += 1; }
  const yFor = (value: number) => height - 3 - ((value - min) / (max - min)) * Math.max(1, height - 6);

  series.forEach((item, seriesIndex) => {
    const sampled = sampledSeries[seriesIndex];
    if (!sampled.length) return;
    const style = asRecord(item.lineStyle);
    ctx.strokeStyle = String(style.color ?? FALLBACK_COLORS[seriesIndex % FALLBACK_COLORS.length]);
    ctx.fillStyle = String(asRecord(item.itemStyle).color ?? ctx.strokeStyle);
    ctx.lineWidth = 1.25;

    if (chart.type === "bar" || chart.type === "histogram") {
      const barWidth = Math.max(1, width / sampled.length - 1);
      sampled.forEach((value, index) => {
        const x = (index / Math.max(1, sampled.length)) * width;
        const y = yFor(value);
        ctx.fillRect(x, y, barWidth, Math.max(1, height - y));
      });
      return;
    }

    if (chart.type === "scatter") {
      sampled.forEach((value, index) => {
        const x = 2 + (index / Math.max(1, sampled.length - 1)) * Math.max(1, width - 4);
        const y = yFor(value);
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    ctx.beginPath();
    sampled.forEach((value, index) => {
      const x = 2 + (index / Math.max(1, sampled.length - 1)) * Math.max(1, width - 4);
      const y = yFor(value);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function drawThumbnail(canvas: HTMLCanvasElement, chart: PlotChart) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (chart.type === "heatmap") drawHeatmap(ctx, chart, width, height);
  else drawCartesian(ctx, chart, width, height);
}

export function PlotThumbnail({ chart, className, style }: { chart: PlotChart; className?: string; style?: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef(chart);
  const frameRef = useRef<number | null>(null);
  chartRef.current = chart;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawThumbnail(canvas, chartRef.current);
    const schedule = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        render();
      });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(canvas);
    render();
    return () => {
      observer?.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    if (canvasRef.current) drawThumbnail(canvasRef.current, chart);
  }, [chart]);

  return <canvas ref={canvasRef} className={["plot-thumbnail", className].filter(Boolean).join(" ")} style={style} role="img" aria-label="图表缩略图" />;
}
