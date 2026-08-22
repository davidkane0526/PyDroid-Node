import type { Edge } from "@xyflow/react";
import { resolveNodeSpec } from "../customNode";
import { getNodeSpec, type NodeSpec } from "../nodeCatalog";
import type { WorkflowGroupPort, WorkflowNode } from "../workflow";

export function nodeSpecForEditor(node: WorkflowNode | undefined): NodeSpec | undefined {
  if (!node) return undefined;
  if (node.data.nodeType === "function.call" || node.data.nodeType === "function.map") {
    return {
      nodeType: node.data.nodeType,
      nodeVersion: 1,
      label: node.data.label,
      category: "自定义",
      defaults: {},
      parameters: [],
      inputPorts: node.data.functionInputs ?? [],
      outputPorts: node.data.functionOutputs ?? [],
      runtimeSupport: ["python", "javascript"],
      executionModel: "function",
      functionRole: "call",
      deterministic: false,
      cachePolicy: "uncacheable",
    };
  }
  if (node.data.nodeType !== "workflow.group") {
    return resolveNodeSpec(getNodeSpec(node.data.nodeType), node.data.parameters);
  }
  return {
    nodeType: "workflow.group",
    nodeVersion: 1,
    label: node.data.label,
    category: "逻辑控制",
    defaults: { description: "" },
    parameters: [{ key: "description", label: "说明", kind: "textarea" }],
    inputPorts: node.data.groupInputs ?? [],
    outputPorts: node.data.groupOutputs ?? [],
    runtimeSupport: ["python", "javascript"],
    executionModel: "workflow",
    deterministic: false,
    cachePolicy: "uncacheable",
  };
}

export function deriveGroupInterface(
  members: WorkflowNode[],
  allEdges: Edge[],
): { groupInputs: WorkflowGroupPort[]; groupOutputs: WorkflowGroupPort[] } {
  const memberIds = new Set(members.map((node) => node.id));
  const internalEdges = allEdges.filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target));
  const incomingEdges = allEdges.filter((edge) => !memberIds.has(edge.source) && memberIds.has(edge.target));
  const outgoingEdges = allEdges.filter((edge) => memberIds.has(edge.source) && !memberIds.has(edge.target));
  const targeted = new Set(internalEdges.map((edge) => `${edge.target}\u0000${edge.targetHandle ?? "input"}`));
  const sourced = new Set(internalEdges.map((edge) => `${edge.source}\u0000${edge.sourceHandle ?? "output"}`));
  const inputCandidates = [
    ...incomingEdges.map((edge) => ({ nodeId: edge.target, handle: edge.targetHandle ?? "input" })),
    ...members.flatMap((node) => (nodeSpecForEditor(node)?.inputPorts ?? [])
      .filter((port) => !targeted.has(`${node.id}\u0000${port.id}`))
      .map((port) => ({ nodeId: node.id, handle: port.id }))),
  ];
  const outputCandidates = [
    ...outgoingEdges.map((edge) => ({ nodeId: edge.source, handle: edge.sourceHandle ?? "output" })),
    ...members.flatMap((node) => (nodeSpecForEditor(node)?.outputPorts ?? [])
      .filter((port) => !sourced.has(`${node.id}\u0000${port.id}`))
      .map((port) => ({ nodeId: node.id, handle: port.id }))),
  ];
  const unique = (items: Array<{ nodeId: string; handle: string }>) => [
    ...new Map(items.map((item) => [`${item.nodeId}\u0000${item.handle}`, item])).values(),
  ];
  const groupInputs = unique(inputCandidates).map(({ nodeId, handle }, index) => {
    const node = members.find((item) => item.id === nodeId);
    const port = nodeSpecForEditor(node)?.inputPorts.find((item) => item.id === handle);
    return {
      id: `input-${index + 1}`,
      label: port?.label || node?.data.label || `输入 ${index + 1}`,
      valueType: port?.valueType ?? "any",
      internalNodeId: nodeId,
      internalHandle: handle,
    } satisfies WorkflowGroupPort;
  });
  const groupOutputs = unique(outputCandidates).map(({ nodeId, handle }, index) => {
    const node = members.find((item) => item.id === nodeId);
    const port = nodeSpecForEditor(node)?.outputPorts.find((item) => item.id === handle);
    return {
      id: `output-${index + 1}`,
      label: port?.label || node?.data.label || `输出 ${index + 1}`,
      valueType: port?.valueType ?? "any",
      internalNodeId: nodeId,
      internalHandle: handle,
    } satisfies WorkflowGroupPort;
  });
  return { groupInputs, groupOutputs };
}

export function repairWorkflowGroupInterfaces(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.data.nodeType !== "workflow.group") return node;
    const members = nodes.filter((candidate) => candidate.data.canvasParentId === node.id);
    if (!members.length || (node.data.groupInputs?.length && node.data.groupOutputs?.length)) return node;
    const derived = deriveGroupInterface(members, edges);
    return {
      ...node,
      data: {
        ...node.data,
        groupInputs: node.data.groupInputs?.length ? node.data.groupInputs : derived.groupInputs,
        groupOutputs: node.data.groupOutputs?.length ? node.data.groupOutputs : derived.groupOutputs,
      },
    };
  });
}
