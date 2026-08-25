import { areaPlot, barPlot, boxPlot, heatmapPlot, histogramPlot, linePlot, scatterPlot } from "../plots";
import { Table } from "../table";
import { asBool, parameterList, requireTable } from "./support/common";
import type { ExecutionContext, NodeOutput } from "./support/types";


function legendStateValue(params: Record<string, unknown>): Record<string, unknown> {
  const mode = String(params.mode ?? "all");
  if (!["all", "hide", "solo"].includes(mode)) throw new Error(`Unsupported Legend State mode: ${mode}`);
  const groups = parameterList(params.groups).map((item) => String(item).trim()).filter(Boolean);
  if (mode !== "all" && !groups.length) throw new Error("Legend State requires at least one legend group");
  return { mode, groups };
}

function applyLegendState(items: Array<Record<string, unknown>>, raw: unknown): { items: Array<Record<string, unknown>>; mode: string } {
  if (raw === null || raw === undefined) return { items, mode: "all" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw instanceof Table) throw new Error("Series Registry legendState must be a Legend State object");
  const state = raw as Record<string, unknown>;
  const mode = String(state.mode ?? "all");
  if (!["all", "hide", "solo"].includes(mode)) throw new Error(`Unsupported Legend State mode: ${mode}`);
  const groups = new Set(parameterList(state.groups).map((item) => String(item).trim()).filter(Boolean));
  if (mode !== "all" && !groups.size) throw new Error("Legend State requires at least one legend group");
  if (mode === "all") return { items, mode };
  for (const item of items) {
    const groupMatch = groups.has(String(item.legendGroup ?? "").trim());
    item.visible = asBool(item.visible ?? true) && (mode === "solo" ? groupMatch : !groupMatch);
  }
  return { items, mode };
}

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
      const value: Record<string, unknown> = { y, visible: asBool(params.visible ?? true), lineStyle, marker, lineWidth };
      const label = String(params.label ?? "").trim();
      const group = String(params.group ?? "").trim();
      const legendGroup = String(params.legendGroup ?? "").trim();
      if (label) value.label = label;
      if (group) value.group = group;
      if (legendGroup) value.legendGroup = legendGroup;
      if (asBool(params.solo ?? false)) value.solo = true;
      return { outputs: { output: value }, tableResult, plotResult, exportResult };
    }
    case "plot.legend_state": {
      const value = legendStateValue(params);
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
      const groupMode = String(params.groupMode ?? "all");
      if (!["all", "include", "exclude"].includes(groupMode)) throw new Error(`Unsupported Series Registry groupMode: ${groupMode}`);
      const groups = new Set(parameterList(params.groups).map((item) => String(item).trim()).filter(Boolean));
      if (groupMode !== "all" && !groups.size) throw new Error("Series Registry group filter requires at least one group");
      let value = entries.map(([, item]) => {
        const result = { ...item };
        const currentlyVisible = asBool(result.visible ?? true);
        const group = String(result.group ?? "").trim();
        const groupMatch = groups.has(group);
        result.visible = currentlyVisible && (groupMode === "all" || (groupMode === "include" ? groupMatch : !groupMatch));
        return result;
      });
      const legendState = applyLegendState(value, (upstream as Record<string, unknown>).legendState);
      value = legendState.items;
      if (legendState.mode !== "solo") {
        const hasSolo = value.some((item) => asBool(item.visible ?? true) && asBool(item.solo ?? false));
        if (hasSolo) value.forEach((item) => { item.visible = asBool(item.visible ?? true) && asBool(item.solo ?? false); });
      }
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
