import { areaPlot, barPlot, boxPlot, heatmapPlot, histogramPlot, linePlot, scatterPlot } from "../plots";
import { Table } from "../table";
import { requireTable } from "./support/common";
import type { ExecutionContext, NodeOutput } from "./support/types";

export function executePlotsNode(nodeType: string, params: Record<string, unknown>, upstream: unknown, context: ExecutionContext): NodeOutput | null {
  const tableResult: Table | null = null;
  const plotResult = null;
  const exportResult: string | null = null;
  const table = (): Table => requireTable(upstream, "Table input");

  switch (nodeType) {
    case "plot.series": {
      const y = params.y;
      if (y === null || y === undefined || String(y).trim() === "") throw new Error("Series requires a Y column");
      const lineStyle = String(params.lineStyle ?? "-");
      const marker = String(params.marker ?? "");
      const lineWidth = Number(params.lineWidth ?? 1.5);
      if (!["-", "--", "-.", ":"].includes(lineStyle)) throw new Error(`Unsupported Series lineStyle: ${lineStyle}`);
      if (!["", "o", "s", "^", "."].includes(marker)) throw new Error(`Unsupported Series marker: ${marker}`);
      if (!(lineWidth > 0 && lineWidth <= 20)) throw new Error("Series lineWidth must be between 0 and 20");
      const value: Record<string, unknown> = { y, lineStyle, marker, lineWidth };
      const label = String(params.label ?? "").trim();
      if (label) value.label = label;
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "plot.series_registry": {
      if (!upstream || typeof upstream !== "object" || upstream instanceof Table || Array.isArray(upstream)) {
        throw new Error("Series Registry requires named Series inputs");
      }
      const entries = Object.entries(upstream as Record<string, unknown>).filter(([port]) => port.startsWith("series")).map(([port, value]) => {
        const order = Number(port.slice(6));
        if (!Number.isInteger(order) || order < 1) throw new Error(`Invalid Series Registry input port: ${port}`);
        if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Table) throw new Error(`Series Registry input ${port} must be a Series object`);
        return [order, { ...(value as Record<string, unknown>) }] as const;
      }).sort((left, right) => left[0] - right[0]);
      const expected = Number(params.seriesCount ?? (entries.length || 1));
      if (!Number.isInteger(expected) || expected < 1 || entries.length !== expected) throw new Error(`Series Registry requires ${expected} connected Series inputs`);
      const value = entries.map(([, item]) => item);
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "plot.line": {
      const chart = linePlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.scatter": {
      const chart = scatterPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.bar": {
      const chart = barPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.histogram": {
      const chart = histogramPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.box": {
      const chart = boxPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.area": {
      const chart = areaPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    case "plot.heatmap": {
      const chart = heatmapPlot(table(), params);
      return { outputs: { output: chart }, tableResult, plotResult: chart, exportResult };
    }
    default:
      return null;
  }
}
