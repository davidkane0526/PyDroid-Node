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
