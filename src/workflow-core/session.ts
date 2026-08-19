import { WorkflowHistory } from "./history";
import { createWorkspaceRuntimeState, workflowSnapshotSignature, type WorkflowSnapshot, type WorkspaceRuntimeState } from "./model";

export class WorkspaceSessionStore {
  private readonly states = new Map<string, WorkspaceRuntimeState>();
  private readonly histories = new Map<string, WorkflowHistory>();

  constructor(initialId = "default", initialSnapshot?: WorkflowSnapshot) {
    this.states.set(initialId, createWorkspaceRuntimeState(initialSnapshot));
    this.histories.set(initialId, new WorkflowHistory(50));
  }

  get(tabId: string): WorkspaceRuntimeState | undefined { return this.states.get(tabId); }
  set(tabId: string, state: WorkspaceRuntimeState): void { this.states.set(tabId, state); }
  history(tabId: string): WorkflowHistory {
    let history = this.histories.get(tabId);
    if (!history) { history = new WorkflowHistory(50); this.histories.set(tabId, history); }
    return history;
  }
  ensure(tabId: string, snapshot?: WorkflowSnapshot): WorkspaceRuntimeState {
    const existing = this.states.get(tabId);
    if (existing) return existing;
    const created = createWorkspaceRuntimeState(snapshot);
    this.states.set(tabId, created);
    this.history(tabId);
    return created;
  }
  delete(tabId: string): void { this.states.delete(tabId); this.histories.delete(tabId); }
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
