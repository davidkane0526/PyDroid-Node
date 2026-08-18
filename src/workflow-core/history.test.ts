import { describe, expect, it } from "vitest";
import { WorkflowHistory } from "./history";
import { emptyWorkflowSnapshot, workflowSnapshotSignature, type WorkflowSnapshot } from "./model";

function snapshot(id: string): WorkflowSnapshot {
  return {
    nodes: [{ id, position: { x: 0, y: 0 }, data: { label: id, nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } }],
    edges: [],
    requirements: [],
  };
}

describe("WorkflowHistory", () => {
  it("stores immutable snapshots and supports undo/redo", () => {
    const history = new WorkflowHistory(10);
    const a = snapshot("a");
    history.push(a);
    a.nodes[0].data.label = "mutated";
    const previous = history.undo(snapshot("b"));
    expect(previous?.nodes[0].data.label).toBe("a");
    expect(history.canRedo).toBe(true);
    expect(history.redo(previous ?? emptyWorkflowSnapshot())?.nodes[0].id).toBe("b");
  });

  it("enforces the history limit", () => {
    const history = new WorkflowHistory(2);
    history.push(snapshot("a"));
    history.push(snapshot("b"));
    history.push(snapshot("c"));
    expect(history.entries).toHaveLength(2);
    expect(history.undo(snapshot("d"))?.nodes[0].id).toBe("c");
    expect(history.undo(snapshot("c"))?.nodes[0].id).toBe("b");
    expect(history.undo(snapshot("b"))).toBeNull();
  });

  it("uses the persistence signature instead of transient node state", () => {
    const a = snapshot("a");
    const b = structuredClone(a);
    b.nodes[0].selected = true;
    b.nodes[0].data.status = "running";
    expect(workflowSnapshotSignature(a)).toBe(workflowSnapshotSignature(b));
  });
});
