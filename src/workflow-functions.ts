import type { Edge } from "@xyflow/react";
import type { PortSpec } from "./nodeCatalog";
import { cloneWorkflowSnapshot } from "./workflow-core/model";
import { flattenWorkflowGroups, type WorkflowFunctionDefinition, type WorkflowGroupPort, type WorkflowNode } from "./workflow";

function newId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function portSpecs(ports: WorkflowGroupPort[]): PortSpec[] {
  return ports.map((port) => ({ id: port.id, label: port.label, valueType: port.valueType, required: true }));
}

export function functionInputSpecs(definition: WorkflowFunctionDefinition): PortSpec[] { return portSpecs(definition.inputs); }
export function functionOutputSpecs(definition: WorkflowFunctionDefinition): PortSpec[] { return portSpecs(definition.outputs).map((port) => ({ ...port, required: undefined })); }

function descendantIds(groupId: string, nodes: WorkflowNode[]): Set<string> {
  const result = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      const parent = node.data.canvasParentId;
      if (node.id === groupId || !parent || result.has(node.id)) continue;
      if (parent === groupId || result.has(parent)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function resolveGroupPort(port: WorkflowGroupPort, direction: "input" | "output", nodeMap: Map<string, WorkflowNode>): WorkflowGroupPort {
  let current = { ...port };
  const visited = new Set<string>();
  for (let depth = 0; depth < 64; depth += 1) {
    const target = nodeMap.get(current.internalNodeId);
    if (!target || target.data.nodeType !== "workflow.group") return current;
    const key = `${target.id}:${direction}:${current.internalHandle ?? ""}`;
    if (visited.has(key)) throw new Error("组合接口存在循环映射，无法保存为函数");
    visited.add(key);
    const candidates = direction === "input" ? target.data.groupInputs ?? [] : target.data.groupOutputs ?? [];
    const nested = candidates.find((item) => item.id === current.internalHandle);
    if (!nested) throw new Error(`组合“${target.data.label}”缺少接口 ${current.internalHandle ?? ""}`);
    current = { ...current, internalNodeId: nested.internalNodeId, internalHandle: nested.internalHandle ?? null, valueType: nested.valueType };
  }
  throw new Error("组合嵌套层级过深，无法保存为函数");
}

export function createFunctionDefinitionFromGroup(
  groupId: string,
  nodes: WorkflowNode[],
  edges: Edge[],
  previous?: WorkflowFunctionDefinition,
): WorkflowFunctionDefinition {
  const group = nodes.find((node) => node.id === groupId && node.data.nodeType === "workflow.group");
  if (!group) throw new Error("请选择一个组合后再保存为函数");
  const members = descendantIds(groupId, nodes);
  if (!members.size) throw new Error("空组合不能保存为函数");
  const bodyNodes = cloneWorkflowSnapshot({ nodes: nodes.filter((node) => members.has(node.id)), edges: [] }).nodes;
  const bodyEdges = cloneWorkflowSnapshot({ nodes: [], edges: edges.filter((edge) => members.has(edge.source) && members.has(edge.target)) }).edges;
  const nodeMap = new Map(bodyNodes.map((node) => [node.id, node]));
  const inputs = (group.data.groupInputs ?? []).map((port) => resolveGroupPort(port, "input", nodeMap));
  const outputs = (group.data.groupOutputs ?? []).map((port) => resolveGroupPort(port, "output", nodeMap));
  if (!outputs.length) throw new Error("函数至少需要一个输出接口；请先为组合建立有效输出");
  const flat = flattenWorkflowGroups(bodyNodes, bodyEdges);
  const flatIds = new Set(flat.nodes.map((node) => node.id));
  for (const port of [...inputs, ...outputs]) {
    if (!flatIds.has(port.internalNodeId)) throw new Error(`函数接口 ${port.label} 指向不存在的内部节点`);
  }
  const cleanNodes = flat.nodes.map((node) => ({
    ...node,
    parentId: node.parentId && flatIds.has(node.parentId) ? node.parentId : undefined,
    data: { ...node.data, canvasParentId: undefined, status: "idle" as const },
    selected: false,
    className: undefined,
  }));
  return {
    id: previous?.id ?? newId("workflow-function"),
    name: group.data.label.trim() || previous?.name || "未命名函数",
    version: previous ? previous.version + 1 : 1,
    description: String(group.data.parameters.description ?? previous?.description ?? ""),
    inputs,
    outputs,
    nodes: cleanNodes,
    edges: flat.edges,
  };
}

export function createFunctionCallNode(
  definition: WorkflowFunctionDefinition,
  position: { x: number; y: number },
  canvasParentId?: string,
): WorkflowNode {
  return {
    id: newId("function-call"),
    type: "workflow",
    position,
    data: {
      label: definition.name,
      nodeType: "function.call",
      nodeVersion: 1,
      parameters: { functionId: definition.id, functionVersion: definition.version },
      status: "idle",
      canvasParentId,
      functionInputs: functionInputSpecs(definition),
      functionOutputs: functionOutputSpecs(definition),
    },
  };
}

export function synchronizeFunctionCalls(nodes: WorkflowNode[], definition: WorkflowFunctionDefinition): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.data.nodeType !== "function.call" || String(node.data.parameters.functionId ?? "") !== definition.id) return node;
    return {
      ...node,
      data: {
        ...node.data,
        label: definition.name,
        parameters: { ...node.data.parameters, functionVersion: definition.version },
        functionInputs: functionInputSpecs(definition),
        functionOutputs: functionOutputSpecs(definition),
      },
    };
  });
}

function synchronizeFunctionCallEdges(nodes: WorkflowNode[], edges: Edge[], target: WorkflowFunctionDefinition): Edge[] {
  const callIds = new Set(nodes.filter((node) => node.data.nodeType === "function.call" && String(node.data.parameters.functionId ?? "") === target.id).map((node) => node.id));
  if (!callIds.size) return edges;
  const inputIds = new Set(target.inputs.map((port) => port.id));
  const outputIds = new Set(target.outputs.map((port) => port.id));
  return edges.filter((edge) => {
    if (callIds.has(edge.target) && edge.targetHandle && !inputIds.has(edge.targetHandle)) return false;
    if (callIds.has(edge.source) && edge.sourceHandle && !outputIds.has(edge.sourceHandle)) return false;
    return true;
  });
}

export function synchronizeFunctionGraphCalls(nodes: WorkflowNode[], edges: Edge[], target: WorkflowFunctionDefinition): { nodes: WorkflowNode[]; edges: Edge[] } {
  const synchronizedNodes = synchronizeFunctionCalls(nodes, target);
  return { nodes: synchronizedNodes, edges: synchronizeFunctionCallEdges(synchronizedNodes, edges, target) };
}

export function synchronizeFunctionDefinitionCalls(definitions: WorkflowFunctionDefinition[], target: WorkflowFunctionDefinition): WorkflowFunctionDefinition[] {
  return definitions.map((definition) => {
    const synchronized = synchronizeFunctionGraphCalls(definition.nodes, definition.edges, target);
    return { ...definition, nodes: synchronized.nodes, edges: synchronized.edges };
  });
}

export function materializeFunctionAsGroup(
  definition: WorkflowFunctionDefinition,
  position: { x: number; y: number },
  canvasParentId?: string,
): { nodes: WorkflowNode[]; edges: Edge[]; groupId: string } {
  const groupId = newId("workflow-group");
  const idMap = new Map(definition.nodes.map((node) => [node.id, newId(node.data.nodeType.replaceAll(".", "-"))]));
  const minX = Math.min(0, ...definition.nodes.map((node) => node.position.x));
  const minY = Math.min(0, ...definition.nodes.map((node) => node.position.y));
  const group: WorkflowNode = {
    id: groupId,
    type: "workflow",
    position,
    data: {
      label: definition.name,
      nodeType: "workflow.group",
      nodeVersion: 1,
      parameters: { description: definition.description ?? "" },
      status: "idle",
      canvasParentId,
      functionSourceId: definition.id,
      groupInputs: definition.inputs.map((port) => ({ ...port, internalNodeId: idMap.get(port.internalNodeId) ?? port.internalNodeId })),
      groupOutputs: definition.outputs.map((port) => ({ ...port, internalNodeId: idMap.get(port.internalNodeId) ?? port.internalNodeId })),
    },
  };
  const nodes = definition.nodes.map((source) => ({
    ...cloneWorkflowSnapshot({ nodes: [source], edges: [] }).nodes[0],
    id: idMap.get(source.id)!,
    position: { x: source.position.x - minX + 40, y: source.position.y - minY + 60 },
    parentId: source.parentId ? idMap.get(source.parentId) : undefined,
    data: { ...source.data, canvasParentId: groupId, status: "idle" as const },
    selected: false,
  }));
  const edges = definition.edges.map((edge) => ({
    ...edge,
    id: newId("function-edge"),
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
  }));
  return { nodes: [...nodes, group], edges, groupId };
}

export function functionCallCount(nodes: WorkflowNode[], functionId: string): number {
  return nodes.filter((node) => node.data.nodeType === "function.call" && String(node.data.parameters.functionId ?? "") === functionId).length;
}
