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

export function nodeExecutionSubgraph(nodes: WorkflowNode[], edges: Edge[], targetNodeId: string): { nodes: WorkflowNode[]; edges: Edge[] } {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target) return { nodes: [], edges: [] };
  const memberIds = target.data.nodeType === "workflow.group"
    ? nodes.filter((node) => node.parentId === targetNodeId || node.data.canvasParentId === targetNodeId).map((node) => node.id)
    : [];
  // A group is a canvas/interface construct; its executable content lives in
  // the member nodes.  For a normal node the node itself is the execution
  // target.  Upstream traversal intentionally includes visual Notebook order
  // edges as well, so a scoped run receives imports/constants/definitions that
  // form its preceding interactive context. Runtimes still ignore those edges
  // as data inputs.
  let slice = upstreamSubgraph(nodes, edges, memberIds.length ? memberIds : [targetNodeId]);
  const targetAncestorIds = new Set<string>();
  let ancestorId = target.parentId ?? target.data.canvasParentId;
  while (ancestorId) {
    targetAncestorIds.add(ancestorId);
    const ancestor = nodes.find((node) => node.id === ancestorId);
    ancestorId = ancestor?.parentId ?? ancestor?.data.canvasParentId;
  }
  // A downstream node may depend on a group's public output.  The ordinary
  // upstream graph then contains the group interface but not its hidden member
  // implementation.  Expand such ancestor groups so scoped execution remains
  // executable.  Do not expand the siblings of a child that the user clicked
  // *inside* its own group; that would turn "run this node" into "run group".
  for (let pass = 0; pass <= nodes.length; pass += 1) {
    const included = new Set(slice.nodes.map((node) => node.id));
    const missingMembers = slice.nodes
      .filter((node) => node.data.nodeType === "workflow.group" && (node.id === targetNodeId || !targetAncestorIds.has(node.id)))
      .flatMap((group) => nodes.filter((node) => node.parentId === group.id || node.data.canvasParentId === group.id).map((node) => node.id))
      .filter((id) => !included.has(id));
    if (!missingMembers.length) break;
    slice = upstreamSubgraph(nodes, edges, [...included, ...missingMembers]);
  }
  return slice;
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
