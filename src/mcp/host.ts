import type { EditorSessionStore } from "../editor-core";
import type { PlatformAdapter } from "../platform/types";
import type { RuntimePreference } from "../runtime";
import { bindMcpCore, handleMcpCoreRequest, type McpExecutionBridge } from "./core-adapter";

export type McpCoreHostOptions = {
  platform: PlatformAdapter;
  sessions: EditorSessionStore;
  activeWorkspaceId: () => string;
  execution: McpExecutionBridge;
};

export function attachMcpCoreHost(options: McpCoreHostOptions): () => void {
  const unbind = bindMcpCore({ sessions: options.sessions, activeWorkspaceId: options.activeWorkspaceId, execution: options.execution });
  const unsubscribe = options.platform.mcp.subscribeRequests(async (request) => {
    const response = await handleMcpCoreRequest(request.body, request.protocolVersion);
    await options.platform.mcp.respond(request.requestId, JSON.stringify(response));
  });
  return () => { unsubscribe(); unbind(); };
}

export function normalizeMcpRuntime(value: unknown, fallback: RuntimePreference): RuntimePreference {
  return value === "python" || value === "javascript" || value === "auto" ? value : fallback;
}
