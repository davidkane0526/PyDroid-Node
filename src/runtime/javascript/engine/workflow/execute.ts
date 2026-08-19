import { createNotebookNamespace, executeJsCell } from "../notebook";
import { executeNode } from "../nodes";
import { Table } from "../table";
import { allLoopBodyIds, flattenWorkflowGroups, nodeUpstream, orderedNodes } from "./graph";
import { parseWorkflowInputs } from "./input";
import { errorResponse, printableText, roundMs, semanticValue } from "./result";
import { executeLoopSubflow, executeVisualStructure } from "./structures";
import { decodeWorkspaceState, encodeWorkspaceState } from "./state";
import { createFunctionExecutionContext, executeFunctionCall } from "./functions";

export function executeWorkflowJson(workflowJson: string, csvText: string, inputFilesJson = "[]"): string {
  try {
    const { workflow, inputFiles } = parseWorkflowInputs(workflowJson, csvText, inputFilesJson);
    const flattened = flattenWorkflowGroups(workflow);
    const ordered = orderedNodes(flattened);
    const values = new Map<string, Record<string, unknown>>();
    let latestTable: Table | null = null;
    let latestValue: unknown = null;
    let plotChart: unknown = null;
    let exportCsv: string | null = null;
    const exports: Array<{ nodeId: string; fileName: string; content: string }> = [];
    const nodeResults: Record<string, unknown> = {};
    const nodeTimingsMs: Record<string, number> = {};
    const executionOrder: string[] = [];
    const loopBodyIds = allLoopBodyIds(flattened);
    const containedNodeIds = new Set(flattened.nodes.filter((node) => node.parentId).map((node) => node.id));

    const notebookNamespace = createNotebookNamespace(csvText, inputFiles);
    const variables = new Map<string, unknown>();
    const workspaceVariables = decodeWorkspaceState(workflow.workspaceState);
    const functionContext = createFunctionExecutionContext(workflow, csvText, inputFiles, notebookNamespace, variables, workspaceVariables);
    const executeChild = (child: typeof ordered[number], upstream: unknown) => child.data.nodeType === "function.call"
      ? executeFunctionCall(child, upstream, functionContext)
      : executeNode(child.data.nodeType, child.data.parameters, upstream, { csvText, inputFiles, notebookNamespace, variables, workspaceVariables });

    for (const node of ordered) {
      const nodeId = node.id;
      if (loopBodyIds.has(nodeId) || containedNodeIds.has(nodeId)) continue;
      const data = node.data;
      const nodeType = data.nodeType;
      const params = data.parameters;
      const started = performance.now();
      let outputs: Record<string, unknown>;
      let tableResult: Table | null = null;
      let plotResult: unknown = null;
      let exportResult: string | null = null;
      try {
        if (typeof params.notebookSource === "string") {
          const result = executeJsCell(String(params.notebookSource), notebookNamespace);
          outputs = result.outputs;
          tableResult = result.table;
          plotResult = result.plot;
        } else if (nodeType === "notebook.code_cell") {
          const result = executeJsCell(String(params.source ?? ""), notebookNamespace);
          outputs = result.outputs;
          tableResult = result.table;
          plotResult = result.plot;
        } else if (nodeType === "notebook.markdown_cell") {
          const text = String(params.source ?? "");
          outputs = { next: text, output: text };
        } else if (["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(nodeType)) {
          const hasChildren = flattened.nodes.some((child) => child.parentId === nodeId);
          if (nodeType === "logic.if_subflow" || hasChildren) {
            const upstream = nodeUpstream(nodeId, nodeType, flattened, values);
            outputs = executeVisualStructure(node, flattened, upstream, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild);
            tableResult = Object.values(outputs).find((item) => item instanceof Table) as Table | null ?? null;
          } else {
            tableResult = executeLoopSubflow(node, flattened, values, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild);
            outputs = { done: tableResult, output: tableResult };
          }
        } else {
          const upstream = nodeUpstream(nodeId, nodeType, flattened, values);
          const context = { csvText, inputFiles, notebookNamespace, variables, workspaceVariables };
          const result = nodeType === "function.call"
            ? executeFunctionCall(node, upstream, functionContext)
            : executeNode(nodeType, params, upstream, context);
          outputs = result.outputs;
          tableResult = result.tableResult;
          plotResult = result.plotResult;
          exportResult = result.exportResult;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        nodeTimingsMs[nodeId] = roundMs(performance.now() - started);
        return JSON.stringify(errorResponse(message, nodeId, nodeType, nodeResults, nodeTimingsMs, executionOrder, latestTable ? latestTable.preview(500) : null, error instanceof Error ? error.stack : undefined));
      }

      nodeTimingsMs[nodeId] = roundMs(performance.now() - started);
      executionOrder.push(nodeId);

      if (tableResult) latestTable = tableResult;
      if (plotResult) plotChart = plotResult;
      if (exportResult !== null && exportResult !== undefined) {
        exportCsv = exportResult;
        exports.push({
          nodeId,
          fileName: String(params.fileName ?? "result.csv") || "result.csv",
          content: exportResult,
        });
      }
      values.set(nodeId, outputs);
      latestValue = outputs.output ?? Object.values(outputs)[0] ?? latestValue;
      if ("__print__" in outputs) {
        nodeResults[nodeId] = {
          kind: "value",
          text: String(outputs.__print__),
          value: semanticValue(Object.prototype.hasOwnProperty.call(outputs, "output") ? outputs.output : outputs.__print__),
        };
      } else if (plotResult) {
        nodeResults[nodeId] = { kind: "plot", chart: plotResult };
      } else if (tableResult) {
        nodeResults[nodeId] = { kind: "table", preview: tableResult.preview(200) };
      } else if (exportResult !== null && exportResult !== undefined) {
        nodeResults[nodeId] = { kind: "value", text: `CSV · ${exportResult.length} characters`, value: exportResult };
      } else {
        const display = outputs.output ?? Object.values(outputs)[0] ?? null;
        if (display !== null && display !== undefined) {
          nodeResults[nodeId] = { kind: "value", text: printableText(display, 4000), value: semanticValue(display) };
        }
      }
    }

    if (!latestTable) latestTable = new Table(["result"], [[printableText(latestValue)]]);

    return JSON.stringify({
      status: "success",
      preview: latestTable.preview(500),
      plotChart,
      exportCsv,
      exports,
      nodeResults,
      nodeTimingsMs,
      executionOrder,
      workspaceState: encodeWorkspaceState(workspaceVariables),
    });
  } catch (error) {
    return JSON.stringify(errorResponse(error instanceof Error ? error.message : String(error)));
  }
}
