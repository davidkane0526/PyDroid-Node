import { createWorkspaceRuntimeState, workflowSnapshotSignature, type WorkflowSnapshot, type WorkspaceRuntimeState } from "./model";

export class WorkspaceSessionStore {
  private readonly states = new Map<string, WorkspaceRuntimeState>();

  constructor(initialId = "default", initialSnapshot?: WorkflowSnapshot) {
    this.states.set(initialId, createWorkspaceRuntimeState(initialSnapshot));
  }

  get(tabId: string): WorkspaceRuntimeState | undefined { return this.states.get(tabId); }
  set(tabId: string, state: WorkspaceRuntimeState): void { this.states.set(tabId, state); }
  ensure(tabId: string, snapshot?: WorkflowSnapshot): WorkspaceRuntimeState {
    const existing = this.states.get(tabId);
    if (existing) return existing;
    const created = createWorkspaceRuntimeState(snapshot);
    this.states.set(tabId, created);
    return created;
  }
  delete(tabId: string): void { this.states.delete(tabId); }
  isDirty(tabId: string): boolean {
    const state = this.states.get(tabId);
    return Boolean(state && workflowSnapshotSignature(state.snapshot) !== state.savedSignature);
  }
  markSaved(tabId: string): WorkspaceRuntimeState | undefined {
    const state = this.states.get(tabId);
    if (!state) return undefined;
    const next = { ...state, savedSignature: workflowSnapshotSignature(state.snapshot) };
    this.states.set(tabId, next);
    return next;
  }
}
