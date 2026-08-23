import type { EditorSessionStore } from "../editor-core/session";
import type { PlatformAdapter } from "../platform/types";
import type { RuntimePreference } from "../runtime";
import { bindMcpCore, handleMcpCoreRequest, type McpExecutionBridge } from "./core-adapter";
import { jsonRpcError, type JsonRpcId } from "./protocol";

export type McpCoreHostOptions = {
  platform: PlatformAdapter;
  sessions: EditorSessionStore;
  activeWorkspaceId: () => string;
  execution: McpExecutionBridge;
};

const MAX_MCP_RESPONSE_BYTES = 4 * 1024 * 1024;

function requestId(raw: string): JsonRpcId {
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === "string" || typeof parsed.id === "number" ? parsed.id : null;
  } catch { return null; }
}

function serializeResponse(response: unknown): string {
  const serialized = JSON.stringify(response, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_MCP_RESPONSE_BYTES) {
    throw new Error("MCP response exceeds 4 MiB; use a narrower core_read path or data_preview");
  }
  return serialized;
}

export function attachMcpCoreHost(options: McpCoreHostOptions): () => void {
  const unbind = bindMcpCore({ sessions: options.sessions, activeWorkspaceId: options.activeWorkspaceId, execution: options.execution });
  const unsubscribe = options.platform.mcp.subscribeRequests((request) => {
    void (async () => {
      try {
        const response = await handleMcpCoreRequest(request.body, request.protocolVersion);
        await options.platform.mcp.respond(request.requestId, serializeResponse(response));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallback = jsonRpcError(requestId(request.body), -32603, "MCP Core response failed", message);
        try { await options.platform.mcp.respond(request.requestId, JSON.stringify(fallback)); }
        catch { /* host request already ended; do not leave an unhandled renderer rejection */ }
      }
    })();
  });
  return () => { unsubscribe(); unbind(); };
}

export function normalizeMcpRuntime(value: unknown, fallback: RuntimePreference): RuntimePreference {
  return value === "python" || value === "javascript" || value === "auto" ? value : fallback;
}
