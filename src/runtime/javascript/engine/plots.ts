// 图表节点 → ECharts 配置：替代原 matplotlib PNG，输出纯 JSON 可序列化的交互式图表配置。
import { Table, toNumber, isMissing } from "./table";

export type PlotChart = {
  type: "line" | "heatmap" | "scatter" | "bar" | "histogram" | "box" | "area";
  option: Record<string, unknown>;
};

function asBool(value: unknown): boolean {
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function optionalFloat(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveColumn(table: Table, raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (table.columns.includes(text)) return text;
  const index = Number(text);
  if (Number.isInteger(index) && index >= 0 && index < table.columns.length) return table.columns[index];
  throw new Error(`Unknown column: ${text}`);
}

function resolveColumns(table: Table, raw: unknown): string[] {
  if (raw === null || raw === undefined || String(raw).trim() === "") return [];
  return String(raw).split(",").map((item) => item.trim()).filter(Boolean).map((item) => resolveColumn(table, item) as string);
}

// matplotlib 常用 colormap 的采样色（ECharts visualMap 用）
const COLOR_MAPS: Record<string, string[]> = {
  viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
  inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d03c", "#fcffa4"],
  magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
  jet: ["#00007f", "#0000ff", "#007fff", "#00ffff", "#7fff7f", "#ffff00", "#ff7f00", "#ff0000", "#7f0000"],
  coolwarm: ["#3b4cc0", "#5f7bc9", "#8faadc", "#c7d7ee", "#e8e8e8", "#f2c8c8", "#e89a9a", "#d96464", "#b40426"],
  rdbu_r: ["#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f"],
  gray: ["#000000", "#1f1f1f", "#3f3f3f", "#5f5f5f", "#7f7f7f", "#9f9f9f", "#bfbfbf", "#dfdfdf", "#ffffff"],
  blues: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"],
  greens: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"],
};

function colorMapColors(name: string): string[] {
  const key = String(name || "viridis").toLowerCase();
  return COLOR_MAPS[key] ?? COLOR_MAPS.viridis;
}

function baseTitle(title: string, xLabel: string, yLabel: string): Record<string, unknown> {
  return {
    ...(title ? { title: { text: title, left: "center" } } : {}),
    ...(xLabel ? { xAxis: { name: xLabel } } : {}),
    ...(yLabel ? { yAxis: { name: yLabel } } : {}),
  };
}


function lineSeriesConfig(raw: unknown): Array<Record<string, unknown>> {
  if (raw === null || raw === undefined || String(raw).trim() === "") return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("Line plot seriesConfig must be a JSON array"); }
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    throw new Error("Line plot seriesConfig must be an array of objects");
  }
  return parsed as Array<Record<string, unknown>>;
}

const LINE_STYLES: Record<string, string> = { "-": "solid", "--": "dashed", "-.": "dotted", ":": "dotted", "": "solid" };

function axisScale(log: boolean, label: string): Record<string, unknown> {
  return {
    ...(log ? { type: "log" } : { type: "value" }),
    ...(label ? { name: label } : {}),
  };
}

export function linePlot(table: Table, params: Record<string, unknown>): PlotChart {
  const xColumn = resolveColumn(table, params.xColumn);
  const yColumns = resolveColumns(table, params.yColumns);
  const width = Number(params.figureWidth ?? 8);
  const height = Number(params.figureHeight ?? 4.5);
  const dpi = Number(params.dpi ?? 120);
  if (!(width >= 2 && width <= 30 && height >= 2 && height <= 30 && dpi >= 48 && dpi <= 600)) {
    throw new Error("Plot size or DPI is outside the supported range");
  }
  const xValues = xColumn ? table.column(xColumn).map((value) => (isMissing(value) ? null : value)) : null;
  const configured = lineSeriesConfig(params.seriesConfig);
  const effectiveSeries = configured.length
    ? configured.map((item) => {
        const rawY = item.y ?? item.column;
        if (rawY === null || rawY === undefined || String(rawY).trim() === "") throw new Error("Line plot series item requires y");
        const column = resolveColumn(table, rawY) as string;
        const lineWidth = Number(item.lineWidth ?? params.lineWidth ?? 1.5);
        if (!(lineWidth > 0 && lineWidth <= 20)) throw new Error("Line plot series lineWidth must be between 0 and 20");
        return {
          column,
          label: String(item.label ?? column),
          lineStyle: String(item.lineStyle ?? params.lineStyle ?? "-"),
          marker: String(item.marker ?? params.marker ?? ""),
          lineWidth,
        };
      })
    : yColumns.map((column) => ({
        column, label: column, lineStyle: String(params.lineStyle ?? "-"), marker: String(params.marker ?? ""), lineWidth: Number(params.lineWidth ?? 1.5),
      }));
  if (!effectiveSeries.length) throw new Error("Line plot requires at least one Y column");
  const series = effectiveSeries.map((item) => {
    const yValues = table.column(item.column);
    const data = yValues.map((value, r) => [xValues ? xValues[r] : r, isMissing(value) ? null : value]);
    return {
      name: item.label,
      type: "line",
      data,
      showSymbol: Boolean(item.marker.trim()),
      symbol: markerSymbol(item.marker) ?? "circle",
      lineStyle: { width: item.lineWidth, type: LINE_STYLES[item.lineStyle] ?? "solid" },
      connectNulls: false,
    };
  });
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: asBool(params.legend ?? true) ? { type: "scroll", top: 4 } : undefined,
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: xColumn ? { ...axisScale(asBool(params.logX ?? false), String(params.xLabel ?? "")), nameLocation: "middle" } : { type: "category", data: Array.from({ length: table.rowCount }, (_, i) => i) },
    yAxis: axisScale(asBool(params.logY ?? false), String(params.yLabel ?? "")),
    series,
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
  };
  return { type: "line", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

export function scatterPlot(table: Table, params: Record<string, unknown>): PlotChart {
  const xColumn = resolveColumn(table, params.xColumn);
  const yColumns = resolveColumns(table, params.yColumns);
  if (!xColumn || yColumns.length !== 1) throw new Error("Scatter plot requires one X column and one Y column");
  const pointSize = Number(params.pointSize ?? 24);
  const alpha = Number(params.alpha ?? 0.8);
  const data = table.rows().map((row) => {
    const x = toNumber(row[table.columnIndex(xColumn)]);
    const y = toNumber(row[table.columnIndex(yColumns[0])]);
    return [x ?? null, y ?? null];
  });
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "item" },
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: { type: "value" },
    yAxis: { type: "value" },
    series: [{ type: "scatter", data, symbolSize: Math.max(4, pointSize / 2), itemStyle: { opacity: alpha } }],
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
  };
  return { type: "scatter", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

export function barPlot(table: Table, params: Record<string, unknown>): PlotChart {
  const xColumn = resolveColumn(table, params.xColumn);
  const yColumns = resolveColumns(table, params.yColumns);
  const xValues = xColumn ? table.column(xColumn).map((value) => String(value ?? "")) : null;
  const series = (yColumns.length ? yColumns : table.columns).map((column) => ({
    name: column,
    type: "bar",
    data: table.column(column).map((value) => {
      const number = toNumber(value);
      return number === null ? null : number;
    }),
  }));
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: asBool(params.legend ?? true) ? { type: "scroll", top: 4 } : undefined,
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: xValues ? { type: "category", data: xValues, axisLabel: { rotate: 0 } } : { type: "category", data: Array.from({ length: table.rowCount }, (_, i) => i) },
    yAxis: { type: "value" },
    series,
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
  };
  return { type: "bar", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

export function histogramPlot(table: Table, params: Record<string, unknown>): PlotChart {
  const yColumns = resolveColumns(table, params.yColumns);
  const columns = yColumns.length ? yColumns : table.columns;
  const bins = Math.max(1, Number(params.bins ?? 20));
  const alpha = Number(params.alpha ?? 0.8);
  const series = columns.map((column) => {
    const values = table.column(column).map(toNumber).filter((value): value is number => value !== null && Number.isFinite(value));
    if (!values.length) throw new Error("Histogram requires numeric columns");
    const min = Math.min(...values);
    const max = Math.max(...values);
    const width = max === min ? 1 : (max - min) / bins;
    const counts = Array.from({ length: bins }, () => 0);
    for (const value of values) {
      const index = Math.min(bins - 1, Math.floor((value - min) / width));
      counts[index] += 1;
    }
    return {
      name: column,
      type: "bar",
      data: counts,
      barWidth: "99%",
      itemStyle: { opacity: alpha },
    };
  });
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: columns.length > 1 ? { type: "scroll", top: 4 } : undefined,
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: { type: "category", data: Array.from({ length: bins }, (_, i) => i) },
    yAxis: { type: "value" },
    series,
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
  };
  return { type: "histogram", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

export function boxPlot(table: Table, params: Record<string, unknown>): PlotChart {
  const yColumns = resolveColumns(table, params.yColumns);
  const columns = yColumns.length ? yColumns : table.numericColumns().map((c) => table.columns[c]);
  if (!columns.length) throw new Error("Box plot requires numeric columns");
  const data = columns.map((column) => {
    const values = table.column(column).map(toNumber).filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
    const q = (position: number): number => {
      if (!values.length) return 0;
      const index = position * (values.length - 1);
      const base = Math.floor(index);
      const rest = index - base;
      return values[base] + rest * ((values[base + 1] ?? values[base]) - values[base]);
    };
    const min = values[0] ?? 0;
    const max = values[values.length - 1] ?? 0;
    return [min, q(0.25), q(0.5), q(0.75), max];
  });
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "item" },
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: { type: "category", data: columns },
    yAxis: { type: "value" },
    series: [{ type: "boxplot", data }],
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
  };
  return { type: "box", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

export function areaPlot(table: Table, params: Record<string, unknown>): PlotChart {
  const xColumn = resolveColumn(table, params.xColumn);
  const yColumns = resolveColumns(table, params.yColumns);
  if (!yColumns.length) throw new Error("Area plot requires at least one Y column");
  const xValues = xColumn ? table.column(xColumn) : null;
  const series = yColumns.map((column) => ({
    name: column,
    type: "line",
    data: table.column(column).map((value, r) => [xValues ? xValues[r] : r, isMissing(value) ? null : value]),
    areaStyle: { opacity: Number(params.alpha ?? 0.85) * 0.35 },
    lineStyle: { width: 1.5 },
  }));
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: asBool(params.legend ?? true) ? { type: "scroll", top: 4 } : undefined,
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    xAxis: xColumn ? { type: "value" } : { type: "category", data: Array.from({ length: table.rowCount }, (_, i) => i) },
    yAxis: { type: "value" },
    series,
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
  };
  return { type: "area", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

export function heatmapPlot(table: Table, params: Record<string, unknown>): PlotChart {
  const labelRaw = String(params.rowLabelColumn ?? "").trim();
  const labelColumn = labelRaw ? resolveColumn(table, labelRaw) : null;
  const labels = labelColumn ? table.column(labelColumn).map((value) => String(value ?? "")) : Array.from({ length: table.rowCount }, (_, i) => String(i));
  const matrixColumns = labelColumn ? table.columns.filter((column) => column !== labelColumn) : table.columns;
  const matrix = new Table(matrixColumns, table.rows().map((row) => {
    const labelIndex = labelColumn ? table.columnIndex(labelColumn) : -1;
    return row.filter((_, c) => c !== labelIndex);
  }));
  if (!matrix.rowCount || !matrixColumns.length) throw new Error("Heatmap requires at least one numeric value column");
  const width = Number(params.figureWidth ?? 9);
  const height = Number(params.figureHeight ?? 6);
  const dpi = Number(params.dpi ?? 160);
  if (!(width >= 2 && width <= 30 && height >= 2 && height <= 30 && dpi >= 48 && dpi <= 600)) {
    throw new Error("Heatmap size or DPI is outside the supported range");
  }
  const xTickInterval = Math.max(1, Number(params.xTickInterval ?? 1));
  const yTickInterval = Math.max(1, Number(params.yTickInterval ?? 1));
  const xTickRotation = Number(params.xTickRotation ?? 45);
  if (!(xTickRotation >= 0 && xTickRotation <= 360)) throw new Error("Heatmap X tick rotation must be between 0 and 360 degrees");
  const origin = String(params.origin ?? "lower");
  if (!["lower", "upper"].includes(origin)) throw new Error("Heatmap origin is unsupported");
  const colorMin = optionalFloat(params.colorMin);
  const colorMax = optionalFloat(params.colorMax);
  if (colorMin !== null && colorMax !== null && colorMin >= colorMax) throw new Error("Heatmap colorMin must be smaller than colorMax");

  const numericRows = matrix.rows().map((row) => row.map((value) => {
    const number = toNumber(value);
    return number === null ? Number.NaN : number;
  }));
  let min = colorMin ?? Number.POSITIVE_INFINITY;
  let max = colorMax ?? Number.NEGATIVE_INFINITY;
  for (const row of numericRows) {
    for (const value of row) {
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error("Heatmap requires at least one numeric value");
  if (min === max) {
    max = min + 1;
    min = min - 1;
  }

  const data: Array<[number, number, number | null]> = [];
  numericRows.forEach((row, r) => {
    row.forEach((value, c) => {
      data.push([c, origin === "lower" ? numericRows.length - 1 - r : r, Number.isFinite(value) ? value : null]);
    });
  });

  const xAxisData = matrixColumns;
  const yAxisData = origin === "lower" ? [...labels].reverse() : labels;
  const showColorBar = asBool(params.showColorBar ?? true);

  // Keep the runtime payload JSON-only.  Axis/tooltip formatter functions are injected by PlotView
  // after transport so JS-runtime charts survive JSON serialization without silently losing behavior.
  const option: Record<string, unknown> = {
    animation: false,
    tooltip: { trigger: "item", confine: true },
    grid: { left: 72, right: showColorBar ? 96 : 24, top: 44, bottom: 60, containLabel: true },
    xAxis: {
      type: "category", data: xAxisData, name: String(params.xLabel ?? ""), nameLocation: "middle", nameGap: 38,
      axisLabel: { rotate: xTickRotation, interval: "auto", hideOverlap: true }, splitArea: { show: true },
    },
    yAxis: {
      type: "category", data: yAxisData, name: String(params.yLabel ?? ""), nameLocation: "middle", nameGap: 46,
      axisLabel: { interval: "auto", hideOverlap: true }, splitArea: { show: true },
    },
    visualMap: showColorBar ? {
      min,
      max,
      calculable: true,
      orient: "vertical",
      right: 8,
      top: "middle",
      inRange: { color: colorMapColors(String(params.colorMap ?? "viridis")) },
      ...(String(params.colorBarLabel ?? "").trim() ? { text: [String(params.colorBarLabel).trim(), ""] } : {}),
    } : undefined,
    series: [{ type: "heatmap", data, emphasis: { itemStyle: { borderColor: "#333", borderWidth: 1 } } }],
    ...(String(params.title ?? "").trim() ? { title: { text: String(params.title).trim(), left: "center" } } : {}),
    __pydroidHeatmapMeta: {
      xLabels: xAxisData, yLabels: yAxisData, xTickInterval, yTickInterval,
    },
  };
  return { type: "heatmap", option: { ...option, __pydroidScientificNotation: asBool(params.scientificNotation ?? true) } };
}

function markerSymbol(marker: string): string | null {
  const symbols: Record<string, string> = {
    ".": "circle", ",": "circle", "o": "circle", "v": "triangle", "^": "triangle", "<": "triangle",
    ">": "triangle", "s": "rect", "d": "diamond", "D": "diamond", "p": "path://", "+": "path://M0,-4L0,4M-4,0L4,0", "x": "path://M-3,-3L3,3M-3,3L3,-3",
  };
  return symbols[marker] ?? null;
}
