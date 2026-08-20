import { deleteNodesFromGraph, disconnectEdgesFromGraph, disconnectNodesFromGraph } from "../workflow-core/commands";
import { cloneWorkflowSnapshot, type WorkflowSnapshot } from "../workflow-core/model";
import type { WorkflowFunctionDefinition, WorkflowNode } from "../workflow";
import {
  createFunctionCallNode,
  createFunctionDefinitionFromGroup,
  functionCallCount,
  materializeFunctionAsGroup,
  synchronizeFunctionDefinitionCalls,
  synchronizeFunctionGraphCalls,
} from "../workflow-functions";
import { deriveGroupInterface } from "./workflow-structure";

export type EditorGraphCommand =
  | { type: "delete-nodes"; nodeIds: string[] }
  | { type: "disconnect-nodes"; nodeIds: string[] }
  | { type: "disconnect-edges"; edgeIds: string[] }
  | { type: "create-group"; nodeIds: string[]; groupId: string; label: string; canvasId: string | null }
  | { type: "dissolve-group"; groupId: string }
  | { type: "save-group-as-function"; groupId: string }
  | { type: "insert-function-call"; definition: WorkflowFunctionDefinition; position: { x: number; y: number }; canvasId: string | null }
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
  if (command.type === "create-group") return createGroup(snapshot, command);
  if (command.type === "dissolve-group") return dissolveGroup(snapshot, command.groupId);
  if (command.type === "save-group-as-function") return saveGroupAsFunction(snapshot, command.groupId);
  if (command.type === "insert-function-call") return insertFunctionCall(snapshot, command);
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
