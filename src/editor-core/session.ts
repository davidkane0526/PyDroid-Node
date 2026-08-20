import { WorkflowHistory } from "../workflow-core/history";
import { applyEditorGraphCommand, type EditorGraphCommand, type EditorGraphCommandResult } from "./commands";
import {
  createWorkspaceRuntimeState,
  emptyWorkflowSnapshot,
  workflowSnapshotSignature,
  type WorkflowSnapshot,
  type WorkspaceRuntimeInputState,
  type WorkspaceRuntimeState,
} from "../workflow-core/model";

export type EditorWorkspaceViewState = {
  primaryNodeId: string | null;
  selectedNodeIds: string[];
  currentCanvasId: string | null;
  selectionMode: boolean;
};

export type EditorWorkspaceSessionState = {
  runtime: WorkspaceRuntimeState;
  view: EditorWorkspaceViewState;
  revision: number;
};

const EMPTY_VIEW: EditorWorkspaceViewState = {
  primaryNodeId: null,
  selectedNodeIds: [],
  currentCanvasId: null,
  selectionMode: false,
};

function sameViewState(a: EditorWorkspaceViewState, b: EditorWorkspaceViewState): boolean {
  return a.primaryNodeId === b.primaryNodeId
    && a.currentCanvasId === b.currentCanvasId
    && a.selectionMode === b.selectionMode
    && a.selectedNodeIds.length === b.selectedNodeIds.length
    && a.selectedNodeIds.every((id, index) => id === b.selectedNodeIds[index]);
}

export class EditorWorkspaceSession {
  readonly history: WorkflowHistory;
  private runtimeState: WorkspaceRuntimeState;
  private viewState: EditorWorkspaceViewState;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private stateSnapshot: EditorWorkspaceSessionState;

  constructor(
    readonly id: string,
    initialSnapshot: WorkflowSnapshot = emptyWorkflowSnapshot(),
    initialRuntimeState?: WorkspaceRuntimeState,
    initialViewState: Partial<EditorWorkspaceViewState> = {},
    history = new WorkflowHistory(50),
  ) {
    this.runtimeState = initialRuntimeState ?? createWorkspaceRuntimeState(initialSnapshot);
    this.viewState = { ...EMPTY_VIEW, ...initialViewState, selectedNodeIds: [...(initialViewState.selectedNodeIds ?? [])] };
    this.history = history;
    this.stateSnapshot = this.buildStateSnapshot();
  }

  private buildStateSnapshot(): EditorWorkspaceSessionState {
    return {
      runtime: this.runtimeState,
      view: { ...this.viewState, selectedNodeIds: [...this.viewState.selectedNodeIds] },
      revision: this.revision,
    };
  }

  private emit(): void {
    this.revision += 1;
    this.stateSnapshot = this.buildStateSnapshot();
    for (const listener of this.listeners) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): EditorWorkspaceSessionState => this.stateSnapshot;

  getRuntimeState(): WorkspaceRuntimeState {
    return this.runtimeState;
  }

  replaceRuntimeState(state: WorkspaceRuntimeState): void {
    this.runtimeState = state;
    this.emit();
  }

  updateSnapshot(update: (snapshot: WorkflowSnapshot) => WorkflowSnapshot): void {
    const next = update(this.runtimeState.snapshot);
    if (next === this.runtimeState.snapshot) return;
    this.runtimeState = { ...this.runtimeState, snapshot: next };
    this.emit();
  }

  applyGraphCommand(command: EditorGraphCommand): EditorGraphCommandResult {
    const current = this.runtimeState.snapshot;
    const result = applyEditorGraphCommand(current, command);
    if (!result.changed) return result;
    this.history.push(current);
    this.runtimeState = { ...this.runtimeState, snapshot: result.snapshot };
    this.emit();
    return result;
  }

  replaceInput(input: WorkspaceRuntimeInputState | undefined): void {
    this.runtimeState = { ...this.runtimeState, input };
    this.emit();
  }

  getViewState(): EditorWorkspaceViewState {
    return { ...this.viewState, selectedNodeIds: [...this.viewState.selectedNodeIds] };
  }

  replaceViewState(state: EditorWorkspaceViewState): void {
    const next = { ...state, selectedNodeIds: [...state.selectedNodeIds] };
    if (sameViewState(this.viewState, next)) return;
    this.viewState = next;
    this.emit();
  }

  patchViewState(patch: Partial<EditorWorkspaceViewState>): void {
    const next = {
      ...this.viewState,
      ...patch,
      selectedNodeIds: patch.selectedNodeIds ? [...patch.selectedNodeIds] : this.viewState.selectedNodeIds,
    };
    if (sameViewState(this.viewState, next)) return;
    this.viewState = next;
    this.emit();
  }

  isDirty(): boolean {
    return workflowSnapshotSignature(this.runtimeState.snapshot) !== this.runtimeState.savedSignature;
  }

  markSaved(signature = workflowSnapshotSignature(this.runtimeState.snapshot)): WorkspaceRuntimeState {
    this.runtimeState = { ...this.runtimeState, savedSignature: signature };
    this.emit();
    return this.runtimeState;
  }
}

export class EditorSessionStore {
  private readonly sessions = new Map<string, EditorWorkspaceSession>();

  constructor(initialId = "default", initialSnapshot: WorkflowSnapshot = emptyWorkflowSnapshot()) {
    this.sessions.set(initialId, new EditorWorkspaceSession(initialId, initialSnapshot));
  }

  get(id: string): EditorWorkspaceSession | undefined {
    return this.sessions.get(id);
  }

  ensure(id: string, initialSnapshot: WorkflowSnapshot = emptyWorkflowSnapshot()): EditorWorkspaceSession {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const created = new EditorWorkspaceSession(id, initialSnapshot);
    this.sessions.set(id, created);
    return created;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
