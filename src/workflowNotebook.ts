import type { Edge } from "@xyflow/react";
import { parseWorkflow, type WorkflowDocument, type WorkflowNode } from "./workflow";

const NODE_CELL = /^# %% \[node\] ([^\r\n]+)$/gm;

export type NotebookCell = {
  id: string;
  cellType: "code" | "markdown";
  source: string;
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  executionCount?: number | null;
  rawFields?: Record<string, unknown>;
};

export type NotebookCellAnalysis = {
  index: number; recognized: boolean; reason?: string; nodeType?: string; label?: string;
  parameters?: Record<string, string | number | boolean | null>;
  inputVariable?: string | null; outputVariable?: string | null;
  semantic?: boolean; source?: string; kind?: string; defines?: string[]; uses?: string[];
  operations?: Array<Omit<NotebookCellAnalysis, "operations"> & { index: number }>;
  children?: Array<Omit<NotebookCellAnalysis, "operations"> & { branch: "true" | "false" | "body"; childIndex: number }>;
};

function connectablePort(node: WorkflowNode | undefined, direction: "input" | "output"): string | undefined {
  if (!node) return undefined;
  const type = node.data.nodeType;
  if (direction === "input") {
    if (["io.read_csv", "io.read_csv_batch", "io.read_table", "io.read_text", "io.read_json", "io.read_image", "notebook.markdown_cell"].includes(type)) return undefined;
    if (type === "notebook.code_cell") return "previous";
    return "input";
  }
  if (type === "notebook.markdown_cell") return "next";
  if (type === "notebook.code_cell") return "next";
  return "output";
}

export function splitWorkflowNotebookCells(source: string): NotebookCell[] {
  const sections = source.split(/(?=^# %%)/gm).filter((section) => section.trim());
  return sections.map((section, index) => ({
    id: `cell-${index}-${Math.random().toString(36).slice(2, 8)}`,
    cellType: index === 0 && !section.trimStart().startsWith("# %%") ? "markdown" : "code",
    source: section.trimEnd(),
  }));
}

export function joinNotebookCells(cells: NotebookCell[]): string {
  return `${cells.map((cell) => cell.source.trimEnd()).filter(Boolean).join("\n\n")}\n`;
}

export function notebookCellsToWorkflow(name: string, cells: NotebookCell[], notebookMetadata: Record<string, unknown> = {}): WorkflowDocument {
  const nodes: WorkflowNode[] = cells.map((cell, index) => ({
    id: `notebook-cell-${index + 1}`,
    type: "workflow",
    position: { x: 80, y: 55 + index * 150 },
    data: {
      label: cell.cellType === "code" ? `代码单元格 ${index + 1}` : `Markdown ${index + 1}`,
      nodeType: cell.cellType === "code" ? "notebook.code_cell" : "notebook.markdown_cell",
      nodeVersion: 1,
      parameters: {
        source: cell.source,
        metadataJson: JSON.stringify(cell.metadata ?? {}),
        outputsJson: JSON.stringify(cell.outputs ?? []),
        executionCount: cell.executionCount ?? null,
        ...(index === 0 ? { notebookMetadataJson: JSON.stringify(notebookMetadata) } : {}),
      },
      status: "idle",
    },
  }));
  const edges = nodes.slice(1).map((node, index) => ({ id: `notebook-order-${index}`, source: nodes[index].id, sourceHandle: "next", target: node.id, targetHandle: "previous" }));
  return parseWorkflow(JSON.stringify({ schemaVersion: 1, name, nodes, edges }));
}

export function analyzedNotebookToWorkflow(name: string, cells: NotebookCell[], analyses: NotebookCellAnalysis[], notebookMetadata: Record<string, unknown> = {}): WorkflowDocument {
  const byIndex = new Map(analyses.map((analysis) => [analysis.index, analysis]));
  type Operation = Omit<NotebookCellAnalysis, "operations"> & { index: number };
  type Entry = { cell: NotebookCell; cellIndex: number; operation?: Operation; operationIndex: number; parentOperationIndex?: number; branch?: "true" | "false" | "body" };
  const entries: Entry[] = cells.flatMap<Entry>((cell, index) => {
    const analysis = byIndex.get(index);
    if (cell.cellType === "code" && analysis?.operations?.length) {
      return analysis.operations
        .filter((operation) => operation.semantic !== false && operation.nodeType && !operation.nodeType.startsWith("notebook.") && operation.nodeType !== "custom.python_function")
        .flatMap((operation, operationIndex) => [{ cell, cellIndex: index, operation, operationIndex }, ...((operation.children ?? []).filter((child) => child.semantic && child.nodeType).map((child, childIndex) => ({ cell, cellIndex: index, operation: { ...child, index: operationIndex * 100 + childIndex + 1 } as Operation, operationIndex: operationIndex * 100 + childIndex + 1, parentOperationIndex: operationIndex, branch: child.branch })))]);
    }
    if (cell.cellType === "code" && analysis?.recognized && analysis.semantic !== false && analysis.nodeType && !analysis.nodeType.startsWith("notebook.") && analysis.nodeType !== "custom.python_function") {
      return [{ cell, cellIndex: index, operation: analysis as Operation, operationIndex: 0 }];
    }
    return [];
  });
  // 布局常量：结构容器按子节点数自适应高度，顶层按容器占位流式排布，避免与既有节点重叠
  const STRUCTURE_MIN_WIDTH = 520;
  const STRUCTURE_MIN_HEIGHT = 300;
  const CHILD_COLUMN_X = 275;   // 容器内第二列（false/body 分支）x 偏移
  const CHILD_ROW_H = 78;       // 容器内垂直间距
  const STRUCTURE_TOP = 92;     // 容器头部高度
  const STRUCTURE_PAD = 30;     // 容器底部留白
  const TOP_COL_W = 275;        // 顶层每列宽度
  const TOP_ROW_H = 155;        // 顶层每行高度
  const TOP_LEFT = 70;
  const TOP_TOP = 65;
  const MAX_TOP_COLUMNS = 4;    // 顶层每行最多列单位
  const isStructureType = (nodeType: string | undefined) => nodeType === "logic.if_subflow" || nodeType === "logic.for_each_subflow" || nodeType === "logic.while_subflow";
  const entryId = (entry: Entry) => `notebook-cell-${entry.cellIndex + 1}-step-${entry.operationIndex + 1}`;
  const structureSizes = new Map<string, { width: number; height: number }>();
  const childPositions = new Map<string, { x: number; y: number }>();
  for (const parent of entries) {
    if (!isStructureType(parent.operation?.nodeType)) continue;
    const children = entries.filter((entry) => entry.parentOperationIndex !== undefined && entry.cellIndex === parent.cellIndex && entry.parentOperationIndex === parent.operationIndex);
    const groups = new Map<string, { x: number; count: number }>();
    for (const child of children) {
      const branch = child.branch ?? "body";
      if (!groups.has(branch)) groups.set(branch, { x: branch === "false" ? 35 + CHILD_COLUMN_X : 35, count: 0 });
      groups.get(branch)!.count += 1;
    }
    const rows = Math.max(...[...groups.values()].map((group) => group.count), 1);
    structureSizes.set(entryId(parent), { width: STRUCTURE_MIN_WIDTH, height: Math.max(STRUCTURE_MIN_HEIGHT, STRUCTURE_TOP + rows * CHILD_ROW_H + STRUCTURE_PAD) });
    const cursor = new Map<string, number>();
    for (const child of children) {
      const branch = child.branch ?? "body";
      const group = groups.get(branch)!;
      childPositions.set(entryId(child), { x: group.x, y: STRUCTURE_TOP + (cursor.get(branch) ?? 0) * CHILD_ROW_H });
      cursor.set(branch, (cursor.get(branch) ?? 0) + 1);
    }
  }
  const topLevelPosition = (() => {
    let x = TOP_LEFT, y = TOP_TOP, colUsed = 0, rowHeight = 0;
    return (entry: Entry): { x: number; y: number } => {
      const size = structureSizes.get(entryId(entry));
      const cols = size ? Math.max(2, Math.ceil((size.width + 20) / TOP_COL_W)) : 1;
      const rows = size ? Math.max(2, Math.ceil((size.height + 20) / TOP_ROW_H)) : 1;
      if (colUsed > 0 && colUsed + cols > MAX_TOP_COLUMNS) { x = TOP_LEFT; y += rowHeight; colUsed = 0; rowHeight = 0; }
      const position = { x, y };
      x += cols * TOP_COL_W;
      colUsed += cols;
      rowHeight = Math.max(rowHeight, rows * TOP_ROW_H);
      return position;
    };
  })();
  const nodes: WorkflowNode[] = entries.map(({ cell, cellIndex, operation, operationIndex, parentOperationIndex, branch }) => {
    const recognized = Boolean(cell.cellType === "code" && operation?.semantic && operation.nodeType);
    const resolvedNodeType = operation!.nodeType!;
    const id = entryId({ cell, cellIndex, operation, operationIndex, parentOperationIndex, branch });
    const parentId = parentOperationIndex === undefined ? undefined : `notebook-cell-${cellIndex + 1}-step-${parentOperationIndex + 1}`;
    const structure = isStructureType(resolvedNodeType);
    const size = structure ? (structureSizes.get(id) ?? { width: STRUCTURE_MIN_WIDTH, height: STRUCTURE_MIN_HEIGHT }) : undefined;
    const position = parentId ? (childPositions.get(id) ?? { x: 35, y: STRUCTURE_TOP }) : topLevelPosition({ cell, cellIndex, operation, operationIndex, parentOperationIndex, branch });
    return {
      id, type: "workflow", parentId, extent: parentId ? "parent" : undefined, style: size ? { width: size.width, height: size.height } : undefined, position,
      data: {
        label: operation?.label || operation?.nodeType!,
        nodeType: resolvedNodeType, nodeVersion: 1,
        parameters: {
          ...(operation?.parameters ?? {}),
          notebookCellIndex: cellIndex,
          notebookOperationIndex: operationIndex,
        }, status: "idle", branch,
      },
    };
  });
  const edges: Edge[] = [];
  const variableNode = new Map<string, string>();
  entries.forEach(({ operation }, flatIndex) => {
    if (!operation?.recognized) return;
    const target = nodes[flatIndex]?.id;
    const targetNode = nodes[flatIndex];
    const dependencies = [...new Set([operation.inputVariable, ...(operation.uses ?? [])].filter((name): name is string => Boolean(name && variableNode.has(name))))];
    dependencies.forEach((dependency, dependencyIndex) => {
      const source = variableNode.get(dependency);
      const sourceNode = nodes.find((node) => node.id === source);
      const sourceHandle = connectablePort(sourceNode, "output");
      const targetHandle = targetNode.data.nodeType === "table.concat" ? (dependencyIndex === 0 ? "left" : dependencyIndex === 1 ? "right" : undefined) : connectablePort(targetNode, "input");
      if (source && target && source !== target && sourceHandle && targetHandle && !edges.some((edge) => edge.source === source && edge.target === target && edge.targetHandle === targetHandle)) {
        edges.push({ id: `notebook-variable-${edges.length}`, source, sourceHandle, target, targetHandle });
      }
    });
    for (const defined of operation.defines ?? []) if (target) variableNode.set(defined, target);
    if (operation.outputVariable && target) variableNode.set(operation.outputVariable, target);
  });
  // Preserve executable cell order when AST dependency inference has no usable variable edge.
  for (let index = 1; index < nodes.length; index += 1) {
    const source = nodes[index - 1];
    const target = nodes[index];
    if (edges.some((edge) => edge.target === target.id)) continue;
    const sourceHandle = connectablePort(source, "output");
    const targetHandle = connectablePort(target, "input");
    if (sourceHandle && targetHandle) edges.push({ id: `notebook-order-${edges.length}`, source: source.id, sourceHandle, target: target.id, targetHandle });
  }
  const groupedNodes = [...nodes];
  const groupedEdges = [...edges];
  const byCell = new Map<number, WorkflowNode[]>();
  nodes.forEach((node) => {
    const index = Number(node.data.parameters.notebookCellIndex ?? -1);
    byCell.set(index, [...(byCell.get(index) ?? []), node]);
  });
  for (const [cellIndex, members] of byCell) {
    if (members.length < 3 || members.some((node) => node.parentId || ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(node.data.nodeType))) continue;
    const memberIds = new Set(members.map((node) => node.id));
    const groupId = `notebook-cell-${cellIndex + 1}-group`;
    const incoming = groupedEdges.filter((edge) => !memberIds.has(edge.source) && memberIds.has(edge.target));
    const outgoing = groupedEdges.filter((edge) => memberIds.has(edge.source) && !memberIds.has(edge.target));
    const groupInputs = incoming.map((edge, index) => ({ id: `input-${index + 1}`, label: `输入 ${index + 1}`, valueType: "any" as const, internalNodeId: edge.target, internalHandle: edge.targetHandle }));
    const groupOutputs = outgoing.map((edge, index) => ({ id: `output-${index + 1}`, label: `输出 ${index + 1}`, valueType: "any" as const, internalNodeId: edge.source, internalHandle: edge.sourceHandle }));
    members.forEach((node) => { node.data.canvasParentId = groupId; });
    groupedNodes.push({ id: groupId, type: "workflow", position: { x: 70 + cellIndex * 285, y: 65 }, data: { label: `Notebook 单元格 ${cellIndex + 1}`, nodeType: "workflow.group", nodeVersion: 1, parameters: { description: `${members.length} 个可执行步骤` }, status: "idle", groupInputs, groupOutputs } });
    groupedEdges.splice(0, groupedEdges.length, ...groupedEdges.map((edge) => {
      const inputIndex = incoming.findIndex((item) => item.id === edge.id);
      if (inputIndex >= 0) return { ...edge, target: groupId, targetHandle: groupInputs[inputIndex].id };
      const outputIndex = outgoing.findIndex((item) => item.id === edge.id);
      if (outputIndex >= 0) return { ...edge, source: groupId, sourceHandle: groupOutputs[outputIndex].id };
      return edge;
    }));
  }
  return parseWorkflow(JSON.stringify({ schemaVersion: 1, name, nodes: groupedNodes, edges: groupedEdges }));
}

export function workflowNotebookMetadata(nodes: WorkflowNode[]): Record<string, unknown> {
  const raw = nodes.find((node) => typeof node.data.parameters.notebookMetadataJson === "string")?.data.parameters.notebookMetadataJson;
  if (typeof raw !== "string" || !raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

export function workflowNotebookCells(nodes: WorkflowNode[], edges: Edge[], requirements: string[] = []): NotebookCell[] {
  if (!nodes.length) return [];
  if (nodes.some((node) => typeof node.data.parameters.notebookCellJson === "string")) {
    const originals = nodes.filter((node) => typeof node.data.parameters.notebookCellJson === "string");
    return originals.sort((left, right) => Number(left.data.parameters.notebookCellIndex ?? 0) - Number(right.data.parameters.notebookCellIndex ?? 0)).map((node) => JSON.parse(String(node.data.parameters.notebookCellJson)) as NotebookCell);
  }
  if (nodes.length && nodes.every((node) => node.data.nodeType === "notebook.code_cell" || node.data.nodeType === "notebook.markdown_cell")) {
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    const next = new Map<string, string>();
    for (const edge of edges) {
      if (edge.sourceHandle !== "next") continue;
      next.set(edge.source, edge.target);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }
    const ordered: WorkflowNode[] = [];
    const seen = new Set<string>();
    let current = nodes.find((node) => incoming.get(node.id) === 0) ?? nodes[0];
    while (current && !seen.has(current.id)) {
      ordered.push(current); seen.add(current.id);
      current = nodes.find((node) => node.id === next.get(current.id))!;
    }
    for (const node of nodes) if (!seen.has(node.id)) ordered.push(node);
    return ordered.map((node, index) => ({
      id: `workflow-${node.id}-${index}`,
      cellType: node.data.nodeType === "notebook.markdown_cell" ? "markdown" : "code",
      source: String(node.data.parameters.source ?? ""),
      metadata: JSON.parse(String(node.data.parameters.metadataJson ?? "{}")) as Record<string, unknown>,
      outputs: JSON.parse(String(node.data.parameters.outputsJson ?? "[]")) as unknown[],
      executionCount: typeof node.data.parameters.executionCount === "number" ? node.data.parameters.executionCount : null,
    }));
  }
  return splitWorkflowNotebookCells(serializeWorkflowNotebook("PyDroid Flow 工作流", nodes, edges, requirements));
}

export function parseJupyterNotebook(text: string): { name: string; cells: NotebookCell[]; metadata: Record<string, unknown>; nbformatMinor: number } {
  const notebook = JSON.parse(text) as { cells?: unknown[]; metadata?: Record<string, unknown>; nbformat?: number; nbformat_minor?: number };
  if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells)) throw new Error("仅支持 nbformat 4 的 Jupyter 文件");
  const cells = notebook.cells.map((raw, index) => {
    const cell = raw as Record<string, unknown>;
    const cellType = cell.cell_type;
    if (cellType !== "code" && cellType !== "markdown") throw new Error(`不支持的 Jupyter 单元格类型：${String(cellType)}`);
    const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "");
    return {
      id: `ipynb-${index}-${Math.random().toString(36).slice(2, 8)}`,
      cellType,
      source,
      metadata: (cell.metadata as Record<string, unknown>) ?? {},
      rawFields: Object.fromEntries(Object.entries(cell).filter(([key]) => !["cell_type", "source", "metadata", "outputs", "execution_count"].includes(key))),
      ...(cellType === "code" ? {
        outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
        ...("execution_count" in cell ? { executionCount: typeof cell.execution_count === "number" ? cell.execution_count : null } : {}),
      } : {}),
    } satisfies NotebookCell;
  });
  const flow = notebook.metadata?.pydroid_flow as { name?: unknown } | undefined;
  return { name: typeof flow?.name === "string" ? flow.name : "导入的 Jupyter Notebook", cells, metadata: notebook.metadata ?? {}, nbformatMinor: notebook.nbformat_minor ?? 5 };
}

function variableName(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  // Every workflow identifier is user-controlled. Prefixing avoids silently
  // replacing Python builtins such as range, list, print or DataFrame aliases.
  return `node_${cleaned || "value"}`;
}

function transformOutsideStrings(source: string, replacements: Record<string, string>): string {
  let output = "";
  let quote = "";
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (quote) {
      output += character;
      if (character === "\\") {
        output += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = "";
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    const word = Object.keys(replacements).find((candidate) => source.startsWith(candidate, index)
      && !/[A-Za-z0-9_]/.test(source[index - 1] ?? "")
      && !/[A-Za-z0-9_]/.test(source[index + candidate.length] ?? ""));
    if (word) {
      output += replacements[word];
      index += word.length;
    } else {
      output += character;
      index += 1;
    }
  }
  return output;
}

function pythonLiteral(value: unknown): string {
  return transformOutsideStrings(JSON.stringify(value, null, 2), { true: "True", false: "False", null: "None" });
}

function parsePythonLiteral(source: string): unknown {
  return JSON.parse(transformOutsideStrings(source, { True: "true", False: "false", None: "null" }));
}

function balancedDictionary(source: string, start: number): string {
  const opening = source.indexOf("{", start);
  if (opening < 0) throw new Error("节点单元格缺少 Python 参数字典");
  let depth = 0;
  let quote = "";
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(opening, index + 1);
  }
  throw new Error("节点参数字典没有闭合");
}

function inputExpression(nodeId: string, edges: Edge[]): string {
  const incoming = edges.filter((edge) => edge.target === nodeId);
  if (!incoming.length) return "None";
  if (incoming.length === 1) {
    const edge = incoming[0];
    const source = variableName(edge.source);
    return edge.sourceHandle && edge.sourceHandle !== "output" ? `${source}[${JSON.stringify(edge.sourceHandle)}]` : source;
  }
  return `{${incoming.map((edge) => `${JSON.stringify(edge.targetHandle ?? "input")}: ${variableName(edge.source)}${edge.sourceHandle && edge.sourceHandle !== "output" ? `[${JSON.stringify(edge.sourceHandle)}]` : ""}`).join(", ")}}`;
}

function orderedContainerChildren(children: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
  const childIds = new Set(children.map((child) => child.id));
  const incoming = new Map(children.map((child) => [child.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) if (childIds.has(edge.source) && childIds.has(edge.target)) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const ready = children.filter((child) => incoming.get(child.id) === 0);
  const ordered: WorkflowNode[] = [];
  while (ready.length) {
    const child = ready.shift()!;
    if (ordered.some((item) => item.id === child.id)) continue;
    ordered.push(child);
    for (const target of outgoing.get(child.id) ?? []) {
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) ready.push(children.find((item) => item.id === target)!);
    }
  }
  return [...ordered, ...children.filter((child) => !ordered.some((item) => item.id === child.id))];
}

function indentPython(source: string, spaces = 4): string {
  const indent = " ".repeat(spaces);
  return source.split("\n").map((line) => `${indent}${line}`).join("\n");
}

function structureOperationCode(node: WorkflowNode, edges: Edge[], nodes: WorkflowNode[]): string {
  const name = variableName(node.id);
  const params = `${name}_params`;
  const input = inputExpression(node.id, edges);
  const allChildren = nodes.filter((child) => child.parentId === node.id || child.data.canvasParentId === node.id);
  const internalIds = new Set(allChildren.map((child) => child.id));
  const internalEdges = edges.filter((edge) => internalIds.has(edge.source) && internalIds.has(edge.target));
  const makeRunner = (branch: "true" | "false" | "body", suffix: string) => {
    const children = orderedContainerChildren(allChildren.filter((child) => (child.data.branch ?? "body") === branch), internalEdges);
    const childIds = new Set(children.map((child) => child.id));
    const branchEdges = internalEdges.filter((edge) => childIds.has(edge.source) && childIds.has(edge.target));
    if (!children.length) return `def _run_${name}_${suffix}(_seed):\n    return _seed, {}`;
    const lines = [`def _run_${name}_${suffix}(_seed):`, "    _child_values = {}"];
    for (const child of children) {
      const childName = variableName(child.id);
      const incoming = branchEdges.filter((edge) => edge.target === child.id);
      const childInput = incoming.length ? inputExpression(child.id, branchEdges) : "_seed";
      lines.push(`    ${childName}_params = ${pythonLiteral(child.data.parameters)}`);
      lines.push(indentPython(operationCode(child, branchEdges, nodes, childInput, true)));
      lines.push(`    _child_values[${JSON.stringify(child.id)}] = ${childName}`);
    }
    const sinks = children.filter((child) => !branchEdges.some((edge) => edge.source === child.id));
    lines.push(`    return ${variableName((sinks.at(-1) ?? children.at(-1))!.id)}, _child_values`);
    return lines.join("\n");
  };
  if (node.data.nodeType === "logic.if_subflow") return `${makeRunner("true", "true")}
${makeRunner("false", "false")}
_matching = ${input}.query(${params}["condition"])
_true_seed = _matching.reset_index(drop=True)
_false_seed = ${input}.loc[~${input}.index.isin(_matching.index)].reset_index(drop=True)
_true_result, _true_children = _run_${name}_true(_true_seed)
_false_result, _false_children = _run_${name}_false(_false_seed)
${name} = {"true": _true_result, "false": _false_result, "__children__": {**_true_children, **_false_children}}`;
  const runner = makeRunner("body", "body");
  if (node.data.nodeType === "logic.for_each_subflow") return `${runner}
_loop_rows, _loop_children = [], {}
for _loop_index in range(min(len(${input}), int(${params}.get("maxIterations", 100)))):
    _loop_result, _iteration_children = _run_${name}_body(${input}.iloc[[_loop_index]].copy().reset_index(drop=True))
    if isinstance(_loop_result, pd.DataFrame): _loop_rows.append(_loop_result)
    _loop_children.update(_iteration_children)
_loop_done = pd.concat(_loop_rows, ignore_index=True) if _loop_rows else ${input}.iloc[0:0].copy()
${name} = {"done": _loop_done, "output": _loop_done, "__children__": _loop_children}`;
  return `${runner}
_loop_current, _loop_children = ${input}.copy(), {}
for _loop_index in range(int(${params}.get("maxIterations", 100))):
    if _loop_current.query(${params}["condition"]).empty: break
    _loop_current, _iteration_children = _run_${name}_body(_loop_current)
    _loop_children.update(_iteration_children)
${name} = {"done": _loop_current.reset_index(drop=True), "output": _loop_current.reset_index(drop=True), "__children__": _loop_children}`;
}

function operationCode(node: WorkflowNode, edges: Edge[], nodes: WorkflowNode[] = [], inputOverride?: string, inlineChild = false): string {
  const name = variableName(node.id);
  const params = `${name}_params`;
  const input = inputOverride ?? inputExpression(node.id, edges);
  const type = node.data.nodeType;
  const parent = !inlineChild && (node.parentId || node.data.canvasParentId) ? nodes.find((candidate) => candidate.id === (node.parentId ?? node.data.canvasParentId)) : undefined;
  if (parent && ["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(parent.data.nodeType)) {
    return `${name} = ${variableName(parent.id)}.get("__children__", {}).get(${JSON.stringify(node.id)})`;
  }
  if (["logic.if_subflow", "logic.for_each_subflow", "logic.while_subflow"].includes(type)) return structureOperationCode(node, edges, nodes);
  if (type === "io.read_csv") {
    return `${name} = pd.read_csv(input_files[0], sep=${params}.get("separator", ","), header=None if ${params}.get("header") == "none" else "infer", skiprows=${params}.get("skipRows", 0), usecols=_columns(${params}.get("useColumns", "")))`;
  }
  if (type === "io.read_csv_batch") {
    return `_frames = []
for _path in input_files:
    _frame = pd.read_csv(_path, sep=${params}.get("separator", ","), header=None if ${params}.get("header") == "none" else "infer", skiprows=${params}.get("skipRows", 0), usecols=_columns(${params}.get("useColumns", "")))
    _frame[${params}.get("sourceColumn", "source_file")] = Path(_path).name
    _match = re.search(${params}.get("filenamePattern", r"vg\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*v"), Path(_path).name, re.I)
    if _match and ${params}.get("metadataColumn"):
        _frame[${params}["metadataColumn"]] = float(_match.group(1))
    _frames.append(_frame)
${name} = pd.concat(_frames, ignore_index=True)`;
  }
  if (type === "io.read_text") return `${name} = input_files[int(${params}.get("fileIndex", 0))].read_text(encoding=${params}.get("encoding", "utf-8"))`;
  if (type === "io.read_json") return `${name} = json.loads(input_files[int(${params}.get("fileIndex", 0))].read_text(encoding=${params}.get("encoding", "utf-8")))`;
  if (type === "io.read_table") return `_path = input_files[int(${params}.get("fileIndex", 0))]
${name} = pd.read_json(_path) if _path.suffix.lower() == ".json" else pd.read_csv(_path, sep=None if ${params}.get("separator", "auto") == "auto" else ${params}.get("separator"), engine="python", header=0 if ${params}.get("header", True) else None, encoding=${params}.get("encoding", "utf-8"))`;
  if (type === "io.read_image") return `${name} = plt.imread(input_files[int(${params}.get("fileIndex", 0))])`;
  if (type === "io.export_csv") return `${input}.to_csv(${params}.get("fileName", "result.csv"), index=False)
${name} = ${input}`;
  if (type === "ui.alert") return `print(f"{${params}.get('title', '提示')}: {${params}.get('message', '')}")
_alert_confirm = str(${params}.get("confirmLabel", "确认"))
_alert_exit = str(${params}.get("exitLabel", "退出"))
_alert_cancel = str(${params}.get("cancelLabel", "取消"))
_alert_choice = input(" / ".join(label for label in [_alert_confirm, _alert_exit, _alert_cancel] if label) + ": ").strip()
${name} = True if _alert_confirm and _alert_choice == _alert_confirm else False if _alert_exit and _alert_choice == _alert_exit else None`;
  if (type === "ui.input_dialog") return `# PyDroid Flow interactive input placeholder. Replace input() when running non-interactively.
${name} = input(f"{${params}.get('title', '输入')}: {${params}.get('prompt', '')} ")
if ${params}.get("inputKind") == "number":
    ${name} = float(${name})`;
  if (type === "table.select_columns") return `${name} = ${input}.iloc[:, _columns(${params}.get("columns", ""))]`;
  if (type === "table.absolute") return `${name} = ${input}.abs()`;
  if (type === "table.transpose") return `${name} = ${input}.transpose().reset_index(drop=True)`;
  if (type === "table.slice") return `${name} = ${input}.iloc[slice(${params}.get("rowStart") or None, ${params}.get("rowStop") or None, int(${params}.get("rowStep", 1))), slice(${params}.get("columnStart") or None, ${params}.get("columnStop") or None, int(${params}.get("columnStep", 1)))]`;
  if (type === "table.reset_index") return `${name} = ${input}.reset_index(drop=${params}.get("drop", True))`;
  if (type === "table.sort_index") return `${name} = ${input}.sort_index(axis=int(${params}.get("axis", 0)), ascending=${params}.get("ascending", True))`;
  if (type === "table.periodic_window") return `_size, _count = int(${params}.get("groupSize", 75)), int(${params}.get("count", 25))
_offset = _size - _count if ${params}.get("position", "start") == "end" else int(${params}.get("offset", 0)) if ${params}.get("position") == "offset" else 0
${name} = ${input}.iloc[[row for base in range(0, len(${input}), _size) for row in range(base + _offset, min(base + _offset + _count, len(${input})))]]`;
  if (type === "table.periodic_tail_mean") return `_size, _tail = int(${params}.get("groupSize", 25)), int(${params}.get("tailRows", 10))
${name} = pd.DataFrame([${input}.iloc[start:start + _size].tail(_tail).mean(numeric_only=True) for start in range(0, len(${input}), _size)])`;
  if (type === "table.difference") return `${name} = ${input}.diff(periods=int(${params}.get("periods", 1)), axis=int(${params}.get("axis", 0)))`;
  if (type === "table.rename_columns") return `${name} = ${input}.set_axis([item.strip() for item in ${params}["names"].split(",")], axis=1)`;
  if (type === "table.pivot") return `${name} = ${input}.pivot_table(index=${params}["index"], columns=${params}["columns"], values=${params}["values"], aggfunc=${params}.get("aggregate", "mean")).sort_index().sort_index(axis=1).reset_index()`;
  if (type === "pandas.dropna") return `${name} = ${input}.dropna(how=${params}.get("how", "any")).reset_index(drop=True)`;
  if (type === "pandas.fillna") return `${name} = ${input}.fillna(${params}.get("value", 0))`;
  if (type === "pandas.sort_values") return `${name} = ${input}.sort_values(by=_column_names(${input}, ${params}.get("columns", "0")), ascending=${params}.get("ascending", True)).reset_index(drop=True)`;
  if (type === "pandas.query") return `${name} = ${input}.query(${params}["expression"]).reset_index(drop=True)`;
  if (type === "pandas.head") return `${name} = ${input}.head(int(${params}.get("n", 5)))`;
  if (type === "pandas.tail") return `${name} = ${input}.tail(int(${params}.get("n", 5)))`;
  if (type === "pandas.drop_duplicates") return `${name} = ${input}.drop_duplicates(keep=${params}.get("keep", "first"), ignore_index=${params}.get("ignoreIndex", True))`;
  if (type === "pandas.sample") return `${name} = ${input}.sample(n=int(${params}.get("n", 5)), replace=${params}.get("replace", False), random_state=int(${params}.get("randomState", 0)))`;
  if (type === "pandas.round") return `${name} = ${input}.round(int(${params}.get("decimals", 2)))`;
  if (type === "pandas.describe") return `${name} = ${input}.describe().reset_index(names="statistic")`;
  if (type === "logic.if_rows") return `_matching = ${input}.query(${params}["condition"])
${name} = {"true": _matching.reset_index(drop=True), "false": ${input}.loc[~${input}.index.isin(_matching.index)].reset_index(drop=True)}`;
  if (type === "logic.merge_rows" || type === "table.concat") return `${name} = pd.concat(list(${input}.values()), ignore_index=${params}.get("ignoreIndex", True))`;
  if (type === "logic.for_range") return `_values = list(range(int(${params}.get("start", 0)), int(${params}.get("stop", 10)), int(${params}.get("step", 1))))
${name} = pd.DataFrame({"iteration": range(len(_values)), "value": _values})`;
  if (type === "logic.while_number") return `_value, _rows = float(${params}.get("start", 0)), []
for _iteration in range(int(${params}.get("maxIterations", 100))):
    if not eval(${params}["condition"], {"__builtins__": {}}, {"value": _value, "iteration": _iteration}): break
    _rows.append({"iteration": _iteration, "value": _value})
    _value = eval(${params}["update"], {"__builtins__": {}}, {"value": _value, "iteration": _iteration})
${name} = pd.DataFrame(_rows)`;
  if (type === "analysis.ter_matrix") return `${name} = calculate_ter(${input}, ${params})`;
  if (type === "pulse.generate_waveform") return `_vmax, _step = float(${params}.get("voltageMax", 3)), abs(float(${params}.get("voltageStep", 0.2)))
_read_v, _read_t, _pulse_t = float(${params}.get("readVoltage", 0.1)), float(${params}.get("readTime", 0.01)), float(${params}.get("pulseTime", 0.01))
_cycles, _ratio, _time = float(${params}.get("cycles", 1)), float(${params}.get("ratio", 1)), float(${params}.get("timeShift", 0))
if _vmax == 0 or _step <= 0 or _read_t < 0 or _pulse_t < 0 or _read_t + _pulse_t <= 0: raise ValueError("Invalid pulse waveform parameters")
_direction, _maximum = (1 if _vmax > 0 else -1), abs(_vmax)
_levels = [_direction * min(value, _maximum) for value in np.arange(min(_step, _maximum), _maximum + _step * .01, _step)]
if not _levels or not np.isclose(abs(_levels[-1]), _maximum): _levels.append(_vmax)
_quarter, _half = _levels, _levels + [-value for value in _levels]
_sequence = _quarter if _cycles == .25 else _half if _cycles == .5 else (_half + list(reversed(_half))) * int(_cycles)
_rows = []
for _index, _level in enumerate(_sequence):
    _time += _read_t; _rows.append({"sequence": _index, "time_s": _time, "voltage_V": _read_v * _ratio, "phase": "read"})
    _time += _pulse_t; _rows.append({"sequence": _index, "time_s": _time, "voltage_V": _level * _ratio, "phase": "pulse"})
${name} = pd.DataFrame(_rows)`;
  if (type === "pulse.generate_oscillating_ramp") return `_interval, _total, _step = float(${params}.get("interval", .005)), float(${params}.get("totalTime", 10)), abs(float(${params}.get("amplitudeStep", .2)))
_fixed, _gate = float(${params}.get("fixedVoltage", .6)), float(${params}.get("gateVoltage", 0))
if _interval <= 0 or _total <= 0 or _step <= 0: raise ValueError("Invalid oscillating pulse parameters")
_rows, _amplitude = [], _step
for _index in range(max(0, int(np.ceil(_total / _interval)) - 1)):
    _time = (_index + 1) * _interval
    if _index % 2 == 0: _rows.append({"time_s": _time, "port1_V": 0., "port2_V": _fixed, "port3_V": _gate})
    else:
        _rows.append({"time_s": _time, "port1_V": _amplitude, "port2_V": 0., "port3_V": _gate})
        _amplitude = -_amplitude
        if _index % 4 == 1: _amplitude += _step if _amplitude > 0 else -_step
${name} = pd.DataFrame(_rows, columns=["time_s", "port1_V", "port2_V", "port3_V"])`;
  if (type === "pulse.combine_channels") return `_waveforms = ${input}
_time_column, _voltage_column = ${params}.get("timeColumn", "time_s"), ${params}.get("voltageColumn", "voltage_V")
_channel_names = {"drain": "Vd_V", "source": "Vs_V", "gate": "Vg_V"}
_parts = [pd.DataFrame({"time_s": pd.to_numeric(_frame[_column(_frame, _time_column)], errors="coerce"), _channel_names[_port]: pd.to_numeric(_frame[_column(_frame, _voltage_column)], errors="coerce")}).dropna(subset=["time_s"]).sort_values("time_s") for _port, _frame in _waveforms.items() if _port in _channel_names and _frame is not None]
if not _parts: raise ValueError("At least one pulse channel is required")
${name} = pd.DataFrame({"time_s": sorted(set().union(*[set(_part["time_s"]) for _part in _parts]))})
for _part in _parts: ${name} = pd.merge_asof(${name}, _part, on="time_s", direction="backward")
${name} = ${name}.ffill().fillna(0)`;
  if (type === "pulse.segment_measurement") return `_inputs = ${input}
_measurement, _waveform = _inputs["measurement"], _inputs["waveform"]
_mt, _current = _column(_measurement, ${params}.get("measurementTimeColumn", "time")), _column(_measurement, ${params}.get("currentColumn", "current"))
_wt, _wv = _column(_waveform, ${params}.get("waveformTimeColumn", "time_s")), _column(_waveform, ${params}.get("waveformVoltageColumn", "voltage_V"))
_samples = pd.DataFrame({"time": pd.to_numeric(_measurement[_mt], errors="coerce"), "current": pd.to_numeric(_measurement[_current], errors="coerce")}).dropna().sort_values("time")
_events = _waveform.copy(); _events["_time"] = pd.to_numeric(_events[_wt], errors="coerce"); _events["_voltage"] = pd.to_numeric(_events[_wv], errors="coerce"); _events = _events.dropna(subset=["_time"]).sort_values("_time").reset_index(drop=True)
_leading, _trailing, _rows, _times = int(${params}.get("dropLeadingRows", 0)), int(${params}.get("dropTrailingRows", 0)), [], _samples["time"].to_numpy()
for _index, _event in _events.iterrows():
    _start = np.searchsorted(_times, _event["_time"], side="left"); _end = np.searchsorted(_times, _events.iloc[_index + 1]["_time"], side="left") if _index + 1 < len(_events) else len(_samples)
    _segment = _samples.iloc[_start:_end]["current"].iloc[_leading:None if _trailing == 0 else -_trailing]
    _rows.append({"sequence": int(_event.get("sequence", _index)), "phase": str(_event.get("phase", "pulse")), "waveform_time_s": _event["_time"], "voltage_V": _event["_voltage"], "sample_count": len(_segment), "mean_current_A": _segment.mean()})
${name} = pd.DataFrame(_rows)`;
  if (type === "plot.line") return `_axis = ${input}.plot(x=_column(${input}, ${params}.get("xColumn")) if ${params}.get("xColumn") != "" else None, y=_column_names(${input}, ${params}.get("yColumns", "")) or None, linewidth=float(${params}.get("lineWidth", 1.5)), marker=${params}.get("marker") or None)
_axis.set(title=${params}.get("title", ""), xlabel=${params}.get("xLabel", ""), ylabel=${params}.get("yLabel", ""))
${name} = _axis.get_figure()`;
  if (["plot.scatter", "plot.bar", "plot.histogram", "plot.box", "plot.area"].includes(type)) return `_kind = ${JSON.stringify(type.split(".")[1] === "histogram" ? "hist" : type.split(".")[1])}
_x = _column(${input}, ${params}.get("xColumn")) if str(${params}.get("xColumn", "")).strip() else None
_ys = _column_names(${input}, ${params}.get("yColumns", "")) or None
_args = {"kind": _kind, "x": _x, "y": _ys, "figsize": (float(${params}.get("figureWidth", 8)), float(${params}.get("figureHeight", 4.5))), "alpha": float(${params}.get("alpha", .8))}
if _kind == "hist": _args["bins"] = int(${params}.get("bins", 20))
_axis = ${input}.plot(**{key: value for key, value in _args.items() if value is not None})
_axis.set(title=${params}.get("title", ""), xlabel=${params}.get("xLabel", ""), ylabel=${params}.get("yLabel", "")); _axis.grid(bool(${params}.get("grid", True)))
${name} = _axis.get_figure()`;
  if (type === "plot.heatmap") return `_label_column = _column(${input}, ${params}.get("rowLabelColumn")) if str(${params}.get("rowLabelColumn", "")).strip() else None
_labels = ${input}[_label_column].astype(str).tolist() if _label_column is not None else [str(item) for item in ${input}.index]
_matrix = ${input}.drop(columns=[_label_column]) if _label_column is not None else ${input}
_matrix = _matrix.apply(pd.to_numeric, errors="coerce")
_figure, _axis = plt.subplots(figsize=(float(${params}.get("figureWidth", 9)), float(${params}.get("figureHeight", 6))))
_image = _axis.imshow(_matrix, aspect=${params}.get("aspect", "auto"), origin=${params}.get("origin", "lower"), interpolation=${params}.get("interpolation", "nearest"), cmap=${params}.get("colorMap", "viridis"), vmin=${params}.get("colorMin"), vmax=${params}.get("colorMax"))
_x_step, _y_step = max(1, int(${params}.get("xTickInterval", 1))), max(1, int(${params}.get("yTickInterval", 1)))
_x_positions, _y_positions = list(range(0, len(_matrix.columns), _x_step)), list(range(0, len(_labels), _y_step))
_axis.set_xticks(_x_positions, [str(_matrix.columns[index]) for index in _x_positions], rotation=float(${params}.get("xTickRotation", 45)), ha="right")
_axis.set_yticks(_y_positions, [_labels[index] for index in _y_positions])
_axis.set(title=${params}.get("title", ""), xlabel=${params}.get("xLabel", ""), ylabel=${params}.get("yLabel", ""))
if ${params}.get("showColorBar", True): _figure.colorbar(_image, ax=_axis).set_label(${params}.get("colorBarLabel", ""))
${name} = _figure`;
  if (type === "convert.to_text") return `${name} = json.dumps(${input}, ensure_ascii=False, indent=2, default=str) if isinstance(${input}, (dict, list, tuple)) else ${input}.to_string(index=False) if isinstance(${input}, pd.DataFrame) else str(${input})`;
  if (type === "convert.to_number") return `${name} = int(float(${input})) if ${params}.get("integer", False) else float(${input})`;
  if (type === "convert.to_boolean") return `${name} = str(${input}).strip().lower() in {"true", "1", "yes", "y", "是", "真"}`;
  if (type === "convert.to_table") return `${name} = pd.read_csv(io.StringIO(${input})) if ${params}.get("csvText", False) and isinstance(${input}, str) else ${input}.copy() if isinstance(${input}, pd.DataFrame) else pd.DataFrame(${input}) if isinstance(${input}, (dict, list, tuple)) else pd.DataFrame({"value": [${input}]})`;
  if (type === "convert.table_to_records") return `${name} = ${input}.to_dict(orient="records")`;
  if (type === "convert.table_to_csv") return `${name} = ${input}.to_csv(index=${params}.get("includeIndex", False), lineterminator="\\n")`;
  if (type === "convert.json_parse") return `${name} = json.loads(${input})`;
  if (type === "convert.json_stringify") return `${name} = json.dumps(${input}, ensure_ascii=False, indent=int(${params}.get("indent", 2)), default=str)`;
  if (type === "python.len") return `${name} = len(${input})`;
  if (type === "python.round") return `${name} = round(${input}, int(${params}.get("digits", 0)))`;
  if (type === "python.print") return `_print_value = ${input}
if isinstance(_print_value, bytes):
    _bytes_mode = ${params}.get("bytesFormat", "decode")
    _print_value = _print_value.hex(" ") if _bytes_mode == "hex" else base64.b64encode(_print_value).decode("ascii") if _bytes_mode == "base64" else repr(_print_value) if _bytes_mode == "repr" else _print_value.decode(${params}.get("encoding", "utf-8"), errors=${params}.get("encodingErrors", "replace"))
print(f"{${params}.get('prefix', '')}{'：' if ${params}.get('prefix', '') else ''}{_print_value}", end=${params}.get("end", ""))
${name} = ${input}`;
  if (type === "custom.python_function") {
    const code = String(node.data.parameters.code ?? "");
    const functionName = code.match(/def\s+([A-Za-z_]\w*)\s*\(/)?.[1] ?? "transform";
    return `${code}
${name} = ${functionName}(${input})`;
  }
  return `raise NotImplementedError(${JSON.stringify(`Notebook exporter does not support ${type} yet`)})`;
}

const PRELUDE = `from pathlib import Path
import io
import json
import base64
import re
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# 修改为本机文件；批量节点会读取列表中的全部 CSV。
input_files = [Path("replace-with-data.csv")]

def _columns(raw):
    if raw is None or str(raw).strip() == "": return None
    return [int(item) if str(item).strip().lstrip("-").isdigit() else str(item).strip() for item in str(raw).split(",")]

def _column(frame, raw):
    if raw is None or str(raw).strip() == "": return None
    return frame.columns[int(raw)] if str(raw).lstrip("-").isdigit() else raw

def _column_names(frame, raw):
    return [_column(frame, item.strip()) for item in str(raw).split(",") if item.strip()]

def calculate_ter(frame, params):
    vg_col, v_col, i_col = params.get("vgColumn", "Vg_V"), params.get("voltageColumn", "0"), params.get("currentColumn", "1")
    v_col, i_col = _column(frame, v_col), _column(frame, i_col)
    groups, all_steps, all_values = [], [], []
    for vg, group in frame.groupby(vg_col):
        v = pd.to_numeric(group[v_col], errors="coerce").to_numpy(float)
        i = pd.to_numeric(group[i_col], errors="coerce").to_numpy(float)
        valid = np.isfinite(v) & np.isfinite(i); v, i = v[valid], i[valid]
        steps = np.abs(np.diff(v)); all_steps.extend(steps[steps > 1e-12]); all_values.extend(v); groups.append((float(vg), v, i))
    step = float(params.get("vstep") or min(all_steps)); low = float(params.get("vmin") or min(all_values)); high = float(params.get("vmax") or max(all_values))
    tolerance = float(params.get("tolerance") or step / 20); floor = float(params.get("currentFloor", 1e-15))
    targets = np.r_[np.arange(low, -step / 2, step), np.arange(step, high + step / 2, step)]
    records = []
    for vg, v, current in groups:
        direction = np.zeros(len(v), dtype=int)
        for index in range(len(v)):
            if index > 0 and abs(v[index] - v[index - 1]) > tolerance: direction[index] = 1 if v[index] > v[index - 1] else -1
            elif index + 1 < len(v) and abs(v[index + 1] - v[index]) > tolerance: direction[index] = 1 if v[index + 1] > v[index] else -1
        for target in targets:
            matched = np.flatnonzero(np.abs(v - target) <= tolerance); up = matched[direction[matched] == 1]; down = matched[direction[matched] == -1]
            iu = float(current[up[0]]) if len(up) else np.nan; idown = float(current[down[0]]) if len(down) else np.nan
            ru = abs(target / iu) if np.isfinite(iu) and abs(iu) > floor else np.nan; rd = abs(target / idown) if np.isfinite(idown) and abs(idown) > floor else np.nan
            low_r, high_r = sorted((ru, rd)); ter = (high_r - low_r) / low_r * 100 if np.isfinite(low_r) and low_r else np.nan
            records.append({"Vg_V": vg, "Vds_V": float(target), "I_up_A": iu, "I_down_A": idown, "R_up_ohm": ru, "R_down_ohm": rd, "TER_percent": ter})
    return pd.DataFrame(records).sort_values(["Vg_V", "Vds_V"]).reset_index(drop=True)`;

export function serializeWorkflowNotebook(name: string, nodes: WorkflowNode[], edges: Edge[], requirements: string[] = []): string {
  const cells = [
    `# PyDroid Flow · ${name}\n# 这是可运行的 Python 脚本；# %% 标记可被 Jupyter/VS Code 识别为单元格。`,
    `# %% [setup]\n${requirements.length ? `# 安装额外依赖：python -m pip install ${requirements.join(" ")}\n` : ""}${PRELUDE}`,
    ...nodes.map((node) => {
      const name = variableName(node.id);
      const structure = {
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(node.extent ? { extent: node.extent } : {}),
        ...(node.style ? { style: node.style } : {}),
        ...(node.data.canvasParentId ? { canvasParentId: node.data.canvasParentId } : {}),
        ...(node.data.branch ? { branch: node.data.branch } : {}),
        ...(node.data.groupInputs?.length ? { groupInputs: node.data.groupInputs } : {}),
        ...(node.data.groupOutputs?.length ? { groupOutputs: node.data.groupOutputs } : {}),
      };
      return `# %% [node] ${node.id}
# pydroid-node-type: ${node.data.nodeType}
# pydroid-label: ${node.data.label.replace(/[\r\n]/g, " ")}
# pydroid-position: ${node.position.x},${node.position.y}
# pydroid-tags: ${(node.data.tags ?? []).join(",")}
# pydroid-structure: ${JSON.stringify(structure)}
${name}_params = ${pythonLiteral(node.data.parameters)}

${operationCode(node, edges, nodes)}`;
    }),
    `# %% [connections]\n${edges.map((edge) => `# connect ${edge.source}.${edge.sourceHandle ?? "output"} -> ${edge.target}.${edge.targetHandle ?? "input"}`).join("\n")}`,
  ];
  return `${cells.join("\n\n")}\n`;
}

export function parseWorkflowNotebook(source: string, name = "Python Notebook 工作流"): WorkflowDocument {
  const matches = [...source.matchAll(NODE_CELL)];
  if (!matches.length) throw new Error("没有找到 # %% [node] Python 单元格");
  const nodes: WorkflowNode[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const connectionsIndex = source.indexOf("# %% [connections]", match.index ?? 0);
    const bodyEnd = matches[index + 1]?.index ?? (connectionsIndex >= 0 ? connectionsIndex : source.length);
    const body = source.slice((match.index ?? 0) + match[0].length, bodyEnd);
    const nodeType = body.match(/^# pydroid-node-type: (.+)$/m)?.[1]?.trim();
    if (!nodeType) throw new Error(`节点 ${match[1]} 缺少 pydroid-node-type 注释`);
    const label = body.match(/^# pydroid-label: (.*)$/m)?.[1]?.trim() || nodeType;
    const position = body.match(/^# pydroid-position: (-?[\d.]+),(-?[\d.]+)$/m);
    const tags = body.match(/^# pydroid-tags: (.*)$/m)?.[1]?.split(",").map((item) => item.trim()).filter(Boolean);
    const structureLine = body.match(/^# pydroid-structure: (.*)$/m)?.[1]?.trim();
    const structure = structureLine ? JSON.parse(structureLine) as {
      parentId?: string; extent?: "parent"; style?: WorkflowNode["style"];
      canvasParentId?: string; branch?: "true" | "false" | "body";
      groupInputs?: WorkflowNode["data"]["groupInputs"];
      groupOutputs?: WorkflowNode["data"]["groupOutputs"];
    } : {};
    const assignment = body.indexOf(`${variableName(match[1].trim())}_params`);
    const parameters = parsePythonLiteral(balancedDictionary(body, assignment)) as WorkflowNode["data"]["parameters"];
    nodes.push({
      id: match[1].trim(), type: "workflow",
      position: { x: Number(position?.[1] ?? 0), y: Number(position?.[2] ?? 0) },
      ...(structure.parentId ? { parentId: structure.parentId } : {}),
      ...(structure.extent ? { extent: structure.extent } : {}),
      ...(structure.style ? { style: structure.style } : {}),
      data: {
        label, nodeType, nodeVersion: 1, parameters, status: "idle",
        ...(tags?.length ? { tags } : {}),
        ...(structure.canvasParentId ? { canvasParentId: structure.canvasParentId } : {}),
        ...(structure.branch ? { branch: structure.branch } : {}),
        ...(structure.groupInputs ? { groupInputs: structure.groupInputs } : {}),
        ...(structure.groupOutputs ? { groupOutputs: structure.groupOutputs } : {}),
      },
    });
  }
  const edges = [...source.matchAll(/^# connect ([^.\s]+)\.([^\s]+) -> ([^.\s]+)\.([^\s]+)$/gm)].map((match, index) => ({
    id: `code-edge-${index}`, source: match[1], sourceHandle: match[2], target: match[3], targetHandle: match[4],
  }));
  const requirementLine = source.match(/^# 安装额外依赖：python -m pip install (.+)$/m)?.[1];
  const requirements = requirementLine?.split(/\s+/).filter(Boolean) ?? [];
  return parseWorkflow(JSON.stringify({ schemaVersion: 1, name, nodes, edges, requirements }));
}

export function serializeJupyterNotebook(name: string, pythonSource: string): string {
  return serializeJupyterNotebookCells(name, splitWorkflowNotebookCells(pythonSource));
}

export function serializeJupyterNotebookCells(name: string, cells: NotebookCell[], notebookMetadata: Record<string, unknown> = {}): string {
  const importedMetadata = Object.keys(notebookMetadata).length > 0;
  return JSON.stringify({
    cells: cells.map((cell) => ({
      ...(cell.rawFields ?? {}),
      cell_type: cell.cellType,
      ...(cell.cellType === "code" ? {
        ...(cell.executionCount !== undefined ? { execution_count: cell.executionCount } : cell.rawFields ? {} : { execution_count: null }),
        outputs: cell.outputs ?? [],
      } : {}),
      metadata: cell.metadata ?? {},
      source: cell.source.split(/(?<=\n)/),
    })),
    metadata: {
      ...notebookMetadata,
      ...(!importedMetadata ? {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.12" },
        pydroid_flow: { name, schemaVersion: 1 },
      } : {}),
    },
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 2);
}
