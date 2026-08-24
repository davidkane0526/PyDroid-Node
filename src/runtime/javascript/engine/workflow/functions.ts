import { executeJsCell } from "../notebook";
import { executeNode, type ExecutionContext, type NodeOutput } from "../nodes";
import { Table } from "../table";
import type { PlotChart } from "../plots";
import { dataEdges, edgeValue, flattenWorkflowGroups, orderedNodes } from "./graph";
import { executeVisualStructure } from "./structures";
import type { Workflow, WorkflowFunctionDefinition, WorkflowInputFile, WorkflowNode } from "./types";

type FunctionExecutionContext = ExecutionContext & {
  workflow: Workflow;
  callStack: string[];
};

const MULTI_INPUT_NODE_TYPES = new Set([
  "table.concat",
  "table.concat_many",
  "table.merge_rows",
  "pulse.combine_channels",
  "pulse.segment_measurement",
  "custom.python_function",
  "ui.alert",
  "function.call",
  "function.map",
  "logic.if_value",
]);

function definitionForCall(node: WorkflowNode, workflow: Workflow, callStack: string[]): WorkflowFunctionDefinition {
  const functionId = String(node.data.parameters.functionId ?? "").trim();
  const version = Number(node.data.parameters.functionVersion ?? 0);
  if (!functionId) throw new Error("Function call is missing functionId");
  const definition = (workflow.functions ?? []).find((item) => item.id === functionId);
  if (!definition) throw new Error(`Function ${functionId} is not available in this workflow`);
  if (definition.version !== version) {
    throw new Error(`Function ${definition.name} version mismatch: call requests v${version}, document provides v${definition.version}`);
  }
  if (callStack.includes(functionId)) {
    throw new Error(`Recursive function call is not allowed: ${[...callStack, functionId].join(" -> ")}`);
  }
  if (callStack.length >= 32) throw new Error("Function call depth exceeds 32");
  return definition;
}

function valueForOutput(outputs: Record<string, unknown>, handle?: string | null): unknown {
  const port = handle || "output";
  if (!(port in outputs)) throw new Error(`Function output source has no port ${port}`);
  return outputs[port];
}

function upstreamForFunctionNode(
  node: WorkflowNode,
  workflow: Workflow,
  values: Map<string, Record<string, unknown>>,
  externalInputs: Map<string, unknown>,
): unknown {
  const inputs: Record<string, unknown> = {};
  for (const edge of dataEdges(workflow).filter((item) => item.target === node.id)) {
    const port = edge.targetHandle || "input";
    if (port in inputs) throw new Error(`Function node ${node.id} input ${port} has more than one connection`);
    inputs[port] = edgeValue(edge, values);
  }
  for (const [port, value] of externalInputs) {
    if (port in inputs) throw new Error(`Function node ${node.id} input ${port} is wired both internally and externally`);
    inputs[port] = value;
  }
  if (MULTI_INPUT_NODE_TYPES.has(node.data.nodeType)) return inputs;
  const entries = Object.entries(inputs);
  if (!entries.length) return null;
  if (entries.some(([port]) => port !== "input")) return inputs;
  if (entries.length > 1) throw new Error(`Function node ${node.id} currently accepts only one input`);
  return entries[0][1];
}

function executeFunctionGraph(
  definition: WorkflowFunctionDefinition,
  callInputs: Record<string, unknown>,
  context: FunctionExecutionContext,
): NodeOutput {
  const baseWorkflow: Workflow = {
    nodes: definition.nodes,
    edges: definition.edges,
    functions: context.workflow.functions,
  };
  const workflow = flattenWorkflowGroups(baseWorkflow);
  const ordered = orderedNodes(workflow);
  const values = new Map<string, Record<string, unknown>>();
  const externalByNode = new Map<string, Map<string, unknown>>();
  for (const port of definition.inputs) {
    if (!Object.prototype.hasOwnProperty.call(callInputs, port.id)) {
      throw new Error(`Function ${definition.name} requires input ${port.label || port.id}`);
    }
    const ports = externalByNode.get(port.internalNodeId) ?? new Map<string, unknown>();
    const handle = port.internalHandle || "input";
    if (ports.has(handle)) throw new Error(`Function input mapping duplicates ${port.internalNodeId}.${handle}`);
    ports.set(handle, callInputs[port.id]);
    externalByNode.set(port.internalNodeId, ports);
  }

  const containedNodeIds = new Set(workflow.nodes.filter((node) => node.parentId).map((node) => node.id));
  let latestTable: Table | null = null;
  let latestPlot: PlotChart | null = null;
  let latestExport: string | null = null;
  const childExecutor = (child: WorkflowNode, upstream: unknown): NodeOutput => child.data.nodeType === "function.call"
    ? executeFunctionCall(child, upstream, { ...context, callStack: [...context.callStack, definition.id] })
    : child.data.nodeType === "function.map"
      ? executeFunctionMap(child, upstream, { ...context, callStack: [...context.callStack, definition.id] })
      : executeNode(child.data.nodeType, child.data.parameters, upstream, context);

  for (const node of ordered) {
    if (containedNodeIds.has(node.id)) continue;
    const data = node.data;
    const params = data.parameters;
    let result: NodeOutput;
    if (data.nodeType === "notebook.code_cell") {
      const cell = executeJsCell(String(params.source ?? ""), context.notebookNamespace);
      result = { outputs: cell.outputs, tableResult: cell.table, plotResult: cell.plot, exportResult: null };
    } else if (data.nodeType === "notebook.markdown_cell") {
      const text = String(params.source ?? "");
      result = { outputs: { next: text, output: text }, tableResult: null, plotResult: null, exportResult: null };
    } else if (["logic.if_value", "logic.for_each_value", "logic.while_state"].includes(data.nodeType)) {
      const upstream = upstreamForFunctionNode(node, workflow, values, externalByNode.get(node.id) ?? new Map());
      const outputs = executeVisualStructure(node, workflow, upstream, context.csvText, context.inputFiles, context.notebookNamespace, context.variables, context.workspaceVariables, childExecutor);
      result = {
        outputs,
        tableResult: (Object.values(outputs).find((item) => item instanceof Table) as Table | undefined) ?? null,
        plotResult: null,
        exportResult: null,
      };
    } else {
      const upstream = upstreamForFunctionNode(node, workflow, values, externalByNode.get(node.id) ?? new Map());
      if (data.nodeType === "function.call") {
        result = executeFunctionCall(node, upstream, { ...context, callStack: [...context.callStack, definition.id] });
      } else if (data.nodeType === "function.map") {
        result = executeFunctionMap(node, upstream, { ...context, callStack: [...context.callStack, definition.id] });
      } else {
        result = executeNode(data.nodeType, params, upstream, context);
      }
    }
    values.set(node.id, result.outputs);
    if (result.tableResult) latestTable = result.tableResult;
    if (result.plotResult) latestPlot = result.plotResult;
    if (result.exportResult !== null && result.exportResult !== undefined) latestExport = result.exportResult;
  }

  const outputs: Record<string, unknown> = {};
  for (const port of definition.outputs) {
    const source = values.get(port.internalNodeId);
    if (!source) throw new Error(`Function ${definition.name} output ${port.label || port.id} source did not execute`);
    outputs[port.id] = valueForOutput(source, port.internalHandle);
  }
  const firstOutput = Object.values(outputs)[0];
  if (!("output" in outputs) && firstOutput !== undefined) outputs.output = firstOutput;
  const tableResult = (Object.values(outputs).find((item) => item instanceof Table) as Table | undefined) ?? latestTable;
  return { outputs, tableResult, plotResult: latestPlot, exportResult: latestExport };
}

export function executeFunctionCall(node: WorkflowNode, upstream: unknown, context: FunctionExecutionContext): NodeOutput {
  const definition = definitionForCall(node, context.workflow, context.callStack);
  let callInputs: Record<string, unknown>;
  if (upstream && typeof upstream === "object" && !(upstream instanceof Table)) {
    callInputs = { ...(upstream as Record<string, unknown>) };
    if (definition.inputs.length === 1 && !(definition.inputs[0].id in callInputs) && Object.keys(callInputs).length === 1) {
      callInputs = { [definition.inputs[0].id]: Object.values(callInputs)[0] };
    }
  } else {
    callInputs = definition.inputs.length === 1 ? { [definition.inputs[0].id]: upstream } : {};
  }
  return executeFunctionGraph(definition, callInputs, context);
}


function iterableFunctionMapItems(value: unknown): unknown[] {
  if (value instanceof Table) return [...value.columns];
  if (Array.isArray(value)) return [...value];
  if (typeof value === "string") return [...value];
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return [...value.keys()];
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  throw new Error("Function map iterable input must be a list, table, text, set, map, or object");
}

function collectedToTable(values: unknown[]): Table {
  if (!values.length) return new Table(["0"], []);
  if (values.every((value) => value && typeof value === "object" && !(value instanceof Table) && !Array.isArray(value))) {
    return Table.fromRecords(values as Array<Record<string, unknown>>);
  }
  const rows = values.map((value) => Array.isArray(value) ? value : [value]);
  const width = Math.max(1, ...rows.map((row) => row.length));
  return new Table(Array.from({ length: width }, (_, index) => String(index)), rows);
}

export function executeFunctionMap(node: WorkflowNode, upstream: unknown, context: FunctionExecutionContext): NodeOutput {
  const definition = definitionForCall(node, context.workflow, context.callStack);
  const params = node.data.parameters;
  const mapInput = String(params.mapInput ?? "").trim();
  if (!mapInput) throw new Error("Function map is missing mapInput");
  if (!definition.inputs.some((port) => port.id === mapInput)) {
    throw new Error(`Function map input ${mapInput} is not present in function ${definition.name}`);
  }
  if (!upstream || typeof upstream !== "object" || upstream instanceof Table || Array.isArray(upstream)) {
    throw new Error("Function map requires named function inputs");
  }
  const callInputs = { ...(upstream as Record<string, unknown>) };
  if (!(mapInput in callInputs)) throw new Error(`Function map requires iterable input ${mapInput}`);
  const items = iterableFunctionMapItems(callInputs[mapInput]);
  const maximum = Number(params.maxIterations ?? 100000);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1_000_000) throw new Error("Function map maxIterations must be between 1 and 1000000");
  if (items.length > maximum) throw new Error(`Function map has ${items.length} items, exceeding maxIterations=${maximum}`);

  const outputIds = definition.outputs.map((port) => port.id);
  const collected: unknown[] = [];
  let lastValue: unknown = null;
  let latestPlot: PlotChart | null = null;
  let latestExport: string | null = null;
  for (const item of items) {
    const iterationInputs = { ...callInputs, [mapInput]: item };
    const result = executeFunctionGraph(definition, iterationInputs, context);
    if (outputIds.length === 1) {
      lastValue = result.outputs[outputIds[0]];
      collected.push(lastValue);
    } else {
      collected.push(outputIds.map((port) => result.outputs[port]));
    }
    if (result.plotResult) latestPlot = result.plotResult;
    if (result.exportResult !== null && result.exportResult !== undefined) latestExport = result.exportResult;
  }

  const collectMode = String(params.collectMode ?? "list");
  let output: unknown;
  let tableResult: Table | null = null;
  if (collectMode === "list") {
    output = collected;
  } else if (collectMode === "table") {
    tableResult = collectedToTable(collected);
    output = tableResult;
  } else {
    throw new Error(`Unsupported function map collectMode: ${collectMode}`);
  }

  const outputs: Record<string, unknown> = { output };
  if (outputIds.length === 1 && String(params.lastItemVariable ?? "").trim()) outputs.last = lastValue;
  return { outputs, tableResult, plotResult: latestPlot, exportResult: latestExport };
}

export function createFunctionExecutionContext(
  workflow: Workflow,
  csvText: string,
  inputFiles: WorkflowInputFile[],
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
  workspaceVariables: Map<string, unknown>,
): FunctionExecutionContext {
  return { workflow, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, callStack: [] };
}
