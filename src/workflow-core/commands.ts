import type { Edge } from "@xyflow/react";
import type { WorkflowNode } from "../workflow";

export function upstreamSubgraph(nodes: WorkflowNode[], edges: Edge[], targetNodeIds: Iterable<string>): { nodes: WorkflowNode[]; edges: Edge[] } {
  const included = new Set<string>(targetNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (included.has(edge.target) && !included.has(edge.source)) {
        included.add(edge.source);
        changed = true;
      }
    }
    for (const node of nodes) {
      const parent = node.parentId ?? node.data.canvasParentId;
      if (parent && included.has(node.id) && !included.has(parent)) {
        included.add(parent);
        changed = true;
      }
    }
  }
  return {
    nodes: nodes.filter((node) => included.has(node.id)),
    edges: edges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
  };
}

export function deleteNodesFromGraph(nodes: WorkflowNode[], edges: Edge[], initialIds: Iterable<string>): { nodes: WorkflowNode[]; edges: Edge[]; removedIds: Set<string> } {
  const removedIds = new Set(initialIds);
  for (let changed = removedIds.size > 0; changed;) {
    changed = false;
    for (const node of nodes) {
      const parent = node.parentId ?? node.data.canvasParentId;
      if (parent && removedIds.has(parent) && !removedIds.has(node.id)) {
        removedIds.add(node.id);
        changed = true;
      }
    }
  }
  if (!removedIds.size) return { nodes, edges, removedIds };
  return {
    nodes: nodes.filter((node) => !removedIds.has(node.id)),
    edges: edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
    removedIds,
  };
}

export function disconnectNodesFromGraph(edges: Edge[], nodeIds: Iterable<string>): Edge[] {
  const ids = new Set(nodeIds);
  if (!ids.size) return edges;
  return edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
}

export function disconnectEdgesFromGraph(edges: Edge[], edgeIds: Iterable<string>): Edge[] {
  const ids = new Set(edgeIds);
  if (!ids.size) return edges;
  return edges.filter((edge) => !ids.has(edge.id));
}
