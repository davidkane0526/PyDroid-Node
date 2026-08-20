import { describe, expect, it } from "vitest";
import { EditorWorkspaceLifecycleService } from "./lifecycle";
import { EditorSessionStore } from "./session";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  };
}

describe("EditorWorkspaceLifecycleService", () => {
  it("serializes autosave per workspace and restores through workflow schema", () => {
    const { storage } = memoryStorage();
    const lifecycle = new EditorWorkspaceLifecycleService(storage, "test.autosave");
    const snapshot = {
      nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { label: "a", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" as const } }],
      edges: [],
      functions: [],
      requirements: ["demo>=1"],
    };
    expect(lifecycle.writeAutosave("one", snapshot)).toEqual({ ok: true });
    const restored = lifecycle.readAutosave("one");
    expect(restored.status).toBe("ok");
    if (restored.status === "ok") {
      expect(restored.document.nodes.map((node) => node.id)).toEqual(["a"]);
      expect(restored.document.requirements).toEqual(["demo>=1"]);
    }
  });

  it("removes corrupt autosave without touching another workspace", () => {
    const { storage, values } = memoryStorage();
    const lifecycle = new EditorWorkspaceLifecycleService(storage, "test.autosave");
    values.set(lifecycle.autosaveKey("good"), lifecycle.serializeSnapshot({ nodes: [], edges: [], functions: [], requirements: [] }, "good"));
    values.set(lifecycle.autosaveKey("bad"), "{bad-json");
    expect(lifecycle.readAutosave("bad").status).toBe("corrupt");
    expect(values.has(lifecycle.autosaveKey("bad"))).toBe(false);
    expect(lifecycle.readAutosave("good").status).toBe("ok");
  });

  it("marks the owning session saved without changing its input state", () => {
    const { storage } = memoryStorage();
    const lifecycle = new EditorWorkspaceLifecycleService(storage);
    const session = new EditorSessionStore("tab").get("tab")!;
    session.replaceInput({ fileName: "a.csv", csvText: "x\n1", csvBytes: null, csvFiles: [] });
    session.updateSnapshot((snapshot) => ({ ...snapshot, requirements: ["demo"] }));
    expect(session.isDirty()).toBe(true);
    lifecycle.markSaved(session);
    expect(session.isDirty()).toBe(false);
    expect(session.getRuntimeState().input?.fileName).toBe("a.csv");
  });
});
