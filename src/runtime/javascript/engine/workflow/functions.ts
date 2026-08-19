import { executeJsCell } from "../notebook";
import { executeNode, type ExecutionContext, type NodeOutput } from "../nodes";
import { Table } from "../table";
import type { PlotChart } from "../plots";
import { allLoopBodyIds, edgeValue, flattenWorkflowGroups, orderedNodes } from "./graph";
import { executeLoopSubflow, executeVisualStructure } from "./structures";
import type { Workflow, WorkflowFunctionDefinition, WorkflowInputFile, WorkflowNode } from "./types";

type FunctionExecutionContext = ExecutionContext & {
  workflow: Workflow;
  callStack: string[];
};

const MULTI_INPUT_NODE_TYPES = new Set([
  "table.concat",
  "logic.merge_rows",
  "pulse.combine_channels",
  "pulse.segment_measurement",
  "custom.python_function",
  "ui.alert",
  "function.call",
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
  for (const edge of workflow.edges.filter((item) => item.target === node.id)) {
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

  const loopBodyIds = allLoopBodyIds(workflow);
  const containedNodeIds = new Set(workflow.nodes.filter((node) => node.parentId).map((node) => node.id));
  let latestTable: Table | null = null;
  let latestPlot: PlotChart | null = null;
  let latestExport: string | null = null;
  const childExecutor = (child: WorkflowNode, upstream: unknown): NodeOutput => child.data.nodeType === "function.call"
    ? executeFunctionCall(child, upstream, { ...context, callStack: [...context.callStack, definition.id] })
    : executeNode(child.data.nodeType, child.data.parameters, upstream, context);

  for (const node of ordered) {
    if (loopBodyIds.has(node.id) || containedNodeIds.has(node.id)) continue;
    const data = node.data;
    const params = data.parameters;
    let result: NodeOutput;
    if (typeof params.notebookSource === "string") {
      const cell = executeJsCell(String(params.notebookSource), context.notebookNamespace);
      result = { outputs: cell.outputs, tableResult: cell.table, plotResult: cell.plot, exportResult: null };
    } else if (data.nodeType === "notebook.code_cell") {
      const cell = executeJsCell(String(params.source ?? ""), context.notebookNamespace);
      result = { outputs: cell.outputs, tableResult: cell.table, plotResult: cell.plot, exportResult: null };
    } else if (data.nodeType === "notebook.markdown_cell") {
      const text = String(params.source ?? "");
      result = { outputs: { next: text, output: text }, tableResult: null, plotResult: null, exportResult: null };
    } else if (["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(data.nodeType)) {
      const upstream = upstreamForFunctionNode(node, workflow, values, externalByNode.get(node.id) ?? new Map());
      const hasChildren = workflow.nodes.some((child) => child.parentId === node.id);
      if (data.nodeType === "logic.if_subflow" || hasChildren) {
        const outputs = executeVisualStructure(node, workflow, upstream, context.csvText, context.inputFiles, context.notebookNamespace, context.variables, context.workspaceVariables, childExecutor);
        result = {
          outputs,
          tableResult: (Object.values(outputs).find((item) => item instanceof Table) as Table | undefined) ?? null,
          plotResult: null,
          exportResult: null,
        };
      } else {
        // Existing loop executor owns its back-edge topology. Function signature input is injected
        // as a synthetic value on the loop node only when the loop has no ordinary entry edge.
        if ((externalByNode.get(node.id)?.size ?? 0) > 0 && !workflow.edges.some((edge) => edge.target === node.id && (edge.targetHandle ?? "input") === "input")) {
          throw new Error("Loop subflow inside a function must receive its initial value from an internal edge");
        }
        const table = executeLoopSubflow(node, workflow, values, context.csvText, context.inputFiles, context.notebookNamespace, context.variables, context.workspaceVariables, childExecutor);
        result = { outputs: { done: table, output: table }, tableResult: table, plotResult: null, exportResult: null };
      }
    } else {
      const upstream = upstreamForFunctionNode(node, workflow, values, externalByNode.get(node.id) ?? new Map());
      if (data.nodeType === "function.call") {
        result = executeFunctionCall(node, upstream, { ...context, callStack: [...context.callStack, definition.id] });
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
