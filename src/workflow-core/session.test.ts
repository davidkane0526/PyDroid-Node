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
});
