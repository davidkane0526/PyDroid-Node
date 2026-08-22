import type { Connection, Edge } from "@xyflow/react";
import { areValueTypesCompatible } from "../nodeCatalog";
import type { WorkflowNode } from "../workflow";
import { nodeSpecForEditor } from "./workflow-structure";

export type EditorConnectionErrorCode = "missing-endpoint" | "missing-node" | "missing-port" | "incompatible-type" | "cycle";

export type EditorConnectionValidation = {
  valid: boolean;
  normalized?: Connection;
  code?: EditorConnectionErrorCode;
  message?: string;
};

export function normalizeEditorConnection(connection: Connection | Edge): Connection | null {
  if (!connection.source || !connection.target) return null;
  return {
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? "output",
    targetHandle: connection.targetHandle ?? "input",
  };
}

export function editorConnectionCreatesCycle(connection: Connection | Edge, edges: Edge[]): boolean {
  if (!connection.source || !connection.target) return true;
  if (connection.source === connection.target) return true;
  const downstream = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = downstream.get(edge.source) ?? [];
    targets.push(edge.target);
    downstream.set(edge.source, targets);
  }
  const pending = [connection.target];
  const visited = new Set<string>();
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (nodeId === connection.source) return true;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    pending.push(...(downstream.get(nodeId) ?? []));
  }
  return false;
}

export function validateEditorConnection(
  nodes: WorkflowNode[],
  edges: Edge[],
  connection: Connection | Edge,
  options: { excludeEdgeId?: string } = {},
): EditorConnectionValidation {
  const normalized = normalizeEditorConnection(connection);
  if (!normalized) return { valid: false, code: "missing-endpoint", message: "连线缺少起点或终点" };
  if (normalized.source === normalized.target) return { valid: false, normalized, code: "cycle", message: "该连线会形成环" };

  const sourceNode = nodes.find((node) => node.id === normalized.source);
  const targetNode = nodes.find((node) => node.id === normalized.target);
  if (!sourceNode || !targetNode) return { valid: false, normalized, code: "missing-node", message: "连线节点不存在" };

  const sourceSpec = nodeSpecForEditor(sourceNode);
  const targetSpec = nodeSpecForEditor(targetNode);
  const output = sourceSpec?.outputPorts.find((port) => port.id === normalized.sourceHandle);
  const input = targetSpec?.inputPorts.find((port) => port.id === normalized.targetHandle);
  if (!output || !input) return { valid: false, normalized, code: "missing-port", message: "端口不存在" };
  if (!areValueTypesCompatible(output.valueType, input.valueType)) {
    return {
      valid: false,
      normalized,
      code: "incompatible-type",
      message: `类型不兼容（${output.valueType} 不能连到 ${input.valueType}）`,
    };
  }

  const candidateEdges = options.excludeEdgeId ? edges.filter((edge) => edge.id !== options.excludeEdgeId) : edges;
  if (editorConnectionCreatesCycle(normalized, candidateEdges)) {
    return { valid: false, normalized, code: "cycle", message: "该连线会形成环" };
  }
  return { valid: true, normalized };
}
