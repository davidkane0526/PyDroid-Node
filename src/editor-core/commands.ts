import { addEdge, reconnectEdge, type Connection } from "@xyflow/react";
import { deleteNodesFromGraph, disconnectEdgesFromGraph, disconnectNodesFromGraph } from "../workflow-core/commands";
import { cloneWorkflowSnapshot, type WorkflowSnapshot } from "../workflow-core/model";
import { getNodeSpec } from "../nodeCatalog";
import { resolveNodeSpec } from "../nodeSpec";
import type { WorkflowFunctionDefinition, WorkflowNode } from "../workflow";
import {
  createFunctionCallNode,
  createFunctionMapNode,
  createFunctionDefinitionFromGroup,
  functionCallCount,
  materializeFunctionAsGroup,
  synchronizeFunctionDefinitionCalls,
  synchronizeFunctionGraphCalls,
} from "../workflow-functions";
import { arrangeCanvasSnapshot, type EditorLayoutDirection } from "./layout";
import { validateEditorConnection } from "./connection";
import { deriveGroupInterface, nodeSpecForEditor } from "./workflow-structure";
import { isBoundaryStructureNodeType, isIfStructureNodeType, isVisualStructureNodeType } from "../workflow-structure-types";

export type EditorGraphCommand =
  | { type: "insert-node"; node: WorkflowNode }
  | { type: "duplicate-node"; sourceNodeId: string; duplicateId: string; offset?: { x: number; y: number }; labelSuffix?: string }
  | { type: "update-node-parameters"; nodeId: string; patch: Record<string, string | number | boolean | null> }
  | { type: "upsert-requirement"; requirement: string }
  | { type: "remove-requirement"; requirement: string }
  | { type: "update-node-label"; nodeId: string; label: string }
  | { type: "update-node-tags"; nodeId: string; tags: string[] }
  | { type: "update-group-port-label"; groupId: string; direction: "input" | "output"; portId: string; label: string }
  | { type: "apply-code-template"; nodeId: string; code: string }
  | { type: "replace-node"; nodeId: string; nextNodeType: string }
  | { type: "connect-edge"; connection: Connection }
  | { type: "reconnect-edge"; edgeId: string; connection: Connection }
  | { type: "commit-node-drag"; nodeId: string; position: { x: number; y: number }; parentId?: string | null }
  | { type: "arrange-canvas"; canvasId: string | null; viewportWidth: number; direction: EditorLayoutDirection }
  | { type: "delete-nodes"; nodeIds: string[] }
  | { type: "disconnect-nodes"; nodeIds: string[] }
  | { type: "disconnect-edges"; edgeIds: string[] }
  | { type: "disconnect-matching"; source?: string; target?: string }
  | { type: "create-group"; nodeIds: string[]; groupId: string; label: string; canvasId: string | null }
  | { type: "dissolve-group"; groupId: string }
  | { type: "save-group-as-function"; groupId: string }
  | { type: "insert-function-call"; definition: WorkflowFunctionDefinition; position: { x: number; y: number }; canvasId: string | null }
  | { type: "insert-function-map"; definition: WorkflowFunctionDefinition; position: { x: number; y: number }; canvasId: string | null }
  | { type: "materialize-function"; definition: WorkflowFunctionDefinition; position: { x: number; y: number }; canvasId: string | null }
  | { type: "delete-function"; functionId: string }
  | { type: "insert-resource"; nodes: WorkflowNode[]; edges: WorkflowSnapshot["edges"]; primaryNodeId: string };

export type EditorGraphCommandMeta = {
  primaryNodeId?: string | null;
  selectedNodeIds?: string[];
  createdNodeIds?: string[];
  functionDefinition?: WorkflowFunctionDefinition;
  blockedReason?: string;
  selectionMode?: boolean;
  removedEdgeCount?: number;
};

export type EditorGraphCommandResult = {
  snapshot: WorkflowSnapshot;
  changed: boolean;
  affectedCount: number;
  meta?: EditorGraphCommandMeta;
};

function unchanged(snapshot: WorkflowSnapshot, blockedReason?: string): EditorGraphCommandResult {
  return {
    snapshot,
    changed: false,
    affectedCount: 0,
    ...(blockedReason ? { meta: { blockedReason } } : {}),
  };
}

function requirementPackageName(requirement: string): string {
  return requirement.split(/[<>=~![]/, 1)[0].trim().toLocaleLowerCase();
}

function upsertRequirement(snapshot: WorkflowSnapshot, requirement: string): EditorGraphCommandResult {
  const normalized = requirement.trim();
  if (!normalized) return unchanged(snapshot, "依赖不能为空");
  const packageName = requirementPackageName(normalized);
  const current = snapshot.requirements ?? [];
  const next = [...current.filter((item) => requirementPackageName(item) !== packageName), normalized];
  if (current.length === next.length && current.every((item, index) => item === next[index])) return unchanged(snapshot);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), requirements: next },
    changed: true,
    affectedCount: 1,
  };
}

function removeRequirement(snapshot: WorkflowSnapshot, requirement: string): EditorGraphCommandResult {
  const current = snapshot.requirements ?? [];
  const next = current.filter((item) => item !== requirement);
  if (next.length === current.length) return unchanged(snapshot, "依赖不存在");
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), requirements: next },
    changed: true,
    affectedCount: 1,
  };
}

function insertNode(snapshot: WorkflowSnapshot, node: WorkflowNode): EditorGraphCommandResult {
  if (snapshot.nodes.some((item) => item.id === node.id)) return unchanged(snapshot, `节点 ID 已存在：${node.id}`);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes: [...snapshot.nodes, node] },
    changed: true,
    affectedCount: 1,
    meta: { primaryNodeId: node.id, selectedNodeIds: [node.id], createdNodeIds: [node.id] },
  };
}

function duplicateNode(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "duplicate-node" }>): EditorGraphCommandResult {
  const source = snapshot.nodes.find((node) => node.id === command.sourceNodeId);
  if (!source) return unchanged(snapshot, "待复制节点不存在");
  if (snapshot.nodes.some((node) => node.id === command.duplicateId)) return unchanged(snapshot, `节点 ID 已存在：${command.duplicateId}`);
  const [copy] = cloneWorkflowSnapshot({ nodes: [source], edges: [], functions: [], requirements: [] }).nodes;
  const offset = command.offset ?? { x: 40, y: 40 };
  const duplicate: WorkflowNode = {
    ...copy,
    id: command.duplicateId,
    selected: false,
    position: { x: source.position.x + offset.x, y: source.position.y + offset.y },
    data: { ...copy.data, status: "idle", label: `${source.data.label}${command.labelSuffix ?? " 副本"}` },
  };
  return insertNode(snapshot, duplicate);
}

function updateNodeParameters(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "update-node-parameters" }>): EditorGraphCommandResult {
  const source = snapshot.nodes.find((node) => node.id === command.nodeId);
  if (!source) return unchanged(snapshot, "待更新节点不存在");
  const nextParameters = { ...source.data.parameters, ...command.patch };
  const resolvedSpec = resolveNodeSpec(getNodeSpec(source.data.nodeType), nextParameters);
  for (const parameter of resolvedSpec?.parameters ?? []) {
    if (parameter.kind !== "select" || !parameter.options?.length || !(parameter.key in nextParameters)) continue;
    const currentValue = nextParameters[parameter.key];
    if (!parameter.options.some((option) => option.value === currentValue)) nextParameters[parameter.key] = parameter.options[0].value;
  }
  const changed = Object.keys(nextParameters).some((key) => source.data.parameters[key] !== nextParameters[key]);
  if (!changed) return unchanged(snapshot);
  const nodes = snapshot.nodes.map((node) => node.id === command.nodeId
    ? { ...node, data: { ...node.data, status: "idle" as const, parameters: nextParameters } }
    : node);
  const edges = snapshot.edges.filter((edge) => {
    if (edge.source !== command.nodeId && edge.target !== command.nodeId) return true;
    return validateEditorConnection(nodes, snapshot.edges, edge, { excludeEdgeId: edge.id }).valid;
  });
  const removedEdgeCount = snapshot.edges.length - edges.length;
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes, edges },
    changed: true,
    affectedCount: 1 + removedEdgeCount,
    meta: { primaryNodeId: command.nodeId, removedEdgeCount },
  };
}


function updateNodeLabel(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "update-node-label" }>): EditorGraphCommandResult {
  const node = snapshot.nodes.find((item) => item.id === command.nodeId);
  if (!node) return unchanged(snapshot, "待更新节点不存在");
  if (node.data.label === command.label) return unchanged(snapshot);
  return {
    snapshot: {
      ...cloneWorkflowSnapshot(snapshot),
      nodes: snapshot.nodes.map((item) => item.id === command.nodeId ? { ...item, data: { ...item.data, label: command.label } } : item),
    },
    changed: true,
    affectedCount: 1,
    meta: { primaryNodeId: command.nodeId },
  };
}

function updateNodeTags(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "update-node-tags" }>): EditorGraphCommandResult {
  const node = snapshot.nodes.find((item) => item.id === command.nodeId);
  if (!node) return unchanged(snapshot, "待更新节点不存在");
  const nextTags = [...new Set(command.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 6);
  const currentTags = node.data.tags ?? [];
  if (currentTags.length === nextTags.length && currentTags.every((tag, index) => tag === nextTags[index])) return unchanged(snapshot);
  return {
    snapshot: {
      ...cloneWorkflowSnapshot(snapshot),
      nodes: snapshot.nodes.map((item) => item.id === command.nodeId ? { ...item, data: { ...item.data, tags: nextTags } } : item),
    },
    changed: true,
    affectedCount: 1,
    meta: { primaryNodeId: command.nodeId },
  };
}

function updateGroupPortLabel(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "update-group-port-label" }>): EditorGraphCommandResult {
  const group = snapshot.nodes.find((item) => item.id === command.groupId && item.data.nodeType === "workflow.group");
  if (!group) return unchanged(snapshot, "组合不存在");
  const key = command.direction === "input" ? "groupInputs" : "groupOutputs";
  const ports = group.data[key] ?? [];
  if (!ports.some((port) => port.id === command.portId)) return unchanged(snapshot, "组合端口不存在");
  if (ports.find((port) => port.id === command.portId)?.label === command.label) return unchanged(snapshot);
  return {
    snapshot: {
      ...cloneWorkflowSnapshot(snapshot),
      nodes: snapshot.nodes.map((item) => item.id === command.groupId ? {
        ...item,
        data: { ...item.data, [key]: ports.map((port) => port.id === command.portId ? { ...port, label: command.label } : port) },
      } : item),
    },
    changed: true,
    affectedCount: 1,
    meta: { primaryNodeId: command.groupId },
  };
}

function applyCodeTemplate(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "apply-code-template" }>): EditorGraphCommandResult {
  const node = snapshot.nodes.find((item) => item.id === command.nodeId);
  if (!node) return unchanged(snapshot, "待应用模板的节点不存在");
  const incidentEdgeCount = snapshot.edges.filter((edge) => edge.source === command.nodeId || edge.target === command.nodeId).length;
  const nodes = snapshot.nodes.map((item) => item.id === command.nodeId ? {
    ...item,
    data: { ...item.data, status: "idle" as const, parameters: { code: command.code } },
  } : item);
  const edges = snapshot.edges.filter((edge) => edge.source !== command.nodeId && edge.target !== command.nodeId);
  const changed = node.data.parameters.code !== command.code || incidentEdgeCount > 0;
  if (!changed) return unchanged(snapshot);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes, edges },
    changed: true,
    affectedCount: 1 + incidentEdgeCount,
    meta: { primaryNodeId: command.nodeId, removedEdgeCount: incidentEdgeCount },
  };
}

function replaceNode(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "replace-node" }>): EditorGraphCommandResult {
  const source = snapshot.nodes.find((node) => node.id === command.nodeId);
  if (!source) return unchanged(snapshot, "待替换节点不存在");
  if (source.data.nodeType === "workflow.group") return unchanged(snapshot, "组合不能通过普通节点替换功能修改");
  const nextSpec = getNodeSpec(command.nextNodeType);
  if (!nextSpec) return unchanged(snapshot, `未知节点类型：${command.nextNodeType}`);
  const oldSpec = resolveNodeSpec(getNodeSpec(source.data.nodeType), source.data.parameters);
  const nextParameters = { ...nextSpec.defaults };
  for (const parameter of nextSpec.parameters) {
    if (parameter.key in source.data.parameters) nextParameters[parameter.key] = source.data.parameters[parameter.key];
  }
  const inputMap = new Map((oldSpec?.inputPorts ?? []).map((port, index) => [port.id, nextSpec.inputPorts[index]?.id]));
  const outputMap = new Map((oldSpec?.outputPorts ?? []).map((port, index) => [port.id, nextSpec.outputPorts[index]?.id]));
  const mappedEdges = snapshot.edges.flatMap((edge) => {
    if (edge.target === source.id) {
      const mapped = inputMap.get(edge.targetHandle ?? oldSpec?.inputPorts[0]?.id ?? "input");
      return mapped ? [{ ...edge, targetHandle: mapped }] : [];
    }
    if (edge.source === source.id) {
      const mapped = outputMap.get(edge.sourceHandle ?? oldSpec?.outputPorts[0]?.id ?? "output");
      return mapped ? [{ ...edge, sourceHandle: mapped }] : [];
    }
    return [edge];
  });
  const nextIsStructure = isVisualStructureNodeType(command.nextNodeType);
  const oldIsStructure = isVisualStructureNodeType(source.data.nodeType);
  const nodes = snapshot.nodes.map((node) => {
    if (node.id === source.id) return {
      ...node,
      style: nextIsStructure ? { width: 520, height: 300 } : undefined,
      data: { ...node.data, nodeType: command.nextNodeType, label: nextSpec.label, parameters: nextParameters, status: "idle" as const, branch: node.data.branch },
    };
    if (oldIsStructure && !nextIsStructure && node.parentId === source.id) return {
      ...node,
      parentId: undefined,
      extent: undefined,
      position: { x: source.position.x + node.position.x, y: source.position.y + node.position.y },
      data: { ...node.data, branch: undefined },
    };
    return node;
  });
  const edges = mappedEdges.filter((edge) => {
    if (edge.source !== source.id && edge.target !== source.id) return true;
    return validateEditorConnection(nodes, mappedEdges, edge, { excludeEdgeId: edge.id }).valid;
  });
  const removedEdgeCount = snapshot.edges.length - edges.length;
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes, edges },
    changed: source.data.nodeType !== command.nextNodeType || removedEdgeCount > 0,
    affectedCount: 1 + removedEdgeCount,
    meta: { primaryNodeId: source.id, selectedNodeIds: [source.id], removedEdgeCount },
  };
}

function connectEdge(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "connect-edge" }>): EditorGraphCommandResult {
  const validation = validateEditorConnection(snapshot.nodes, snapshot.edges, command.connection);
  if (!validation.valid || !validation.normalized) return unchanged(snapshot, validation.message ?? "无法连线");
  const target = snapshot.nodes.find((node) => node.id === validation.normalized!.target);
  const inputCount = nodeSpecForEditor(target)?.inputPorts.length ?? 1;
  const filtered = snapshot.edges.filter((edge) => {
    if (edge.target !== validation.normalized!.target) return true;
    return inputCount > 1 ? edge.targetHandle !== validation.normalized!.targetHandle : false;
  });
  const edges = addEdge(validation.normalized, filtered);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
    changed: true,
    affectedCount: 1 + (snapshot.edges.length - filtered.length),
    meta: { removedEdgeCount: snapshot.edges.length - filtered.length },
  };
}

function reconnectEditorEdge(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "reconnect-edge" }>): EditorGraphCommandResult {
  const oldEdge = snapshot.edges.find((edge) => edge.id === command.edgeId);
  if (!oldEdge) return unchanged(snapshot, "待移动的连线不存在");
  const validation = validateEditorConnection(snapshot.nodes, snapshot.edges, command.connection, { excludeEdgeId: command.edgeId });
  if (!validation.valid || !validation.normalized) return unchanged(snapshot, validation.message ?? "无法移动连线端点");
  const target = snapshot.nodes.find((node) => node.id === validation.normalized!.target);
  const inputCount = nodeSpecForEditor(target)?.inputPorts.length ?? 1;
  const baseEdges = snapshot.edges.filter((edge) => {
    if (edge.id === oldEdge.id || edge.target !== validation.normalized!.target) return true;
    return inputCount > 1 ? edge.targetHandle !== validation.normalized!.targetHandle : false;
  });
  const removedEdgeCount = snapshot.edges.length - baseEdges.length;
  const edges = reconnectEdge(oldEdge, validation.normalized, baseEdges);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
    changed: true,
    affectedCount: 1 + removedEdgeCount,
    meta: { removedEdgeCount },
  };
}


function commitNodeDrag(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "commit-node-drag" }>): EditorGraphCommandResult {
  const moved = snapshot.nodes.find((node) => node.id === command.nodeId);
  if (!moved) return unchanged(snapshot, "拖动节点不存在");
  if (isVisualStructureNodeType(moved.data.nodeType)) return unchanged(snapshot);
  const previousParent = command.parentId === undefined ? moved.parentId : (command.parentId ?? undefined);
  const parent = previousParent ? snapshot.nodes.find((node) => node.id === previousParent) : undefined;
  const absolute = previousParent
    ? { x: command.position.x + (parent?.position.x ?? 0), y: command.position.y + (parent?.position.y ?? 0) }
    : command.position;
  const canvasId = moved.data.canvasParentId ?? null;
  const container = snapshot.nodes.find((candidate) => {
    if (candidate.id === moved.id || !isVisualStructureNodeType(candidate.data.nodeType)) return false;
    if ((candidate.data.canvasParentId ?? null) !== canvasId) return false;
    const width = Number(candidate.measured?.width ?? candidate.width ?? candidate.style?.width ?? 520);
    const height = Number(candidate.measured?.height ?? candidate.height ?? candidate.style?.height ?? 300);
    const boundaryZone = isBoundaryStructureNodeType(candidate.data.nodeType);
    return absolute.x > candidate.position.x + 12 && absolute.x < candidate.position.x + width - 100
      && absolute.y > candidate.position.y + (boundaryZone ? 88 : 58) && absolute.y < candidate.position.y + height - (boundaryZone ? 78 : 28);
  });
  const nodes = snapshot.nodes.map((node) => {
    if (node.id !== moved.id) return node;
    if (!container) return {
      ...node,
      parentId: undefined,
      extent: undefined,
      expandParent: undefined,
      position: absolute,
      data: { ...node.data, branch: undefined },
    };
    const relative = { x: Math.max(26, absolute.x - container.position.x), y: Math.max(104, absolute.y - container.position.y) };
    const branch: WorkflowNode["data"]["branch"] = isIfStructureNodeType(container.data.nodeType)
      ? (relative.x < Number(container.measured?.width ?? container.style?.width ?? 520) / 2 ? "true" : "false")
      : "body";
    return { ...node, parentId: container.id, extent: "parent" as const, expandParent: true, position: relative, data: { ...node.data, branch } };
  }).sort((left, right) => Number(Boolean(left.parentId)) - Number(Boolean(right.parentId)));
  const nextMoved = nodes.find((node) => node.id === moved.id)!;
  const changed = nextMoved.parentId !== moved.parentId
    || nextMoved.position.x !== moved.position.x
    || nextMoved.position.y !== moved.position.y
    || nextMoved.data.branch !== moved.data.branch;
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes },
    changed,
    affectedCount: changed ? 1 : 0,
    meta: { primaryNodeId: moved.id },
  };
}

function createGroup(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "create-group" }>): EditorGraphCommandResult {
  const selected = new Set(command.nodeIds);
  const members = snapshot.nodes.filter((node) => selected.has(node.id) && (node.data.canvasParentId ?? null) === command.canvasId);
  if (members.length < 2) return unchanged(snapshot, "组合至少需要两个位于同一画布的节点");
  if (snapshot.nodes.some((node) => node.id === command.groupId)) return unchanged(snapshot, `组合 ID 已存在：${command.groupId}`);

  const memberIds = new Set(members.map((node) => node.id));
  const incoming = snapshot.edges.filter((edge) => !memberIds.has(edge.source) && memberIds.has(edge.target));
  const outgoing = snapshot.edges.filter((edge) => memberIds.has(edge.source) && !memberIds.has(edge.target));
  const { groupInputs, groupOutputs } = deriveGroupInterface(members, snapshot.edges);
  const group: WorkflowNode = {
    id: command.groupId,
    type: "workflow",
    position: {
      x: Math.min(...members.map((node) => node.position.x)),
      y: Math.min(...members.map((node) => node.position.y)),
    },
    data: {
      label: command.label,
      nodeType: "workflow.group",
      nodeVersion: 1,
      status: "idle",
      parameters: { description: "" },
      canvasParentId: command.canvasId ?? undefined,
      groupInputs,
      groupOutputs,
    },
  };
  const nodes = snapshot.nodes
    .map((node) => memberIds.has(node.id)
      ? { ...node, selected: false, data: { ...node.data, canvasParentId: command.groupId } }
      : node)
    .concat(group);
  const edges = snapshot.edges.map((edge) => {
    if (incoming.some((item) => item.id === edge.id)) {
      const port = groupInputs.find((item) => item.internalNodeId === edge.target && item.internalHandle === (edge.targetHandle ?? "input"));
      return port ? { ...edge, target: command.groupId, targetHandle: port.id } : edge;
    }
    if (outgoing.some((item) => item.id === edge.id)) {
      const port = groupOutputs.find((item) => item.internalNodeId === edge.source && item.internalHandle === (edge.sourceHandle ?? "output"));
      return port ? { ...edge, source: command.groupId, sourceHandle: port.id } : edge;
    }
    return edge;
  });
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes, edges },
    changed: true,
    affectedCount: members.length,
    meta: { primaryNodeId: command.groupId, selectedNodeIds: [command.groupId], createdNodeIds: [command.groupId], selectionMode: false },
  };
}

function dissolveGroup(snapshot: WorkflowSnapshot, groupId: string): EditorGraphCommandResult {
  const group = snapshot.nodes.find((node) => node.id === groupId && node.data.nodeType === "workflow.group");
  if (!group) return unchanged(snapshot, "组合不存在");
  const parentCanvasId = group.data.canvasParentId;
  const inputPorts = new Map((group.data.groupInputs ?? []).map((port) => [port.id, port]));
  const outputPorts = new Map((group.data.groupOutputs ?? []).map((port) => [port.id, port]));
  const edges = snapshot.edges.flatMap((edge) => {
    if (edge.target === groupId) {
      const port = inputPorts.get(edge.targetHandle ?? "");
      return port ? [{ ...edge, target: port.internalNodeId, targetHandle: port.internalHandle ?? undefined }] : [];
    }
    if (edge.source === groupId) {
      const port = outputPorts.get(edge.sourceHandle ?? "");
      return port ? [{ ...edge, source: port.internalNodeId, sourceHandle: port.internalHandle ?? undefined }] : [];
    }
    return [edge];
  });
  const childIds = snapshot.nodes.filter((node) => node.data.canvasParentId === groupId).map((node) => node.id);
  const nodes = snapshot.nodes
    .filter((node) => node.id !== groupId)
    .map((node) => node.data.canvasParentId === groupId
      ? { ...node, data: { ...node.data, canvasParentId: parentCanvasId } }
      : node);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes, edges },
    changed: true,
    affectedCount: childIds.length + 1,
    meta: { primaryNodeId: null, selectedNodeIds: [], selectionMode: false },
  };
}

function saveGroupAsFunction(snapshot: WorkflowSnapshot, groupId: string): EditorGraphCommandResult {
  const group = snapshot.nodes.find((node) => node.id === groupId && node.data.nodeType === "workflow.group");
  if (!group) return unchanged(snapshot, "请选择一个组合后再保存为函数");
  const functions = snapshot.functions ?? [];
  const previous = group.data.functionSourceId
    ? functions.find((definition) => definition.id === group.data.functionSourceId)
    : undefined;
  const definition = createFunctionDefinitionFromGroup(groupId, snapshot.nodes, snapshot.edges, previous);
  const base = previous
    ? functions.map((item) => item.id === previous.id ? definition : item)
    : [definition, ...functions];
  const synchronizedDefinitions = synchronizeFunctionDefinitionCalls(base, definition);
  const markedNodes = snapshot.nodes.map((node) => node.id === groupId
    ? { ...node, data: { ...node.data, functionSourceId: definition.id } }
    : node);
  const synchronizedRoot = synchronizeFunctionGraphCalls(markedNodes, snapshot.edges, definition);
  return {
    snapshot: {
      ...cloneWorkflowSnapshot(snapshot),
      nodes: synchronizedRoot.nodes,
      edges: synchronizedRoot.edges,
      functions: synchronizedDefinitions,
    },
    changed: true,
    affectedCount: 1,
    meta: { functionDefinition: definition, primaryNodeId: groupId, selectedNodeIds: [groupId] },
  };
}

function insertFunctionCall(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "insert-function-call" }>): EditorGraphCommandResult {
  const call = createFunctionCallNode(command.definition, command.position, command.canvasId ?? undefined);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes: [...snapshot.nodes, call] },
    changed: true,
    affectedCount: 1,
    meta: { primaryNodeId: call.id, selectedNodeIds: [call.id], createdNodeIds: [call.id] },
  };
}

function insertFunctionMap(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "insert-function-map" }>): EditorGraphCommandResult {
  const map = createFunctionMapNode(command.definition, command.position, command.canvasId ?? undefined);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes: [...snapshot.nodes, map] },
    changed: true,
    affectedCount: 1,
    meta: { primaryNodeId: map.id, selectedNodeIds: [map.id], createdNodeIds: [map.id] },
  };
}

function materializeFunction(snapshot: WorkflowSnapshot, command: Extract<EditorGraphCommand, { type: "materialize-function" }>): EditorGraphCommandResult {
  const materialized = materializeFunctionAsGroup(command.definition, command.position, command.canvasId ?? undefined);
  return {
    snapshot: {
      ...cloneWorkflowSnapshot(snapshot),
      nodes: [...snapshot.nodes, ...materialized.nodes],
      edges: [...snapshot.edges, ...materialized.edges],
    },
    changed: true,
    affectedCount: materialized.nodes.length,
    meta: {
      primaryNodeId: materialized.groupId,
      selectedNodeIds: [materialized.groupId],
      createdNodeIds: materialized.nodes.map((node) => node.id),
    },
  };
}

function deleteFunction(snapshot: WorkflowSnapshot, functionId: string): EditorGraphCommandResult {
  const functions = snapshot.functions ?? [];
  const definition = functions.find((item) => item.id === functionId);
  if (!definition) return unchanged(snapshot, "函数不存在");
  const rootCalls = functionCallCount(snapshot.nodes, functionId);
  if (rootCalls > 0) return unchanged(snapshot, `“${definition.name}”仍有 ${rootCalls} 个调用节点，请先删除或展开这些调用`);
  const nestedCalls = functions.reduce((count, item) => item.id === functionId ? count : count + functionCallCount(item.nodes, functionId), 0);
  if (nestedCalls > 0) return unchanged(snapshot, `“${definition.name}”仍被其他函数调用 ${nestedCalls} 次，无法删除`);
  const nodes = snapshot.nodes.map((node) => node.data.functionSourceId === functionId
    ? { ...node, data: { ...node.data, functionSourceId: undefined } }
    : node);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes, functions: functions.filter((item) => item.id !== functionId) },
    changed: true,
    affectedCount: 1,
  };
}

export function applyEditorGraphCommand(snapshot: WorkflowSnapshot, command: EditorGraphCommand): EditorGraphCommandResult {
  if (command.type === "insert-node") return insertNode(snapshot, command.node);
  if (command.type === "duplicate-node") return duplicateNode(snapshot, command);
  if (command.type === "update-node-parameters") return updateNodeParameters(snapshot, command);
  if (command.type === "upsert-requirement") return upsertRequirement(snapshot, command.requirement);
  if (command.type === "remove-requirement") return removeRequirement(snapshot, command.requirement);
  if (command.type === "update-node-label") return updateNodeLabel(snapshot, command);
  if (command.type === "update-node-tags") return updateNodeTags(snapshot, command);
  if (command.type === "update-group-port-label") return updateGroupPortLabel(snapshot, command);
  if (command.type === "apply-code-template") return applyCodeTemplate(snapshot, command);
  if (command.type === "replace-node") return replaceNode(snapshot, command);
  if (command.type === "connect-edge") return connectEdge(snapshot, command);
  if (command.type === "reconnect-edge") return reconnectEditorEdge(snapshot, command);
  if (command.type === "commit-node-drag") return commitNodeDrag(snapshot, command);
  if (command.type === "arrange-canvas") {
    const arranged = arrangeCanvasSnapshot(snapshot, command.canvasId, command.viewportWidth, command.direction);
    return { snapshot: cloneWorkflowSnapshot(arranged), changed: true, affectedCount: arranged.nodes.filter((node) => (node.data.canvasParentId ?? null) === command.canvasId).length };
  }
  if (command.type === "delete-nodes") {
    const next = deleteNodesFromGraph(snapshot.nodes, snapshot.edges, command.nodeIds);
    return {
      snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes: next.nodes, edges: next.edges },
      changed: next.removedIds.size > 0,
      affectedCount: next.removedIds.size,
    };
  }
  if (command.type === "disconnect-nodes") {
    const edges = disconnectNodesFromGraph(snapshot.edges, command.nodeIds);
    return {
      snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
      changed: edges.length !== snapshot.edges.length,
      affectedCount: snapshot.edges.length - edges.length,
    };
  }
  if (command.type === "disconnect-edges") {
    const edges = disconnectEdgesFromGraph(snapshot.edges, command.edgeIds);
    return {
      snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
      changed: edges.length !== snapshot.edges.length,
      affectedCount: snapshot.edges.length - edges.length,
    };
  }
  if (command.type === "disconnect-matching") {
    const edges = snapshot.edges.filter((edge) => !((!command.source || edge.source === command.source) && (!command.target || edge.target === command.target)));
    return {
      snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
      changed: edges.length !== snapshot.edges.length,
      affectedCount: snapshot.edges.length - edges.length,
      ...(edges.length === snapshot.edges.length ? { meta: { blockedReason: "没有找到要断开的连线" } } : {}),
    };
  }
  if (command.type === "create-group") return createGroup(snapshot, command);
  if (command.type === "dissolve-group") return dissolveGroup(snapshot, command.groupId);
  if (command.type === "save-group-as-function") return saveGroupAsFunction(snapshot, command.groupId);
  if (command.type === "insert-function-call") return insertFunctionCall(snapshot, command);
  if (command.type === "insert-function-map") return insertFunctionMap(snapshot, command);
  if (command.type === "materialize-function") return materializeFunction(snapshot, command);
  if (command.type === "delete-function") return deleteFunction(snapshot, command.functionId);
  const existingIds = new Set(snapshot.nodes.map((node) => node.id));
  const incomingIds = new Set(command.nodes.map((node) => node.id));
  if (incomingIds.size !== command.nodes.length || command.nodes.some((node) => existingIds.has(node.id))) {
    return unchanged(snapshot, "资源实例包含重复节点 ID");
  }
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes: [...snapshot.nodes, ...command.nodes], edges: [...snapshot.edges, ...command.edges] },
    changed: command.nodes.length > 0 || command.edges.length > 0,
    affectedCount: command.nodes.length,
    meta: { primaryNodeId: command.primaryNodeId, selectedNodeIds: [command.primaryNodeId], createdNodeIds: command.nodes.map((node) => node.id) },
  };
}
