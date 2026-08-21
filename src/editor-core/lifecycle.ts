import { parseWorkflow, serializeWorkflow, WORKFLOW_SCHEMA_VERSION, type WorkflowDocument } from "../workflow";
import {
  emptyWorkflowSnapshot,
  workflowSnapshotForPersistence,
  type StorageLike,
  type StorageWriteResult,
  type WorkflowSnapshot,
  writeStorage,
  readStorage,
  removeStorage,
} from "../workflow-core";
import type { EditorWorkspaceSession } from "./session";

export type WorkspaceAutosaveReadResult =
  | { status: "missing" }
  | { status: "ok"; document: WorkflowDocument }
  | { status: "incompatible"; message: string; preserved: true }
  | { status: "corrupt"; message: string };

export type WorkspaceDocumentApplyOptions = {
  captureHistory?: boolean;
  markSaved?: boolean;
  resetView?: boolean;
};

export type WorkspaceDocumentOpenResult = {
  document: WorkflowDocument;
  snapshot: WorkflowSnapshot;
};

export class EditorWorkspaceLifecycleService {
  constructor(
    private readonly storage: StorageLike,
    private readonly autosavePrefix = "pydroid-flow.autosave.v1",
  ) {}

  autosaveKey(workspaceId: string): string {
    return `${this.autosavePrefix}.${workspaceId}`;
  }

  serializeSnapshot(snapshot: WorkflowSnapshot, name: string): string {
    const persistent = workflowSnapshotForPersistence(snapshot);
    return JSON.stringify(
      serializeWorkflow(name, persistent.nodes, persistent.edges, persistent.requirements ?? [], persistent.functions ?? []),
    );
  }

  serializeSnapshotPretty(snapshot: WorkflowSnapshot, name: string): string {
    const persistent = workflowSnapshotForPersistence(snapshot);
    return JSON.stringify(
      serializeWorkflow(name, persistent.nodes, persistent.edges, persistent.requirements ?? [], persistent.functions ?? []),
      null,
      2,
    );
  }

  writeAutosave(workspaceId: string, snapshot: WorkflowSnapshot, name = "自动保存"): StorageWriteResult {
    const key = this.autosaveKey(workspaceId);
    const existing = readStorage(this.storage, key);
    if (existing) {
      try {
        JSON.parse(existing);
      } catch {
        // Syntactically corrupt autosaves can be replaced by a valid current snapshot.
        return writeStorage(this.storage, key, this.serializeSnapshot(snapshot, name));
      }
      try {
        parseWorkflow(existing);
      } catch {
        // Any syntactically valid but unsupported/incompatible document is preserved.
        // This covers future schema, future NodeSpec/function versions and unknown
        // compatibility states without guessing that the current build may overwrite it.
        return { ok: false, reason: "protected", message: "incompatible-workflow-autosave" };
      }
    }
    return writeStorage(this.storage, key, this.serializeSnapshot(snapshot, name));
  }

  readAutosave(workspaceId: string): WorkspaceAutosaveReadResult {
    const key = this.autosaveKey(workspaceId);
    const saved = readStorage(this.storage, key);
    if (!saved) return { status: "missing" };
    try {
      JSON.parse(saved);
    } catch (error) {
      removeStorage(this.storage, key);
      return { status: "corrupt", message: error instanceof Error ? error.message : String(error) };
    }
    try {
      return { status: "ok", document: parseWorkflow(saved) };
    } catch (error) {
      // A syntactically valid document may come from a newer application, a future
      // NodeSpec, or a migration that this build does not understand. Never delete
      // or downgrade such autosaves merely because this version cannot open them.
      return { status: "incompatible", message: error instanceof Error ? error.message : String(error), preserved: true };
    }
  }

  clearAutosave(workspaceId: string): boolean {
    return removeStorage(this.storage, this.autosaveKey(workspaceId));
  }

  markSaved(session: EditorWorkspaceSession): void {
    session.markSaved();
  }

  applyDocument(
    session: EditorWorkspaceSession,
    document: WorkflowDocument,
    prepare: (document: WorkflowDocument) => WorkflowSnapshot = (value) => ({
      nodes: value.nodes,
      edges: value.edges,
      functions: value.functions ?? [],
      requirements: value.requirements ?? [],
    }),
    options: WorkspaceDocumentApplyOptions = {},
  ): WorkspaceDocumentOpenResult {
    const snapshot = prepare(document);
    session.replaceSnapshot(snapshot, {
      captureHistory: options.captureHistory ?? true,
      resetView: options.resetView ?? true,
      markSaved: options.markSaved ?? true,
    });
    return { document, snapshot };
  }

  openSerialized(
    session: EditorWorkspaceSession,
    serialized: string,
    prepare?: (document: WorkflowDocument) => WorkflowSnapshot,
    options: WorkspaceDocumentApplyOptions = {},
  ): WorkspaceDocumentOpenResult {
    return this.applyDocument(session, parseWorkflow(serialized), prepare, options);
  }

  restoreAutosave(
    session: EditorWorkspaceSession,
    prepare?: (document: WorkflowDocument) => WorkflowSnapshot,
  ): WorkspaceAutosaveReadResult {
    const restored = this.readAutosave(session.id);
    if (restored.status === "ok") this.applyDocument(session, restored.document, prepare, { captureHistory: false, markSaved: false, resetView: true });
    return restored;
  }

  resetWorkspace(session: EditorWorkspaceSession, captureHistory = true): void {
    session.replaceSnapshot(emptyWorkflowSnapshot(), { captureHistory, resetView: true, markSaved: true });
    this.clearAutosave(session.id);
  }

  saveSession<T>(session: EditorWorkspaceSession, name: string, writer: (serialized: string) => T): T {
    const serialized = this.serializeSnapshotPretty(session.getRuntimeState().snapshot, name);
    const result = writer(serialized);
    session.markSaved();
    return result;
  }

  needsSaveBeforeClose(session: EditorWorkspaceSession): boolean {
    return session.isDirty();
  }
}
