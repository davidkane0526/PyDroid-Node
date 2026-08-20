import type { Edge } from "@xyflow/react";
import { cloneWorkflowSnapshot } from "../workflow-core/model";
import type { WorkflowNode } from "../workflow";
import { repairWorkflowGroupInterfaces } from "./workflow-structure";

export type CapturedNodeResource = {
  node: WorkflowNode;
};

export type CapturedGroupResource = {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: Edge[];
};

export type InstantiatedResource = {
  nodes: WorkflowNode[];
  edges: Edge[];
  primaryNodeId: string;
};

export function captureNodeResource(source: WorkflowNode): CapturedNodeResource {
  const node = cloneWorkflowSnapshot({ nodes: [source], edges: [] }).nodes[0];
  node.data = { ...node.data, canvasParentId: undefined, status: "idle" };
  node.parentId = undefined;
  node.extent = undefined;
  node.selected = false;
  node.className = undefined;
  return { node };
}

export function captureGroupResource(groupId: string, nodes: WorkflowNode[], edges: Edge[]): CapturedGroupResource {
  const group = nodes.find((node) => node.id === groupId && node.data.nodeType === "workflow.group");
  if (!group) throw new Error("请选择一个组合");
  const memberIds = new Set(nodes.filter((node) => node.data.canvasParentId === groupId).map((node) => node.id));
  if (!memberIds.size) throw new Error("空组合不能保存为资源");
  const capturedNodes = cloneWorkflowSnapshot({
    nodes: nodes.filter((node) => node.id === groupId || memberIds.has(node.id)),
    edges: [],
  }).nodes.map((node) => ({ ...node, selected: false, className: undefined, data: { ...node.data, status: "idle" as const } }));
  const capturedEdges = cloneWorkflowSnapshot({
    nodes: [],
    edges: edges.filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target)),
  }).edges;
  return {
    name: group.data.label,
    description: String(group.data.parameters.description ?? ""),
    nodes: capturedNodes,
    edges: capturedEdges,
  };
}

export function instantiateNodeResource(
  template: CapturedNodeResource,
  options: { id: string; position: { x: number; y: number }; canvasId: string | null },
): InstantiatedResource {
  const node = captureNodeResource(template.node).node;
  node.id = options.id;
  node.position = options.position;
  node.data = { ...node.data, canvasParentId: options.canvasId ?? undefined, status: "idle" };
  return { nodes: [node], edges: [], primaryNodeId: node.id };
}

export function instantiateGroupResource(
  template: CapturedGroupResource,
  options: {
    position: { x: number; y: number };
    canvasId: string | null;
    idFactory: (sourceId: string) => string;
    name?: string;
  },
): InstantiatedResource {
  const repairedTemplate = { ...template, nodes: repairWorkflowGroupInterfaces(template.nodes, template.edges) };
  const sourceGroup = repairedTemplate.nodes.find((node) => node.data.nodeType === "workflow.group");
  if (!sourceGroup) throw new Error("该组合资源已损坏");
  const mapping = new Map(repairedTemplate.nodes.map((node) => [node.id, options.idFactory(node.id)]));
  const targetGroupId = mapping.get(sourceGroup.id)!;
  const offset = {
    x: options.position.x - sourceGroup.position.x,
    y: options.position.y - sourceGroup.position.y,
  };
  const nodes: WorkflowNode[] = repairedTemplate.nodes.map((source) => {
    const node = cloneWorkflowSnapshot({ nodes: [source], edges: [] }).nodes[0];
    return {
      ...node,
      id: mapping.get(source.id)!,
      selected: false,
      className: undefined,
      position: { x: source.position.x + offset.x, y: source.position.y + offset.y },
      data: {
        ...node.data,
        label: source.id === sourceGroup.id ? (options.name ?? template.name) : node.data.label,
        canvasParentId: source.id === sourceGroup.id ? options.canvasId ?? undefined : targetGroupId,
        groupInputs: node.data.groupInputs?.map((port) => ({ ...port, internalNodeId: mapping.get(port.internalNodeId) ?? port.internalNodeId })),
        groupOutputs: node.data.groupOutputs?.map((port) => ({ ...port, internalNodeId: mapping.get(port.internalNodeId) ?? port.internalNodeId })),
        status: "idle" as const,
      },
    };
  });
  const edges = repairedTemplate.edges.map((edge) => ({
    ...edge,
    id: options.idFactory(edge.id),
    source: mapping.get(edge.source) ?? edge.source,
    target: mapping.get(edge.target) ?? edge.target,
  }));
  return { nodes, edges, primaryNodeId: targetGroupId };
}
