import { describe, expect, it } from "vitest";
import { EditorSessionStore } from "./session";
import { emptyWorkflowSnapshot } from "../workflow-core/model";

function snapshotWithNode(id: string) {
  return {
    nodes: [{ id, position: { x: 0, y: 0 }, data: { label: id, nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" as const } }],
    edges: [],
    functions: [],
    requirements: [],
  };
}

describe("EditorSessionStore", () => {
  it("isolates graph, history and view state between tabs", () => {
    const store = new EditorSessionStore("a", snapshotWithNode("a"));
    const a = store.get("a")!;
    const b = store.ensure("b", snapshotWithNode("b"));
    a.patchViewState({ primaryNodeId: "a", selectedNodeIds: ["a"], selectionMode: true });
    b.patchViewState({ currentCanvasId: "group-b" });
    a.history.push(a.getRuntimeState().snapshot);

    expect(a.getViewState()).toMatchObject({ primaryNodeId: "a", selectedNodeIds: ["a"], selectionMode: true });
    expect(b.getViewState()).toMatchObject({ primaryNodeId: null, selectedNodeIds: [], currentCanvasId: "group-b" });
    expect(a.history.canUndo).toBe(true);
    expect(b.history.canUndo).toBe(false);
  });

  it("tracks dirty/saved state through the session boundary", () => {
    const store = new EditorSessionStore("tab", emptyWorkflowSnapshot());
    const session = store.get("tab")!;
    expect(session.isDirty()).toBe(false);
    const runtime = session.getRuntimeState();
    session.replaceRuntimeState({ ...runtime, snapshot: { ...runtime.snapshot, requirements: ["numpy"] } });
    expect(session.isDirty()).toBe(true);
    session.markSaved();
    expect(session.isDirty()).toBe(false);
  });

  it("returns view-state copies instead of leaking selected-id arrays", () => {
    const session = new EditorSessionStore("tab", emptyWorkflowSnapshot()).get("tab")!;
    session.patchViewState({ selectedNodeIds: ["a"] });
    const view = session.getViewState();
    view.selectedNodeIds.push("b");
    expect(session.getViewState().selectedNodeIds).toEqual(["a"]);
  });


  it("applies graph commands atomically with workspace history", () => {
    const session = new EditorSessionStore("tab", snapshotWithNode("a")).get("tab")!;
    const result = session.applyGraphCommand({ type: "delete-nodes", nodeIds: ["a"] });
    expect(result.changed).toBe(true);
    expect(session.getRuntimeState().snapshot.nodes).toEqual([]);
    expect(session.history.canUndo).toBe(true);
    const restored = session.history.undo(session.getRuntimeState().snapshot);
    expect(restored?.nodes.map((node) => node.id)).toEqual(["a"]);
  });

  it("notifies observable subscribers when runtime or view state changes", () => {
    const session = new EditorSessionStore("tab", emptyWorkflowSnapshot()).get("tab")!;
    let notifications = 0;
    const unsubscribe = session.subscribe(() => { notifications += 1; });
    const before = session.getState().revision;
    session.patchViewState({ selectionMode: true });
    session.updateSnapshot((snapshot) => ({ ...snapshot, requirements: ["pandas"] }));
    unsubscribe();
    session.patchViewState({ selectionMode: false });

    expect(notifications).toBe(2);
    expect(session.getState().revision).toBe(before + 3);
  });

});

it("owns undo, redo, history restore and clear instead of delegating transactions to React", () => {
  const session = new EditorSessionStore("tab", snapshotWithNode("a")).get("tab")!;
  session.captureHistory();
  session.updateSnapshot((snapshot) => ({ ...snapshot, nodes: [] }));
  expect(session.undo()?.nodes.map((node) => node.id)).toEqual(["a"]);
  expect(session.redo()?.nodes).toEqual([]);
  session.captureHistory();
  session.clearHistory();
  expect(session.history.canUndo).toBe(false);
  expect(session.history.canRedo).toBe(false);
});
