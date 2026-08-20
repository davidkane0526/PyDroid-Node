import { parseWorkflow, serializeWorkflow, type WorkflowDocument } from "../workflow";
import {
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
  | { status: "corrupt"; message: string };

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
    return writeStorage(this.storage, this.autosaveKey(workspaceId), this.serializeSnapshot(snapshot, name));
  }

  readAutosave(workspaceId: string): WorkspaceAutosaveReadResult {
    const key = this.autosaveKey(workspaceId);
    const saved = readStorage(this.storage, key);
    if (!saved) return { status: "missing" };
    try {
      return { status: "ok", document: parseWorkflow(saved) };
    } catch (error) {
      removeStorage(this.storage, key);
      return { status: "corrupt", message: error instanceof Error ? error.message : String(error) };
    }
  }

  clearAutosave(workspaceId: string): boolean {
    return removeStorage(this.storage, this.autosaveKey(workspaceId));
  }

  markSaved(session: EditorWorkspaceSession): void {
    session.markSaved();
  }
}
