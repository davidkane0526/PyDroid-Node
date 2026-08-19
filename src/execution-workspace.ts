import type { ExecutionResult } from "./runtime";

const EXECUTION_CLIENT_ID_KEY = "pydroid-flow.execution-client-id.v1";
const workspaceResults = new Map<string, ExecutionResult>();
const workspaceVariableStates = new Map<string, Record<string, unknown>>();
let cachedClientId: string | null = null;

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

export function getWorkspaceExecutionResult(workspaceId: string): ExecutionResult | null {
  return workspaceResults.get(workspaceId) ?? null;
}

export function setWorkspaceExecutionResult(workspaceId: string, result: ExecutionResult): void {
  workspaceResults.set(workspaceId, result);
}

export function clearWorkspaceExecutionResult(workspaceId: string): void {
  workspaceResults.delete(workspaceId);
}

export function getWorkspaceVariableState(workspaceId: string): Record<string, unknown> {
  return structuredClone(workspaceVariableStates.get(workspaceId) ?? {});
}

export function setWorkspaceVariableState(workspaceId: string, state: Record<string, unknown>): void {
  workspaceVariableStates.set(workspaceId, structuredClone(state));
}

export function clearWorkspaceVariableState(workspaceId: string): void {
  workspaceVariableStates.delete(workspaceId);
}

export function listWorkspaceVariableNames(workspaceId: string): string[] {
  return Object.keys(workspaceVariableStates.get(workspaceId) ?? {}).sort((left, right) => left.localeCompare(right));
}
