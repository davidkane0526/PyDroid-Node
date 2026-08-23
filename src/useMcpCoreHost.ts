import { useEffect, useState } from "react";
import { cancelActiveExecution, executeWorkflow, executeWorkflowWithRuntime, getExecutionRuntimeDescriptors, getExecutionRuntimePreference, getExecutionStatus, setExecutionRuntimePreference } from "./execution";
import type { EditorSessionStore } from "./editor-core";
import { attachMcpCoreHost } from "./mcp/host";
import { getPlatformAdapter, type McpServerInfo } from "./platform";

export function useMcpCoreHost(sessions: EditorSessionStore, activeWorkspaceIdRef: { current: string }, enabled: boolean, token: string, setEnabled: (enabled: boolean) => void): { info: McpServerInfo | null; available: boolean } {
  const [info, setInfo] = useState<McpServerInfo | null>(null);
  const platform = getPlatformAdapter();
  const available = platform.mcp.canHostServer();

  useEffect(() => attachMcpCoreHost({
    platform,
    sessions,
    activeWorkspaceId: () => activeWorkspaceIdRef.current,
    execution: {
      async run(workspace, runtime, timeoutMs) {
        const state = workspace.getRuntimeState();
        const snapshot = state.snapshot;
        const inputFiles = state.input?.csvFiles.map((file) => ({ name: file.name, text: new TextDecoder().decode(file.bytes) })) ?? [];
        const options = { timeoutMs, workspaceIdentity: workspace.identity, workspaceId: workspace.id, workspaceLabel: workspace.id, functions: snapshot.functions ?? [], environment: snapshot.environment ?? { pythonImports: [], pythonDefinitions: [] }, parameters: snapshot.parameters ?? [] };
        return runtime === "python" || runtime === "javascript"
          ? executeWorkflowWithRuntime(runtime, snapshot.nodes, snapshot.edges, state.input?.csvText ?? "", inputFiles, options)
          : executeWorkflow(snapshot.nodes, snapshot.edges, state.input?.csvText ?? "", inputFiles, runtime, options);
      },
      stop: (workspace) => cancelActiveExecution(workspace.identity),
      status: (workspace) => getExecutionStatus(workspace.identity),
      runtimes: getExecutionRuntimeDescriptors,
      preference: getExecutionRuntimePreference,
      setPreference: setExecutionRuntimePreference,
    },
  }), [platform, sessions, activeWorkspaceIdRef]);

  useEffect(() => {
    if (!available) { setInfo(null); return; }
    let disposed = false;
    if (!enabled) { void platform.mcp.stopServer().finally(() => { if (!disposed) setInfo(null); }); return () => { disposed = true; }; }
    if (!token.trim()) { setInfo(null); setEnabled(false); return () => { disposed = true; }; }
    void platform.mcp.startServer(token).then((next) => { if (!disposed) setInfo(next); }).catch(() => { if (!disposed) { setInfo(null); setEnabled(false); } });
    return () => { disposed = true; };
  }, [available, enabled, token, platform, setEnabled]);

  useEffect(() => () => { void platform.mcp.stopServer(); }, [platform]);
  return { info, available };
}
