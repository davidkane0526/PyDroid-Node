import { cloneWorkflowSnapshot, type WorkflowSnapshot } from "./model";

export type WorkflowHistoryEntry = {
  id: number;
  at: Date;
  summary: string;
};

type RecordedSnapshot = { snapshot: WorkflowSnapshot; meta: WorkflowHistoryEntry };

function summaryOf(snapshot: WorkflowSnapshot): string {
  return `${snapshot.nodes.length} 个节点 · ${snapshot.edges.length} 条连线`;
}

export class WorkflowHistory {
  private readonly past: RecordedSnapshot[] = [];
  private readonly future: RecordedSnapshot[] = [];
  private sequence = 0;

  constructor(private readonly limit = 50) {}

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get futureCount(): number { return this.future.length; }
  get entries(): WorkflowHistoryEntry[] { return this.past.map(({ meta }) => ({ ...meta, at: new Date(meta.at) })); }

  private record(snapshot: WorkflowSnapshot): RecordedSnapshot {
    return {
      snapshot: cloneWorkflowSnapshot(snapshot),
      meta: { id: Date.now() * 1000 + (this.sequence++ % 1000), at: new Date(), summary: summaryOf(snapshot) },
    };
  }

  push(snapshot: WorkflowSnapshot): void {
    this.past.push(this.record(snapshot));
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  undo(current: WorkflowSnapshot): WorkflowSnapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.record(current));
    return cloneWorkflowSnapshot(previous.snapshot);
  }

  redo(current: WorkflowSnapshot): WorkflowSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.record(current));
    return cloneWorkflowSnapshot(next.snapshot);
  }

  restoreAt(index: number, current: WorkflowSnapshot): WorkflowSnapshot | null {
    const chosen = this.past[index];
    if (!chosen) return null;
    this.future.push(this.record(current));
    this.past.splice(index);
    return cloneWorkflowSnapshot(chosen.snapshot);
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
