// 工作流执行引擎：拓扑排序 DAG 执行、循环子流程、视觉结构、分组扁平化。
// 对齐原 engine.py 的 execute_workflow 语义，输出相同的 JSON 结构。
import { Table, tableFromValue } from "./table";
import { executeNode, type NodeOutput } from "./nodes";
import { executeJsCell, createNotebookNamespace } from "./notebook";

export type ExecutionResultJson = {
  status: "success" | "error";
  preview: { columns: string[]; rows: Array<Array<string | number | boolean | null>>; totalRows: number; totalColumns: number };
  plotChart: unknown | null;
  exportCsv: string | null;
  exports: Array<{ nodeId: string; fileName: string; content: string }>;
  nodeResults: Record<string, unknown>;
  nodeTimingsMs: Record<string, number>;
  executionOrder: string[];
  nodeId?: string;
  nodeType?: string;
  message?: string;
  debugTraceback?: string | null;
};

const MAX_WORKFLOW_NODES = 2_000;
const MAX_WORKFLOW_EDGES = 10_000;
const MAX_INPUT_FILES = 500;
const MAX_INPUT_TEXT_CHARS = 64 * 1024 * 1024;
const MAX_WORKFLOW_JSON_CHARS = 16 * 1024 * 1024;
const MAX_INPUT_FILES_JSON_CHARS = 96 * 1024 * 1024;

type WorkflowNode = { id: string; data: { nodeType: string; parameters: Record<string, unknown>; groupInputs?: Array<Record<string, unknown>>; groupOutputs?: Array<Record<string, unknown>>; branch?: string; canvasParentId?: string }; position?: { x: number; y: number }; parentId?: string | null };
type WorkflowEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
type Workflow = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

function decodeJsonCompatible(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const converted = text
      .replace(/([{,]\s*)'([^']*)'(\s*[:,\]}])/g, "$1\"$2\"$3")
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, "$1\"$2\":")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    try {
      return JSON.parse(converted);
    } catch {
      throw new Error(`${label} 格式错误（JSON 或 Python 字面量均无法解析）`);
    }
  }
}

export function orderedNodes(workflow: Workflow): WorkflowNode[] {
  const nodes = workflow.nodes;
  const edges = workflow.edges;
  if (nodes.length && nodes.every((node) => typeof node.data.parameters.notebookCellIndex === "number" || node.data.parameters.notebookCellIndex !== undefined)) {
    const withIndex = nodes.map((node) => ({
      node,
      cell: Number(node.data.parameters.notebookCellIndex ?? 0),
      operation: Number(node.data.parameters.notebookOperationIndex ?? 0),
    }));
    withIndex.sort((a, b) => a.cell - b.cell || a.operation - b.operation);
    return withIndex.map((item) => item.node);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error("Workflow node IDs must be unique");
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const downstream = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) throw new Error("Workflow contains an edge with a missing node");
    const targetType = byId.get(edge.target)?.data.nodeType;
    if ((targetType === "logic.for_each_subflow" || targetType === "logic.while_subflow") && edge.targetHandle === "continue") continue;
    const list = downstream.get(edge.source) ?? [];
    list.push(edge.target);
    downstream.set(edge.source, list);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered: WorkflowNode[] = [];
  while (queue.length) {
    const nodeId = queue.shift() as string;
    ordered.push(byId.get(nodeId) as WorkflowNode);
    for (const target of downstream.get(nodeId) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (ordered.length !== nodes.length) throw new Error("Workflow must not contain cycles");
  return ordered;
}

function edgeValue(edge: WorkflowEdge, values: Map<string, Record<string, unknown>>): unknown {
  const outputs = values.get(edge.source);
  if (!outputs) throw new Error(`Source node ${edge.source} has no outputs`);
  const port = edge.sourceHandle || "output";
  if (!(port in outputs)) throw new Error(`Source node ${edge.source} has no output port ${port}`);
  return outputs[port];
}

function upstreamValue(nodeId: string, workflow: Workflow, values: Map<string, Record<string, unknown>>): unknown {
  const incoming = workflow.edges.filter((edge) => edge.target === nodeId);
  if (!incoming.length) return null;
  if (incoming.length > 1) throw new Error(`Node ${nodeId} currently accepts only one table input`);
  return edgeValue(incoming[0], values);
}

function upstreamTables(nodeId: string, workflow: Workflow, values: Map<string, Record<string, unknown>>): Record<string, Table> {
  const incoming = workflow.edges.filter((edge) => edge.target === nodeId);
  const ports: Record<string, Table> = {};
  const fallback = ["left", "right"];
  let fallbackIndex = 0;
  for (const edge of incoming) {
    const port = edge.targetHandle || fallback[fallbackIndex++] || "";
    if (port !== "left" && port !== "right") throw new Error(`Unknown concat input port: ${port}`);
    if (port in ports) throw new Error(`Concat input ${port} has more than one connection`);
    ports[port] = requireTable(edgeValue(edge, values), `Concat input ${port}`);
  }
  if (Object.keys(ports).length !== 2 || !("left" in ports) || !("right" in ports)) {
    throw new Error("Concat requires both A and B table inputs");
  }
  return ports;
}

function upstreamInputs(nodeId: string, workflow: Workflow, values: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const incoming = workflow.edges.filter((edge) => edge.target === nodeId);
  const inputs: Record<string, unknown> = {};
  for (const edge of incoming) {
    const port = edge.targetHandle || "input";
    if (port in inputs) throw new Error(`Input ${port} has more than one connection`);
    inputs[port] = edgeValue(edge, values);
  }
  return inputs;
}

function nodeUpstream(nodeId: string, nodeType: string, workflow: Workflow, values: Map<string, Record<string, unknown>>): unknown {
  if (["table.concat", "logic.merge_rows"].includes(nodeType)) return upstreamTables(nodeId, workflow, values);
  if (["pulse.combine_channels", "pulse.segment_measurement", "custom.python_function", "ui.alert"].includes(nodeType)) {
    return upstreamInputs(nodeId, workflow, values);
  }
  return upstreamValue(nodeId, workflow, values);
}

function requireTable(value: unknown, operation: string): Table {
  if (!(value instanceof Table)) throw new Error(`${operation} requires a table input`);
  return value;
}

function loopBody(workflow: Workflow, loopId: string): { bodyNodes: WorkflowNode[]; backEdge: WorkflowEdge } {
  const edges = workflow.edges;
  const startEdges = edges.filter((edge) => edge.source === loopId && edge.sourceHandle === "body");
  const backEdges = edges.filter((edge) => edge.target === loopId && edge.targetHandle === "continue");
  if (startEdges.length !== 1 || backEdges.length !== 1) {
    throw new Error("Loop subflow requires exactly one body connection and one continue connection");
  }
  const pending = [startEdges[0].target];
  const bodyIds = new Set<string>();
  while (pending.length) {
    const nodeId = pending.pop() as string;
    if (nodeId === loopId || bodyIds.has(nodeId)) continue;
    bodyIds.add(nodeId);
    for (const edge of edges) {
      if (edge.source === nodeId && edge.target !== loopId) pending.push(edge.target);
    }
  }
  if (!bodyIds.has(backEdges[0].source)) throw new Error("Loop continue connection must come from the body subflow");
  const bodyWorkflow: Workflow = {
    nodes: workflow.nodes.filter((node) => bodyIds.has(node.id)),
    edges: edges.filter((edge) => bodyIds.has(edge.source) && bodyIds.has(edge.target)),
  };
  return { bodyNodes: orderedNodes(bodyWorkflow), backEdge: backEdges[0] };
}

function allLoopBodyIds(workflow: Workflow): Set<string> {
  const result = new Set<string>();
  for (const node of workflow.nodes) {
    if (["logic.for_each_subflow", "logic.while_subflow"].includes(node.data.nodeType)) {
      try {
        const { bodyNodes } = loopBody(workflow, node.id);
        bodyNodes.forEach((item) => result.add(item.id));
      } catch {
        // 循环节点自身会在执行时报错
      }
    }
  }
  return result;
}

function containerChildren(workflow: Workflow, containerId: string, branch: string): WorkflowNode[] {
  const children = workflow.nodes.filter((node) => node.parentId === containerId && (node.data.branch ?? "body") === branch);
  return children.sort((a, b) => {
    const ax = Number(a.position?.x ?? 0);
    const bx = Number(b.position?.x ?? 0);
    const ay = Number(a.position?.y ?? 0);
    const by = Number(b.position?.y ?? 0);
    return ax - bx || ay - by;
  });
}

function executeContainerGraph(
  workflow: Workflow,
  children: WorkflowNode[],
  seed: unknown,
  csvText: string,
  inputFiles: Array<{ name: string; text?: string; base64?: string }>,
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
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
    const result = executeNode(data.nodeType, data.parameters, upstream, { csvText, inputFiles, notebookNamespace, variables });
    values.set(child.id, result.outputs);
  }
  if (!ordered.length) return seed;
  const sinks = ordered.filter((child) => !internalEdges.some((edge) => edge.source === child.id));
  const selected = sinks[sinks.length - 1] ?? ordered[ordered.length - 1];
  const outputs = values.get(selected.id) ?? {};
  return outputs.output ?? Object.values(outputs)[0] ?? seed;
}

function executeVisualStructure(
  node: WorkflowNode,
  workflow: Workflow,
  upstream: unknown,
  csvText: string,
  inputFiles: Array<{ name: string; text?: string; base64?: string }>,
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
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
      true: executeContainerGraph(workflow, containerChildren(workflow, node.id, "true"), trueSeed, csvText, inputFiles, notebookNamespace, variables),
      false: executeContainerGraph(workflow, containerChildren(workflow, node.id, "false"), falseSeed, csvText, inputFiles, notebookNamespace, variables),
    };
  }
  const body = containerChildren(workflow, node.id, "body");
  const maximum = Number(params.maxIterations ?? 100);
  if (nodeType === "logic.for_each_subflow") {
    if (table.rowCount > maximum) throw new Error(`For structure exceeds maxIterations=${maximum}`);
    const rows: unknown[] = [];
    for (let index = 0; index < table.rowCount; index += 1) {
      const rowSeed = new Table(table.columns, [table.row(index)]);
      rows.push(executeContainerGraph(workflow, body, rowSeed, csvText, inputFiles, notebookNamespace, variables));
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
    const bodyResult = executeContainerGraph(workflow, body, current, csvText, inputFiles, notebookNamespace, variables);
    current = requireTable(bodyResult, "While structure body");
  }
  throw new Error(`While structure reached maxIterations=${maximum}`);
}

function executeLoopSubflow(
  loopNode: WorkflowNode,
  workflow: Workflow,
  values: Map<string, Record<string, unknown>>,
  csvText: string,
  inputFiles: Array<{ name: string; text?: string; base64?: string }>,
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
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
      const result = executeNode(bodyData.nodeType, bodyData.parameters, upstream, { csvText, inputFiles, notebookNamespace, variables });
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

function flattenWorkflowGroups(workflow: Workflow): Workflow {
  const groups = new Map(workflow.nodes.filter((node) => node.data.nodeType === "workflow.group").map((node) => [node.id, node]));
  let flatEdges: WorkflowEdge[] = workflow.edges.map((edge) => ({ ...edge }));
  let changed = true;
  for (let pass = 0; changed && pass <= groups.size; pass += 1) {
    changed = false;
    const nextEdges: WorkflowEdge[] = [];
    for (const edge of flatEdges) {
      const targetGroup = groups.get(edge.target);
      if (targetGroup) {
        const port = (targetGroup.data.groupInputs ?? []).find((item) => item.id === edge.targetHandle);
        if (!port) throw new Error(`Group ${targetGroup.id} has no input port ${edge.targetHandle}`);
        nextEdges.push({ ...edge, target: String(port.internalNodeId), targetHandle: port.internalHandle ? String(port.internalHandle) : undefined });
        changed = true;
        continue;
      }
      const sourceGroup = groups.get(edge.source);
      if (sourceGroup) {
        const port = (sourceGroup.data.groupOutputs ?? []).find((item) => item.id === edge.sourceHandle);
        if (!port) throw new Error(`Group ${sourceGroup.id} has no output port ${edge.sourceHandle}`);
        nextEdges.push({ ...edge, source: String(port.internalNodeId), sourceHandle: port.internalHandle ? String(port.internalHandle) : undefined });
        changed = true;
        continue;
      }
      nextEdges.push(edge);
    }
    flatEdges = nextEdges;
  }
  if (changed) throw new Error("Workflow groups are nested too deeply or contain a port cycle");
  const flatNodes = workflow.nodes.filter((node) => node.data.nodeType !== "workflow.group").map((node) => {
    const data = { ...node.data };
    delete data.canvasParentId;
    return { ...node, data };
  });
  return { nodes: flatNodes, edges: flatEdges };
}

export function previewOf(table: Table | null, latestValue: unknown): { columns: string[]; rows: Array<Array<string | number | boolean | null>>; totalRows: number; totalColumns: number } {
  if (table) return table.preview(500);
  return new Table(["result"], [[typeof latestValue === "string" ? latestValue : String(latestValue ?? "")]]).preview(500);
}

export function environmentInfoJson(): string {
  return JSON.stringify({
    runtimeVersion: "1.0.0 (WebAssembly-free)",
    packages: [
      { name: "jsEngine", version: "1.0.0" },
      { name: "table", version: "1.0.0" },
      { name: "echarts", version: "6.1.0" },
    ],
  });
}

export function executeWorkflowJson(workflowJson: string, csvText: string, inputFilesJson = "[]"): string {
  try {
    if (typeof workflowJson !== "string" || workflowJson.length > MAX_WORKFLOW_JSON_CHARS) {
      throw new Error("Workflow document is missing or exceeds the 16 MiB safety limit");
    }
    if (typeof csvText !== "string" || csvText.length > MAX_INPUT_TEXT_CHARS) {
      throw new Error("CSV input exceeds the 64 MiB safety limit");
    }
    if (typeof inputFilesJson !== "string" || inputFilesJson.length > MAX_INPUT_FILES_JSON_CHARS) {
      throw new Error("Multi-file input document exceeds the 96 MiB safety limit");
    }
    const workflow = decodeJsonCompatible(workflowJson, "工作流 JSON") as Workflow;
    const inputFiles = decodeJsonCompatible(inputFilesJson, "输入文件 JSON") as Array<{ name: string; text?: string; base64?: string }>;
    if (!workflow || typeof workflow !== "object") throw new Error("Workflow must be a JSON object");
    const nodes = workflow.nodes;
    const edges = workflow.edges;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error("Workflow nodes and edges must be JSON arrays");
    if (nodes.length > MAX_WORKFLOW_NODES || edges.length > MAX_WORKFLOW_EDGES) {
      throw new Error(`Workflow exceeds the safety limit of ${MAX_WORKFLOW_NODES} nodes or ${MAX_WORKFLOW_EDGES} edges`);
    }
    if (!Array.isArray(inputFiles)) throw new Error("inputFiles must be a JSON array");
    if (inputFiles.length > MAX_INPUT_FILES) throw new Error(`Multi-file input exceeds the safety limit of ${MAX_INPUT_FILES} files`);
    let totalInputChars = 0;
    for (let index = 0; index < inputFiles.length; index += 1) {
      const item = inputFiles[index];
      if (!item || typeof item.name !== "string" || (item.text !== undefined && typeof item.text !== "string") || (item.base64 !== undefined && typeof item.base64 !== "string")) {
        throw new Error(`Input file ${index + 1} must contain a name and readable content`);
      }
      totalInputChars += String(item.text ?? "").length + String(item.base64 ?? "").length;
      if (totalInputChars > MAX_INPUT_TEXT_CHARS) throw new Error("Combined multi-file input exceeds the 64 MiB safety limit");
    }
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node || typeof node.id !== "string" || !node.id) throw new Error(`Workflow node ${index + 1} has an invalid ID`);
      if (!node.data || typeof node.data !== "object" || typeof node.data.nodeType !== "string" || !node.data.parameters || typeof node.data.parameters !== "object") {
        throw new Error(`Workflow node ${node.id} has invalid data or parameters`);
      }
    }
    for (const edge of edges) {
      if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string") {
        throw new Error("Every workflow edge must be a JSON object with source and target");
      }
    }

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
    // 视觉结构（if/for/while 子流程）的子节点由其父结构节点执行，主循环跳过
    const containedNodeIds = new Set(flattened.nodes.filter((node) => node.parentId).map((node) => node.id));

    // notebook 命名空间（JS 代码单元共享）
    const notebookNamespace = createNotebookNamespace(csvText, inputFiles);
    const variables = new Map<string, unknown>();

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
            outputs = executeVisualStructure(node, flattened, upstream, csvText, inputFiles, notebookNamespace, variables);
            tableResult = Object.values(outputs).find((item) => item instanceof Table) as Table | null ?? null;
          } else {
            tableResult = executeLoopSubflow(node, flattened, values, csvText, inputFiles, notebookNamespace, variables);
            outputs = { done: tableResult, output: tableResult };
          }
        } else {
          const upstream = nodeUpstream(nodeId, nodeType, flattened, values);
          const result = executeNode(nodeType, params, upstream, { csvText, inputFiles, notebookNamespace, variables });
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
        nodeResults[nodeId] = { kind: "value", text: String(outputs.__print__) };
      } else if (plotResult) {
        nodeResults[nodeId] = { kind: "plot", chart: plotResult };
      } else if (tableResult) {
        nodeResults[nodeId] = { kind: "table", preview: tableResult.preview(200) };
      } else if (exportResult !== null && exportResult !== undefined) {
        nodeResults[nodeId] = { kind: "value", text: `CSV · ${exportResult.length} characters` };
      } else {
        const display = outputs.output ?? Object.values(outputs)[0] ?? null;
        if (display !== null && display !== undefined) {
          nodeResults[nodeId] = { kind: "value", text: printableText(display, 4000) };
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
    });
  } catch (error) {
    return JSON.stringify(errorResponse(error instanceof Error ? error.message : String(error)));
  }
}

function errorResponse(
  message: string,
  nodeId = "__workflow__",
  nodeType = "workflow",
  nodeResults: Record<string, unknown> = {},
  nodeTimingsMs: Record<string, number> = {},
  executionOrder: string[] = [],
  preview: unknown = null,
  debugTraceback?: string,
): Record<string, unknown> {
  return {
    status: "error",
    nodeId,
    nodeType,
    message,
    nodeResults,
    nodeTimingsMs,
    executionOrder,
    preview,
    debugTraceback: debugTraceback ?? null,
  };
}

function roundMs(milliseconds: number): number {
  return Math.round(milliseconds * 1000) / 1000;
}

function printableText(value: unknown, limit = 4000): string {
  if (value instanceof Table) return value.toString();
  if (typeof value === "string") return value.length > limit ? value.slice(0, limit) : value;
  try {
    const text = JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return String(value);
  }
}

export function tableFromAny(value: unknown): Table {
  return tableFromValue(value, "Table");
}
