import { describe, expect, it } from "vitest";
import type { StorageLike } from "../workflow-core";
import type { WorkflowNode } from "../workflow";
import { EditorResourceLibraryService, RESOURCE_LIBRARY_STORAGE_KEYS } from "./resource-library";

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  } as StorageLike & { values: Map<string, string> };
}

const node = (id: string, label = id): WorkflowNode => ({
  id,
  type: "workflow",
  position: { x: 0, y: 0 },
  data: { label, nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle" },
});

describe("EditorResourceLibraryService", () => {
  it("persists node/group/flow mutations and protects built-in groups", () => {
    const storage = memoryStorage();
    const mirrored = new Map<string, string>();
    const builtIn = { id: "builtin", name: "内置", description: "", nodes: [node("group", "内置")], edges: [], builtIn: true };
    builtIn.nodes[0].data.nodeType = "workflow.group";
    const service = new EditorResourceLibraryService(storage, [builtIn], (path, content) => mirrored.set(path, content));

    service.saveNode({ id: "saved-a", name: "节点 A", node: node("a"), savedAt: "now" });
    service.saveNode({ id: "saved-b", name: "节点 B", node: node("b"), savedAt: "now" });
    expect(service.reorderNodes("saved-a", "saved-b")).toBe(true);
    expect(service.renameNode("saved-a", "节点 A2")).toBe(true);

    const groupNode = node("group-custom", "组合 A");
    groupNode.data.nodeType = "workflow.group";
    service.saveGroup({ id: "group-custom", name: "组合 A", description: "", nodes: [groupNode], edges: [] });
    expect(service.renameGroup("group-custom", "组合 B")).toBe(true);
    expect(service.renameGroup("builtin", "错误改名")).toBe(false);
    expect(() => service.saveGroup({ ...builtIn, name: "覆盖" })).toThrow();

    const flow = service.addFlowDocument("流程 A", "{\"schemaVersion\":2}", { id: "flow-a", savedAt: "now" });
    expect(flow.id).toBe("flow-a");
    expect(service.toggleFlowLock("flow-a")?.locked).toBe(true);
    expect(service.removeFlow("flow-a")).toBe(false);
    expect(service.toggleFlowLock("flow-a")?.locked).toBe(false);
    expect(service.removeFlow("flow-a")).toBe(true);

    expect(storage.values.has(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes)).toBe(true);
    expect(storage.values.has(RESOURCE_LIBRARY_STORAGE_KEYS.groups)).toBe(true);
    expect(storage.values.has(RESOURCE_LIBRARY_STORAGE_KEYS.flows)).toBe(true);
    expect(mirrored.has("nodes/saved-nodes.json")).toBe(true);
    expect(mirrored.has("workflows/groups.json")).toBe(true);
    expect(mirrored.has("workflows/library.json")).toBe(true);
    expect(mirrored.has("workflows/flow-a.workflow.json")).toBe(true);
  });

  it("replaces scanned external flows without retaining vanished external entries", () => {
    const storage = memoryStorage();
    const service = new EditorResourceLibraryService(storage);
    service.addFlowDocument("本地", "{}", { id: "local", savedAt: "now" });
    service.mergeExternalFlows([{ uri: "content://a", name: "A", content: "{}" }, { uri: "content://b", name: "B", content: "{}" }]);
    expect(service.getState().flows.filter((entry) => entry.external)).toHaveLength(2);
    service.mergeExternalFlows([{ uri: "content://b", name: "B", content: "{}" }]);
    expect(service.getState().flows.map((entry) => entry.id)).toEqual(["external-content://b", "local"]);
  });
});
