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
