import { describe, expect, it } from "vitest";
import { WorkspaceSessionStore } from "./session";
import { emptyWorkflowSnapshot } from "./model";

describe("WorkspaceSessionStore", () => {
  it("tracks dirty state against the saved workflow signature", () => {
    const store = new WorkspaceSessionStore("tab", emptyWorkflowSnapshot());
    expect(store.isDirty("tab")).toBe(false);
    const state = store.get("tab")!;
    state.snapshot.requirements = ["pandas"];
    expect(store.isDirty("tab")).toBe(true);
    store.markSaved("tab");
    expect(store.isDirty("tab")).toBe(false);
  });

  it("keeps an independent history manager per workspace", () => {
    const store = new WorkspaceSessionStore("a", emptyWorkflowSnapshot());
    store.ensure("b", emptyWorkflowSnapshot());
    const a = store.history("a");
    const b = store.history("b");
    expect(a).not.toBe(b);
    expect(store.history("a")).toBe(a);
    expect(store.history("b")).toBe(b);
  });

  it("retains per-workspace input selections while switching tabs", () => {
    const store = new WorkspaceSessionStore("a", emptyWorkflowSnapshot());
    const state = store.get("a")!;
    store.set("a", {
      ...state,
      input: { fileName: "sample.csv", csvText: "x\n1", csvBytes: new Uint8Array([1, 2]), csvFiles: [] },
    });
    store.ensure("b", emptyWorkflowSnapshot());
    expect(store.get("a")?.input?.fileName).toBe("sample.csv");
    expect(store.get("a")?.input?.csvText).toBe("x\n1");
  });
});
