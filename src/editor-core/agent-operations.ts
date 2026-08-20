import type { AgentOperation } from "../agent";
import { getNodeSpec } from "../nodeCatalog";
import type { WorkflowNode } from "../workflow";
import { applyEditorGraphCommand, type EditorGraphCommand } from "./commands";
import type { EditorWorkspaceSession } from "./session";

export type AgentEditorApplyOptions = {
  canvasId: string | null;
  viewportWidth: number;
  createNode: (id: string, nodeType: string, x: number, y: number, parameters: Record<string, string | number | boolean | null>) => WorkflowNode;
  isAllowed?: (operation: AgentOperation) => boolean;
};

export type AgentEditorApplyResult = {
  changed: boolean;
  appliedOperations: number;
  runRequested: boolean;
  requestedDirection: "horizontal" | "vertical" | null;
  snapshot: ReturnType<EditorWorkspaceSession["getRuntimeState"]>["snapshot"];
};

function isAgentValue(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function assertSafeId(id: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error(`${label} ID 不安全：${id}`);
}

export function applyAgentOperationsToSession(session: EditorWorkspaceSession, operations: AgentOperation[], options: AgentEditorApplyOptions): AgentEditorApplyResult {
  let draft = session.getRuntimeState().snapshot;
  const commands: EditorGraphCommand[] = [];
  let runRequested = false;
  let requestedDirection: "horizontal" | "vertical" | null = null;

  const stage = (command: EditorGraphCommand) => {
    const result = applyEditorGraphCommand(draft, command);
    if (!result.changed && result.meta?.blockedReason) throw new Error(result.meta.blockedReason);
    if (result.changed) draft = result.snapshot;
    commands.push(command);
  };

  for (const operation of operations) {
    if (options.isAllowed && !options.isAllowed(operation)) throw new Error(`AI 操作未获授权：${operation.type}`);
    if (operation.type === "run_workflow") {
      runRequested = true;
      continue;
    }
    if (operation.type === "arrange") {
      requestedDirection = operation.direction;
      continue;
    }
    if (operation.type === "add_node") {
      assertSafeId(operation.id, "节点");
      if (draft.nodes.some((node) => node.id === operation.id)) throw new Error(`节点 ID 已存在：${operation.id}`);
      const spec = getNodeSpec(operation.nodeType);
      if (!spec) throw new Error(`未知节点类型：${operation.nodeType}`);
      const parameters = operation.parameters ?? {};
      for (const [key, value] of Object.entries(parameters)) {
        if (!spec.parameters.some((parameter) => parameter.key === key) || !isAgentValue(value)) throw new Error(`节点 ${operation.id} 的参数无效：${key}`);
      }
      const x = Number.isFinite(operation.x) ? Math.max(-10000, Math.min(10000, Number(operation.x))) : 80 + (draft.nodes.length % 5) * 210;
      const y = Number.isFinite(operation.y) ? Math.max(-10000, Math.min(10000, Number(operation.y))) : 80 + Math.floor(draft.nodes.length / 5) * 140;
      const created = options.createNode(operation.id, operation.nodeType, x, y, parameters);
      if (operation.label?.trim()) created.data.label = operation.label.trim().slice(0, 80);
      created.data.canvasParentId = options.canvasId ?? undefined;
      stage({ type: "insert-node", node: created });
      continue;
    }
    if (operation.type === "set_parameter") {
      if (!isAgentValue(operation.value)) throw new Error(`参数值无效：${operation.key}`);
      const target = draft.nodes.find((node) => node.id === operation.nodeId);
      const spec = target ? getNodeSpec(target.data.nodeType) : undefined;
      if (!target) throw new Error(`找不到节点：${operation.nodeId}`);
      if (!spec?.parameters.some((parameter) => parameter.key === operation.key)) throw new Error(`节点 ${operation.nodeId} 不支持参数：${operation.key}`);
      stage({ type: "update-node-parameters", nodeId: operation.nodeId, patch: { [operation.key]: operation.value } });
      continue;
    }
    if (operation.type === "connect") {
      stage({ type: "connect-edge", connection: { source: operation.source, target: operation.target, sourceHandle: operation.sourceHandle ?? "output", targetHandle: operation.targetHandle ?? "input" } });
      continue;
    }
    if (operation.type === "disconnect") {
      if (!operation.nodeId && !operation.source && !operation.target) throw new Error("disconnect 至少需要 nodeId、source 或 target");
      if (operation.nodeId) stage({ type: "disconnect-nodes", nodeIds: [operation.nodeId] });
      else stage({ type: "disconnect-matching", source: operation.source, target: operation.target });
      continue;
    }
    if (operation.type === "group_nodes") {
      assertSafeId(operation.id, "组合");
      stage({ type: "create-group", nodeIds: operation.nodeIds, groupId: operation.id, label: operation.label.trim() || "AI 组合", canvasId: options.canvasId });
      continue;
    }
    if (operation.type === "delete_node") {
      if (!draft.nodes.some((node) => node.id === operation.nodeId)) throw new Error(`找不到节点：${operation.nodeId}`);
      stage({ type: "delete-nodes", nodeIds: [operation.nodeId] });
      continue;
    }
  }

  if (requestedDirection) stage({ type: "arrange-canvas", canvasId: options.canvasId, viewportWidth: options.viewportWidth, direction: requestedDirection });
  const committed = session.applyGraphCommandBatch(commands);
  if (!committed.changed && committed.meta?.blockedReason) throw new Error(committed.meta.blockedReason);
  return {
    changed: committed.changed,
    appliedOperations: operations.length,
    runRequested,
    requestedDirection,
    snapshot: session.getRuntimeState().snapshot,
  };
}
