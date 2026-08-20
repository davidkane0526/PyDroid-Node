import { WorkflowHistory } from "../workflow-core/history";
import { applyEditorGraphCommand, type EditorGraphCommand, type EditorGraphCommandResult } from "./commands";
import {
  cloneWorkflowSnapshot,
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

export type ReplaceSnapshotOptions = {
  captureHistory?: boolean;
  resetView?: boolean;
  markSaved?: boolean;
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

  private resetView(): void {
    this.viewState = { ...EMPTY_VIEW };
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

  replaceSnapshot(snapshot: WorkflowSnapshot, options: ReplaceSnapshotOptions = {}): void {
    if (options.captureHistory) this.history.push(this.runtimeState.snapshot);
    const nextSnapshot = cloneWorkflowSnapshot(snapshot);
    this.runtimeState = {
      ...this.runtimeState,
      snapshot: nextSnapshot,
      ...(options.markSaved ? { savedSignature: workflowSnapshotSignature(nextSnapshot) } : {}),
    };
    if (options.resetView) this.resetView();
    this.emit();
  }

  updateSnapshot(update: (snapshot: WorkflowSnapshot) => WorkflowSnapshot): void {
    const next = update(this.runtimeState.snapshot);
    if (next === this.runtimeState.snapshot) return;
    this.runtimeState = { ...this.runtimeState, snapshot: next };
    this.emit();
  }

  captureHistory(): void {
    this.history.push(this.runtimeState.snapshot);
    this.emit();
  }

  undo(): WorkflowSnapshot | null {
    const previous = this.history.undo(this.runtimeState.snapshot);
    if (!previous) return null;
    this.runtimeState = { ...this.runtimeState, snapshot: cloneWorkflowSnapshot(previous) };
    this.resetView();
    this.emit();
    return this.runtimeState.snapshot;
  }

  redo(): WorkflowSnapshot | null {
    const next = this.history.redo(this.runtimeState.snapshot);
    if (!next) return null;
    this.runtimeState = { ...this.runtimeState, snapshot: cloneWorkflowSnapshot(next) };
    this.resetView();
    this.emit();
    return this.runtimeState.snapshot;
  }

  restoreHistoryAt(index: number): WorkflowSnapshot | null {
    const restored = this.history.restoreAt(index, this.runtimeState.snapshot);
    if (!restored) return null;
    this.runtimeState = { ...this.runtimeState, snapshot: cloneWorkflowSnapshot(restored) };
    this.resetView();
    this.emit();
    return this.runtimeState.snapshot;
  }

  clearHistory(): void {
    this.history.clear();
    this.emit();
  }

  applyGraphCommand(command: EditorGraphCommand): EditorGraphCommandResult {
    const current = this.runtimeState.snapshot;
    const result = applyEditorGraphCommand(current, command);
    if (!result.changed) return result;
    this.history.push(current);
    this.runtimeState = { ...this.runtimeState, snapshot: result.snapshot };
    if (result.meta) {
      const next = { ...this.viewState };
      if ("primaryNodeId" in result.meta) next.primaryNodeId = result.meta.primaryNodeId ?? null;
      if (result.meta.selectedNodeIds) next.selectedNodeIds = [...result.meta.selectedNodeIds];
      if (typeof result.meta.selectionMode === "boolean") next.selectionMode = result.meta.selectionMode;
      this.viewState = next;
    }
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
