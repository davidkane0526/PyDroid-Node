import type { HostExecutionEntry } from "./execution-host";

export type WorkspaceSessionSource = "local" | "remote";

export type WorkspaceSessionIdentity = {
  workspaceId: string;
  clientId: string;
  source: WorkspaceSessionSource;
  key: string;
};

function normalizeId(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized || fallback;
}

export function createWorkspaceSessionIdentity(workspaceId: string, clientId: string, source: WorkspaceSessionSource = "local"): WorkspaceSessionIdentity {
  const normalizedWorkspaceId = normalizeId(workspaceId, "default");
  const normalizedClientId = normalizeId(clientId, "client-unknown");
  return {
    workspaceId: normalizedWorkspaceId,
    clientId: normalizedClientId,
    source,
    key: `${source}:${normalizedClientId}:${normalizedWorkspaceId}`,
  };
}

export function workspaceSessionKey(identity: Pick<WorkspaceSessionIdentity, "workspaceId" | "clientId" | "source">): string {
  return createWorkspaceSessionIdentity(identity.workspaceId, identity.clientId, identity.source).key;
}

export function matchesHostExecution(identity: Pick<WorkspaceSessionIdentity, "workspaceId" | "clientId" | "source">, entry: Pick<HostExecutionEntry, "workspaceId" | "clientId" | "source">): boolean {
  return identity.workspaceId === entry.workspaceId && identity.clientId === entry.clientId && identity.source === entry.source;
}
