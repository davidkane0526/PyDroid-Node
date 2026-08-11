import type { Edge, Node } from "@xyflow/react";

export const WORKFLOW_SCHEMA_VERSION = 1;

export type NodeStatus = "idle" | "running" | "success" | "error";

export type WorkflowNodeData = {
  label: string;
  nodeType: string;
  nodeVersion: number;
  parameters: Record<string, string | number | boolean | null>;
  status: NodeStatus;
};

export type WorkflowNode = Node<WorkflowNodeData>;

export type WorkflowDocument = {
  schemaVersion: number;
  name: string;
  nodes: WorkflowNode[];
  edges: Edge[];
};

export function serializeWorkflow(
  name: string,
  nodes: WorkflowNode[],
  edges: Edge[],
): WorkflowDocument {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    name,
    nodes,
    edges,
  };
}

export function parseWorkflow(text: string): WorkflowDocument {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") {
    throw new Error("工作流文件必须是JSON对象");
  }
  const document = value as Partial<WorkflowDocument>;
  if (document.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`不支持的工作流版本：${String(document.schemaVersion)}`);
  }
  if (typeof document.name !== "string" || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new Error("工作流缺少name、nodes或edges");
  }
  const ids = new Set<string>();
  for (const node of document.nodes) {
    if (!node || typeof node.id !== "string" || !node.data || typeof node.data.nodeType !== "string") {
      throw new Error("工作流包含无效节点");
    }
    if (ids.has(node.id)) throw new Error(`节点ID重复：${node.id}`);
    ids.add(node.id);
  }
  for (const edge of document.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error("工作流连线引用了不存在的节点");
    }
  }
  return document as WorkflowDocument;
}
