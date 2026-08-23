import { APP_VERSION } from "../app-version";
import type { EditorGraphCommand, EditorGraphCommandResult } from "../editor-core/commands";
import type { EditorSessionStore, EditorWorkspaceSession } from "../editor-core/session";
import { getNodeContract, listNodeContracts } from "../nodeContract";
import { getNodeSpec, NODE_CATALOG } from "../nodeCatalog";
import { getWorkspaceExecutionResult } from "../execution-workspace";
import { parseWorkflow, serializeWorkflow, type WorkflowDocument, type WorkflowNode } from "../workflow";
import type { RuntimePreference } from "../runtime";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol";
import { MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, MCP_TOOLS, isSupportedMcpProtocolVersion, jsonRpcError, jsonRpcResult, mcpResultMetadata } from "./protocol";

export type McpExecutionBridge = {
  run(session: EditorWorkspaceSession, runtime: RuntimePreference, timeoutMs?: number): Promise<unknown>;
  stop(session: EditorWorkspaceSession): Promise<boolean> | boolean;
  status(session: EditorWorkspaceSession): unknown;
  runtimes(): unknown[];
  preference(): RuntimePreference;
  setPreference(preference: RuntimePreference): void;
};

export type McpCoreBinding = {
  sessions: EditorSessionStore;
  activeWorkspaceId: () => string;
  execution: McpExecutionBridge;
};

let binding: McpCoreBinding | null = null;

export function bindMcpCore(next: McpCoreBinding): () => void {
  binding = next;
  return () => { if (binding === next) binding = null; };
}

function requireBinding(): McpCoreBinding {
  if (!binding) throw new Error("PyDroid Core is not bound to MCP");
  return binding;
}

function objectArg(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("args must be an object");
  return value as Record<string, unknown>;
}

function stringArg(value: unknown, name: string, fallback?: string): string {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function runtimeArg(value: unknown, fallback: RuntimePreference): RuntimePreference {
  if (value == null) return fallback;
  if (value === "auto" || value === "python" || value === "javascript") return value;
  throw new Error("runtime must be auto, python, or javascript");
}

function sessionFor(workspaceId?: unknown): EditorWorkspaceSession {
  const current = requireBinding();
  const id = typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : current.activeWorkspaceId();
  const session = current.sessions.get(id);
  if (!session) throw new Error(`Workspace does not exist: ${id}`);
  return session;
}

function workflowDocument(session: EditorWorkspaceSession): WorkflowDocument {
  const snapshot = session.getRuntimeState().snapshot;
  return serializeWorkflow(
    session.id,
    structuredClone(snapshot.nodes),
    structuredClone(snapshot.edges),
    [...(snapshot.requirements ?? [])],
    structuredClone(snapshot.functions ?? []),
    structuredClone(snapshot.environment ?? { pythonImports: [], pythonDefinitions: [] }),
    structuredClone(snapshot.parameters ?? []),
  );
}

function parseWorkflowValue(value: unknown): WorkflowDocument {
  if (typeof value === "string") return parseWorkflow(value);
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error("workflow must be a workflow JSON object or string");
  return parseWorkflow(serialized);
}

function replaceWorkflow(session: EditorWorkspaceSession, value: unknown): { workspaceId: string; nodeCount: number; edgeCount: number } {
  const document = parseWorkflowValue(value);
  session.replaceSnapshot({
    nodes: document.nodes,
    edges: document.edges,
    functions: document.functions,
    requirements: document.requirements,
    environment: document.environment,
    parameters: document.parameters,
  }, { captureHistory: true, resetView: true });
  return { workspaceId: session.id, nodeCount: document.nodes.length, edgeCount: document.edges.length };
}

function makeNode(nodeType: string, args: Record<string, unknown>): WorkflowNode {
  const spec = getNodeSpec(nodeType);
  if (!spec) throw new Error(`Unknown node type: ${nodeType}`);
  const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : `${nodeType.replace(/[^a-z0-9]+/gi, "-")}-${Date.now().toString(36)}`;
  const rawPosition = objectArg(args.position);
  const x = Number(rawPosition.x ?? 80);
  const y = Number(rawPosition.y ?? 80);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("position.x and position.y must be finite numbers");
  const parameters = objectArg(args.parameters);
  const allowedParameters = Object.fromEntries(Object.entries(parameters).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))) as Record<string, string | number | boolean | null>;
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      label: typeof args.label === "string" && args.label.trim() ? args.label.trim() : spec.label,
      nodeType,
      nodeVersion: spec.nodeVersion ?? 1,
      parameters: { ...spec.defaults, ...allowedParameters },
      status: "idle",
    },
  };
}

function applyCommand(session: EditorWorkspaceSession, command: EditorGraphCommand): { changed: boolean; affectedCount: number; meta: EditorGraphCommandResult["meta"] | null } {
  const result = session.applyGraphCommand(command);
  if (!result.changed && result.meta?.blockedReason) throw new Error(result.meta.blockedReason);
  return { changed: result.changed, affectedCount: result.affectedCount, meta: result.meta ?? null };
}

function validateSelection(session: EditorWorkspaceSession, ids: string[]): void {
  const available = new Set(session.getRuntimeState().snapshot.nodes.map((node) => node.id));
  const missing = ids.filter((id) => !available.has(id));
  if (missing.length) throw new Error(`Unknown selected node ids: ${missing.join(", ")}`);
}

async function runCoreCommand(command: string, args: Record<string, unknown>, workspaceId?: unknown): Promise<unknown> {
  const current = requireBinding();
  const session = sessionFor(workspaceId);
  switch (command) {
    case "workflow.replace": return replaceWorkflow(session, args.workflow);
    case "workflow.validate": {
      const document = parseWorkflowValue(args.workflow);
      return { valid: true, schemaVersion: document.schemaVersion, nodeCount: document.nodes.length, edgeCount: document.edges.length };
    }
    case "node.add": {
      const node = makeNode(stringArg(args.nodeType, "nodeType"), args);
      return { ...applyCommand(session, { type: "insert-node", node }), nodeId: node.id };
    }
    case "node.remove": {
      const ids = Array.isArray(args.nodeIds) ? args.nodeIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
      if (!ids.length) throw new Error("nodeIds must contain at least one node id");
      return applyCommand(session, { type: "delete-nodes", nodeIds: ids });
    }
    case "node.updateParameters": {
      const patch = objectArg(args.patch);
      const normalized = Object.fromEntries(Object.entries(patch).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))) as Record<string, string | number | boolean | null>;
      return applyCommand(session, { type: "update-node-parameters", nodeId: stringArg(args.nodeId, "nodeId"), patch: normalized });
    }
    case "node.connect": {
      const source = stringArg(args.source, "source");
      const target = stringArg(args.target, "target");
      return applyCommand(session, { type: "connect-edge", connection: { source, target, sourceHandle: typeof args.sourceHandle === "string" ? args.sourceHandle : null, targetHandle: typeof args.targetHandle === "string" ? args.targetHandle : null } });
    }
    case "node.disconnect": {
      const ids = Array.isArray(args.edgeIds) ? args.edgeIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
      if (!ids.length) throw new Error("edgeIds must contain at least one edge id");
      return applyCommand(session, { type: "disconnect-edges", edgeIds: ids });
    }
    case "function.register": {
      const definition = objectArg(args.definition);
      const id = stringArg(definition.id, "definition.id");
      const document = workflowDocument(session);
      const functions = [...document.functions.filter((item) => item.id !== id), definition];
      const validated = parseWorkflowValue({ ...document, functions });
      session.replaceSnapshot({
        nodes: validated.nodes, edges: validated.edges, functions: validated.functions, requirements: validated.requirements, environment: validated.environment, parameters: validated.parameters,
      }, { captureHistory: true, resetView: false });
      return { functionId: id, registered: true, version: validated.functions.find((item) => item.id === id)?.version ?? null };
    }
    case "function.remove": return applyCommand(session, { type: "delete-function", functionId: stringArg(args.functionId, "functionId") });
    case "editor.select": {
      const selectedNodeIds = Array.isArray(args.nodeIds) ? args.nodeIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
      validateSelection(session, selectedNodeIds);
      const primaryNodeId = args.primaryNodeId == null ? selectedNodeIds[0] ?? null : stringArg(args.primaryNodeId, "primaryNodeId");
      if (primaryNodeId && !selectedNodeIds.includes(primaryNodeId)) throw new Error("primaryNodeId must be included in nodeIds");
      session.patchViewState({ selectedNodeIds, primaryNodeId, selectionMode: selectedNodeIds.length > 1 });
      return session.getViewState();
    }
    case "runtime.setPreference": {
      const preference = runtimeArg(args.runtime, current.execution.preference());
      current.execution.setPreference(preference);
      return { runtimePreference: preference };
    }
    case "execution.stop": return { stopped: await current.execution.stop(session) };
    default: throw new Error(`Unknown Core command: ${command}`);
  }
}

function executionState(session: EditorWorkspaceSession): { status: unknown; result: unknown; errors: Array<{ phase: string; message: string }> } {
  const current = requireBinding();
  const status = current.execution.status(session);
  const result = getWorkspaceExecutionResult(session.identity);
  const phase = typeof status === "object" && status !== null && typeof (status as { phase?: unknown }).phase === "string"
    ? (status as { phase: string }).phase
    : "";
  const message = typeof status === "object" && status !== null && typeof (status as { message?: unknown }).message === "string"
    ? (status as { message: string }).message
    : "";
  const errors = (phase === "failed" || phase === "timeout") && message
    ? [{ phase, message }]
    : [];
  const resultSummary = result ? {
    status: result.status,
    runtimeId: result.runtimeId ?? null,
    preview: result.preview ? { columns: result.preview.columns, totalRows: result.preview.totalRows, totalColumns: result.preview.totalColumns } : null,
    nodeResultIds: Object.keys(result.nodeResults ?? {}),
    executionOrder: result.executionOrder ?? [],
    nodeTimingsMs: result.nodeTimingsMs ?? {},
    exportCount: result.exports?.length ?? 0,
    hasExportCsv: Boolean(result.exportCsv),
    hasPlot: Boolean(result.plotPngBase64 || result.plotChart),
  } : null;
  return { status, result: resultSummary, errors };
}

function dataPreview(session: EditorWorkspaceSession, limitValue: unknown): unknown {
  const limit = Math.max(1, Math.min(100, Number(limitValue ?? 20) || 20));
  const runtime = session.getRuntimeState();
  const result = getWorkspaceExecutionResult(session.identity);
  const preview = result?.preview ? {
    columns: result.preview.columns,
    rows: result.preview.rows.slice(0, limit),
    totalRows: result.preview.totalRows,
    totalColumns: result.preview.totalColumns,
  } : null;
  return {
    workspaceId: session.id,
    input: {
      fileName: runtime.input?.fileName ?? null,
      csvBytes: runtime.input?.csvBytes?.byteLength ?? 0,
      csvFiles: runtime.input?.csvFiles.map((file) => ({ name: file.name, bytes: file.bytes.byteLength })) ?? [],
      csvTextLength: runtime.input?.csvText.length ?? 0,
    },
    result: result ? { runtimeId: result.runtimeId, status: result.status, preview, nodeResultIds: Object.keys(result.nodeResults ?? {}) } : null,
  };
}

function readPath(path: string, session: EditorWorkspaceSession): unknown {
  const current = requireBinding();
  const snapshot = session.getRuntimeState().snapshot;
  switch (path) {
    case "workflow": return workflowDocument(session);
    case "workflow.nodes": return structuredClone(snapshot.nodes);
    case "workflow.edges": return structuredClone(snapshot.edges);
    case "workflow.functions": return structuredClone(snapshot.functions ?? []);
    case "workflow.requirements": return [...(snapshot.requirements ?? [])];
    case "workflow.environment": return structuredClone(snapshot.environment ?? { pythonImports: [], pythonDefinitions: [] });
    case "workflow.parameters": return structuredClone(snapshot.parameters ?? []);
    case "editor": return session.getViewState();
    case "editor.selection": return { primaryNodeId: session.getViewState().primaryNodeId, selectedNodeIds: session.getViewState().selectedNodeIds };
    case "runtime": return { preference: current.execution.preference(), runtimes: current.execution.runtimes() };
    case "execution": return executionState(session);
    case "data": return dataPreview(session, 20);
    case "node.contracts": return listNodeContracts();
    case "node.catalog": return NODE_CATALOG;
    default: throw new Error(`Unsupported Core path: ${path}`);
  }
}

export function describeMcpCore(): unknown {
  const current = requireBinding();
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    supportedProtocolVersions: MCP_PROTOCOL_VERSIONS,
    activeWorkspaceId: current.activeWorkspaceId(),
    paths: ["workflow", "workflow.nodes", "workflow.edges", "workflow.functions", "workflow.requirements", "workflow.environment", "workflow.parameters", "editor", "editor.selection", "runtime", "execution", "data", "node.contracts", "node.catalog"],
    commands: ["workflow.replace", "workflow.validate", "node.add", "node.remove", "node.updateParameters", "node.connect", "node.disconnect", "function.register", "function.remove", "editor.select", "runtime.setPreference", "execution.stop"],
    patchCommands: ["insert-node", "duplicate-node", "update-node-parameters", "upsert-requirement", "remove-requirement", "update-node-label", "update-node-tags", "update-group-port-label", "apply-code-template", "replace-node", "connect-edge", "reconnect-edge", "commit-node-drag", "arrange-canvas", "delete-nodes", "disconnect-nodes", "disconnect-edges", "disconnect-matching", "create-group", "dissolve-group", "save-group-as-function", "insert-function-call", "materialize-function", "delete-function", "insert-resource"],
    tools: MCP_TOOLS.map((tool) => tool.name),
  };
}

export async function callMcpTool(name: string, argsValue: unknown): Promise<unknown> {
  const args = objectArg(argsValue);
  const session = name === "core_describe" ? null : sessionFor(args.workspaceId);
  switch (name) {
    case "core_describe": return describeMcpCore();
    case "core_read": return { path: stringArg(args.path, "path"), workspaceId: session!.id, value: readPath(stringArg(args.path, "path"), session!) };
    case "core_command": return { command: stringArg(args.command, "command"), workspaceId: session!.id, result: await runCoreCommand(stringArg(args.command, "command"), objectArg(args.args), session!.id) };
    case "core_patch": {
      const operations = Array.isArray(args.operations) ? args.operations : [];
      if (!operations.length) throw new Error("operations must contain at least one EditorGraphCommand");
      const results = [];
      for (const operation of operations) results.push(applyCommand(session!, operation as EditorGraphCommand));
      return { workspaceId: session!.id, applied: operations.length, results, workflow: workflowDocument(session!) };
    }
    case "core_run":
    case "workflow_run": {
      const current = requireBinding();
      const runtime = runtimeArg(args.runtime, current.execution.preference());
      const timeoutMs = args.timeoutMs == null ? undefined : Number(args.timeoutMs);
      if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("timeoutMs must be a positive number");
      const result = await current.execution.run(session!, runtime, timeoutMs);
      return { workspaceId: session!.id, runtime, result };
    }
    case "workflow_stop": return { workspaceId: session!.id, stopped: await requireBinding().execution.stop(session!) };
    case "core_snapshot": {
      const current = requireBinding();
      return {
        workspaceId: session!.id,
        workflow: workflowDocument(session!),
        editor: session!.getViewState(),
        runtime: { preference: current.execution.preference(), runtimes: current.execution.runtimes() },
        execution: executionState(session!),
        data: dataPreview(session!, 20),
        nodeContracts: listNodeContracts(),
      };
    }
    case "node_contract": {
      const nodeType = stringArg(args.nodeType, "nodeType");
      const contract = getNodeContract(nodeType);
      const spec = getNodeSpec(nodeType);
      if (!contract && !spec) throw new Error(`Unknown node type: ${nodeType}`);
      return { nodeType, contract: contract ?? null, spec: spec ?? null };
    }
    case "data_preview": return dataPreview(session!, args.limit);
    default: throw new Error(`Unknown MCP tool: ${name}`);
  }
}

function parseRequest(raw: string): JsonRpcRequest {
  const value = JSON.parse(raw) as Partial<JsonRpcRequest>;
  if (value.jsonrpc !== "2.0" || typeof value.method !== "string") throw new Error("Invalid JSON-RPC request");
  return value as JsonRpcRequest;
}

export async function handleMcpCoreRequest(raw: string, protocolVersionHeader = ""): Promise<JsonRpcResponse> {
  let request: JsonRpcRequest;
  try { request = parseRequest(raw); }
  catch (error) { return jsonRpcError(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)); }
  const id = request.id ?? null;

  if (request.method === "initialize") {
    const requestedVersion = typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : "";
    if (!requestedVersion) return jsonRpcError(id, -32602, "initialize requires params.protocolVersion");
    if (!isSupportedMcpProtocolVersion(requestedVersion)) {
      return jsonRpcError(id, -32019, `Unsupported protocol version: ${requestedVersion}`, { supported: MCP_PROTOCOL_VERSIONS });
    }
    return jsonRpcResult(id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "PyDroid Node", version: APP_VERSION },
    });
  }

  if (protocolVersionHeader && !isSupportedMcpProtocolVersion(protocolVersionHeader)) {
    return jsonRpcError(id, -32019, `Unsupported protocol version: ${protocolVersionHeader}`, { supported: MCP_PROTOCOL_VERSIONS });
  }

  try {
    if (request.method === "ping") return jsonRpcResult(id, {});
    if (request.method === "tools/list") {
      return jsonRpcResult(id, { tools: MCP_TOOLS });
    }
    if (request.method === "tools/call") {
      const name = stringArg(request.params?.name, "params.name");
      if (!MCP_TOOLS.some((tool) => tool.name === name)) return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const toolArguments = request.params?.arguments ?? {};
        const structuredContent = await callMcpTool(name, toolArguments);
        const readPath = toolArguments && typeof toolArguments === "object" && !Array.isArray(toolArguments)
          ? String((toolArguments as Record<string, unknown>).path ?? "")
          : "";
        const text = name === "core_snapshot"
          ? "PyDroid Core snapshot returned in structuredContent."
          : name === "core_read"
            ? `PyDroid Core path ${readPath} returned in structuredContent.`
            : "PyDroid Core tool completed; structured result is available in structuredContent.";
        return jsonRpcResult(id, {
          content: [{ type: "text", text }],
          structuredContent,
          _meta: mcpResultMetadata(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonRpcResult(id, {
          content: [{ type: "text", text: message }],
          structuredContent: { error: message },
          isError: true,
          _meta: mcpResultMetadata(),
        });
      }
    }
    return jsonRpcError(id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    return jsonRpcError(id, -32603, "Internal error", error instanceof Error ? error.message : String(error));
  }
}
