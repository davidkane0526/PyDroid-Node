import { executeNode, type NodeOutput } from "../nodes";
import { Table } from "../table";
import { containerChildren, edgeValue, loopBody, nodeUpstream, orderedNodes, requireTable } from "./graph";
import type { Workflow, WorkflowInputFile, WorkflowNode } from "./types";

function executeContainerGraph(
  workflow: Workflow,
  children: WorkflowNode[],
  seed: unknown,
  csvText: string,
  inputFiles: WorkflowInputFile[],
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
  workspaceVariables: Map<string, unknown>,
  executeChild?: (node: WorkflowNode, upstream: unknown) => NodeOutput,
): unknown {
  const childIds = new Set(children.map((child) => child.id));
  const internalEdges = workflow.edges.filter((edge) => childIds.has(edge.source) && childIds.has(edge.target));
  const internalWorkflow: Workflow = { nodes: children, edges: internalEdges };
  const values = new Map<string, Record<string, unknown>>();
  const ordered = orderedNodes(internalWorkflow);
  for (const child of ordered) {
    const data = child.data;
    if (["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(data.nodeType)) {
      throw new Error("Nested visual structures are not supported in this build");
    }
    const hasInternalInput = internalEdges.some((edge) => edge.target === child.id);
    const upstream = hasInternalInput ? nodeUpstream(child.id, data.nodeType, internalWorkflow, values) : seed;
    const result = executeChild
      ? executeChild(child, upstream)
      : executeNode(data.nodeType, data.parameters, upstream, { csvText, inputFiles, notebookNamespace, variables, workspaceVariables });
    values.set(child.id, result.outputs);
  }
  if (!ordered.length) return seed;
  const sinks = ordered.filter((child) => !internalEdges.some((edge) => edge.source === child.id));
  const selected = sinks[sinks.length - 1] ?? ordered[ordered.length - 1];
  const outputs = values.get(selected.id) ?? {};
  return outputs.output ?? Object.values(outputs)[0] ?? seed;
}

export function executeVisualStructure(
  node: WorkflowNode,
  workflow: Workflow,
  upstream: unknown,
  csvText: string,
  inputFiles: WorkflowInputFile[],
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
  workspaceVariables: Map<string, unknown>,
  executeChild?: (node: WorkflowNode, upstream: unknown) => NodeOutput,
): Record<string, unknown> {
  const nodeType = node.data.nodeType;
  const params = node.data.parameters;
  const table = requireTable(upstream, "Structure input");
  if (nodeType === "logic.if_subflow") {
    const condition = String(params.condition ?? "").trim();
    if (!condition) throw new Error("If structure requires a condition");
    const matching = table.query(condition);
    const matchingSet = new Set(matching.rows().map((row) => JSON.stringify(row)));
    const falseRows = table.rows().filter((row) => !matchingSet.has(JSON.stringify(row)));
    const trueSeed = new Table(table.columns, matching.rows());
    const falseSeed = new Table(table.columns, falseRows);
    return {
      true: executeContainerGraph(workflow, containerChildren(workflow, node.id, "true"), trueSeed, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild),
      false: executeContainerGraph(workflow, containerChildren(workflow, node.id, "false"), falseSeed, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild),
    };
  }

  const body = containerChildren(workflow, node.id, "body");
  const maximum = Number(params.maxIterations ?? 100);
  if (nodeType === "logic.for_each_subflow") {
    if (table.rowCount > maximum) throw new Error(`For structure exceeds maxIterations=${maximum}`);
    const rows: unknown[] = [];
    for (let index = 0; index < table.rowCount; index += 1) {
      const rowSeed = new Table(table.columns, [table.row(index)]);
      rows.push(executeContainerGraph(workflow, body, rowSeed, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild));
    }
    const frames = rows.filter((item): item is Table => item instanceof Table);
    const done = frames.length ? frames.reduce((acc, frame) => acc.concat(frame, 0, true)) : new Table(table.columns, []);
    return { done, output: done };
  }

  const condition = String(params.condition ?? "").trim();
  let current = table.copy();
  for (let iteration = 0; iteration < maximum; iteration += 1) {
    if (current.query(condition).rowCount === 0) {
      const result = current.resetIndex(true);
      return { done: result, output: result };
    }
    const bodyResult = executeContainerGraph(workflow, body, current, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild);
    current = requireTable(bodyResult, "While structure body");
  }
  throw new Error(`While structure reached maxIterations=${maximum}`);
}

export function executeLoopSubflow(
  loopNode: WorkflowNode,
  workflow: Workflow,
  values: Map<string, Record<string, unknown>>,
  csvText: string,
  inputFiles: WorkflowInputFile[],
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
  workspaceVariables: Map<string, unknown>,
  executeChild?: (node: WorkflowNode, upstream: unknown) => NodeOutput,
): Table {
  const loopId = loopNode.id;
  const nodeType = loopNode.data.nodeType;
  const params = loopNode.data.parameters;
  const entryEdges = workflow.edges.filter((edge) => edge.target === loopId && (edge.targetHandle === null || edge.targetHandle === undefined || edge.targetHandle === "input"));
  if (entryEdges.length !== 1) throw new Error("Loop subflow requires exactly one initial input connection");
  const initial = requireTable(edgeValue(entryEdges[0], values), "Loop initial input");
  const { bodyNodes, backEdge } = loopBody(workflow, loopId);
  const maximum = Number(params.maxIterations ?? 100);
  if (maximum < 1 || maximum > 100_000) throw new Error("Loop maxIterations must be between 1 and 100000");

  const executeBody = (seed: Table): Table => {
    const localValues = new Map(values);
    localValues.set(loopId, { body: seed, done: seed, output: seed });
    for (const bodyNode of bodyNodes) {
      const bodyData = bodyNode.data;
      if (["logic.for_each_subflow", "logic.while_subflow"].includes(bodyData.nodeType)) {
        throw new Error("Nested loop subflows are not supported yet");
      }
      const upstream = nodeUpstream(bodyNode.id, bodyData.nodeType, workflow, localValues);
      const result = executeChild
        ? executeChild(bodyNode, upstream)
        : executeNode(bodyData.nodeType, bodyData.parameters, upstream, { csvText, inputFiles, notebookNamespace, variables, workspaceVariables });
      localValues.set(bodyNode.id, result.outputs);
    }
    return requireTable(edgeValue(backEdge, localValues), "Loop continue output");
  };

  if (nodeType === "logic.for_each_subflow") {
    if (initial.rowCount > maximum) throw new Error(`For subflow has ${initial.rowCount} rows, exceeding maxIterations=${maximum}`);
    const results: Table[] = [];
    for (let index = 0; index < initial.rowCount; index += 1) {
      const rowSeed = new Table(initial.columns, [initial.row(index)]);
      results.push(executeBody(rowSeed));
    }
    return results.length ? results.reduce((acc, frame) => acc.concat(frame, 0, true)) : new Table(initial.columns, []);
  }

  const condition = String(params.condition ?? "").trim();
  if (!condition) throw new Error("While subflow requires a query condition");
  let current = initial.copy();
  for (let iteration = 0; iteration < maximum; iteration += 1) {
    if (current.query(condition).rowCount === 0) return current.resetIndex(true);
    current = executeBody(current);
  }
  if (current.query(condition).rowCount !== 0) throw new Error(`While subflow reached maxIterations=${maximum}`);
  return current.resetIndex(true);
}
