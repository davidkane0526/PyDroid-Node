import type { ExecutionResult } from "./runtime";
import type { WorkspaceSessionIdentity } from "./workspace-session-identity";

const EXECUTION_CLIENT_ID_KEY = "pydroid-flow.execution-client-id.v1";
const workspaceResults = new Map<string, ExecutionResult>();
const workspaceVariableStates = new Map<string, Record<string, unknown>>();
let cachedClientId: string | null = null;

type WorkspaceAddress = string | Pick<WorkspaceSessionIdentity, "workspaceId" | "clientId" | "source" | "key">;

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stateKey(address: WorkspaceAddress): string {
  if (typeof address === "string") return `workspace:${address.trim() || "default"}`;
  if (address.key?.trim()) return `session:${address.key}`;
  return `session:${address.source}:${address.clientId.trim() || "client-unknown"}:${address.workspaceId.trim() || "default"}`;
}

export function getExecutionClientId(): string {
  if (cachedClientId) return cachedClientId;
  try {
    const existing = globalThis.sessionStorage?.getItem(EXECUTION_CLIENT_ID_KEY)?.trim();
    if (existing) return (cachedClientId = existing);
    const created = createId("client");
    globalThis.sessionStorage?.setItem(EXECUTION_CLIENT_ID_KEY, created);
    return (cachedClientId = created);
  } catch {
    return (cachedClientId = createId("client"));
  }
}

export function getWorkspaceExecutionResult(workspace: WorkspaceAddress): ExecutionResult | null {
  return workspaceResults.get(stateKey(workspace)) ?? null;
}

export function setWorkspaceExecutionResult(workspace: WorkspaceAddress, result: ExecutionResult): void {
  workspaceResults.set(stateKey(workspace), result);
}

export function clearWorkspaceExecutionResult(workspace: WorkspaceAddress): void {
  workspaceResults.delete(stateKey(workspace));
}

export function getWorkspaceVariableState(workspace: WorkspaceAddress): Record<string, unknown> {
  return structuredClone(workspaceVariableStates.get(stateKey(workspace)) ?? {});
}

export function setWorkspaceVariableState(workspace: WorkspaceAddress, state: Record<string, unknown>): void {
  workspaceVariableStates.set(stateKey(workspace), structuredClone(state));
}

export function clearWorkspaceVariableState(workspace: WorkspaceAddress): void {
  workspaceVariableStates.delete(stateKey(workspace));
}

export function listWorkspaceVariableNames(workspace: WorkspaceAddress): string[] {
  return Object.keys(workspaceVariableStates.get(stateKey(workspace)) ?? {}).sort((left, right) => left.localeCompare(right));
}
