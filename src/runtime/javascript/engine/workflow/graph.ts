import { Table } from "../table";
import type { Workflow, WorkflowEdge, WorkflowNode } from "./types";

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

export function edgeValue(edge: WorkflowEdge, values: Map<string, Record<string, unknown>>): unknown {
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

export function nodeUpstream(nodeId: string, nodeType: string, workflow: Workflow, values: Map<string, Record<string, unknown>>): unknown {
  if (["table.concat", "logic.merge_rows"].includes(nodeType)) return upstreamTables(nodeId, workflow, values);
  if (["pulse.combine_channels", "pulse.segment_measurement", "custom.python_function", "ui.alert"].includes(nodeType)) {
    return upstreamInputs(nodeId, workflow, values);
  }
  return upstreamValue(nodeId, workflow, values);
}

export function requireTable(value: unknown, operation: string): Table {
  if (!(value instanceof Table)) throw new Error(`${operation} requires a table input`);
  return value;
}

export function loopBody(workflow: Workflow, loopId: string): { bodyNodes: WorkflowNode[]; backEdge: WorkflowEdge } {
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

export function allLoopBodyIds(workflow: Workflow): Set<string> {
  const result = new Set<string>();
  for (const node of workflow.nodes) {
    if (["logic.for_each_subflow", "logic.while_subflow"].includes(node.data.nodeType)) {
      try {
        const { bodyNodes } = loopBody(workflow, node.id);
        bodyNodes.forEach((item) => result.add(item.id));
      } catch {
        // The loop node reports malformed loop topology during execution.
      }
    }
  }
  return result;
}

export function containerChildren(workflow: Workflow, containerId: string, branch: string): WorkflowNode[] {
  const children = workflow.nodes.filter((node) => node.parentId === containerId && (node.data.branch ?? "body") === branch);
  return children.sort((a, b) => {
    const ax = Number(a.position?.x ?? 0);
    const bx = Number(b.position?.x ?? 0);
    const ay = Number(a.position?.y ?? 0);
    const by = Number(b.position?.y ?? 0);
    return ax - bx || ay - by;
  });
}

export function flattenWorkflowGroups(workflow: Workflow): Workflow {
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
