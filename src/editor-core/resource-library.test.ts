import { describe, expect, it } from "vitest";
import type { StorageLike } from "../workflow-core";
import { serializeWorkflow, type WorkflowNode } from "../workflow";
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

    const flow = service.addFlowDocument("流程 A", JSON.stringify(serializeWorkflow("流程 A", [], [])), { id: "flow-a", savedAt: "now" });
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


  it("migrates legacy local resources and preserves future flow payloads", () => {
    const storage = memoryStorage();
    const legacyNode = node("legacy");
    delete (legacyNode.data as { nodeVersion?: number }).nodeVersion;
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes, JSON.stringify([{ id: "legacy-node", name: "Legacy", node: legacyNode, savedAt: "old" }]));
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.groups, JSON.stringify([]));
    const legacyFlow = JSON.stringify({ schemaVersion: 1, name: "Legacy Flow", nodes: [], edges: [] });
    const futureFlow = JSON.stringify({ schemaVersion: 999, name: "Future Flow", nodes: [], edges: [], functions: [], requirements: [] });
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.flows, JSON.stringify([
      { id: "legacy-flow", name: "Legacy Flow", savedAt: "old", document: legacyFlow },
      { id: "future-flow", name: "Future Flow", savedAt: "future", document: futureFlow },
    ]));

    const service = new EditorResourceLibraryService(storage);
    const migratedNode = service.getState().savedNodes.find((entry) => entry.id === "legacy-node")!;
    const migratedFlow = service.getState().flows.find((entry) => entry.id === "legacy-flow")!;
    const preservedFuture = service.getState().flows.find((entry) => entry.id === "future-flow")!;
    expect(migratedNode.resourceSchemaVersion).toBe(2);
    expect(migratedNode.node.data.nodeVersion).toBe(1);
    expect(migratedFlow.document).toContain('"schemaVersion": 4');
    expect(preservedFuture.compatibility).toBe("future");
    expect(preservedFuture.document).toBe(futureFlow);
    const persistedFlows = JSON.parse(storage.values.get(RESOURCE_LIBRARY_STORAGE_KEYS.flows) ?? "[]") as Array<{ id: string; document: string }>;
    expect(persistedFlows.find((entry) => entry.id === "future-flow")?.document).toBe(futureFlow);
  });

  it("migrates fragment resources without requiring unavailable document-level function context", () => {
    const storage = memoryStorage();
    const functionCall = node("call");
    functionCall.data = {
      ...functionCall.data,
      nodeType: "function.call",
      nodeVersion: 1,
      parameters: { functionId: "external-function", functionVersion: 1 },
      functionInputs: [{ id: "input", label: "输入", valueType: "table", required: true }],
      functionOutputs: [{ id: "output", label: "输出", valueType: "table" }],
    };
    const service = new EditorResourceLibraryService(storage);
    const saved = service.saveNode({ id: "call-resource", name: "Call", node: functionCall, savedAt: "now" });
    expect(saved.compatibility).not.toBe("invalid");
    const group = service.saveGroup({ id: "group-call", name: "Group Call", description: "", nodes: [functionCall], edges: [] });
    expect(group.compatibility).not.toBe("invalid");
  });

  it("mirrors a migrated legacy flow in the canonical current workflow schema", () => {
    const storage = memoryStorage();
    const mirrored = new Map<string, string>();
    const service = new EditorResourceLibraryService(storage, [], (path, content) => mirrored.set(path, content));
    const legacy = JSON.stringify({ schemaVersion: 1, name: "Legacy", nodes: [], edges: [] });
    const added = service.addFlowDocument("Legacy", legacy, { id: "legacy-mirror", savedAt: "now" });
    expect(added.document).toContain('"schemaVersion": 4');
    expect(mirrored.get("workflows/legacy-mirror.workflow.json")).toBe(added.document);
  });

  it("keeps future resource payloads non-executable without discarding unknown fields", () => {
    const storage = memoryStorage();
    const futureNode = {
      id: "future-resource",
      name: "Future",
      savedAt: "future",
      resourceSchemaVersion: 99,
      futureMetadata: { keep: true },
      node: node("future-node"),
    };
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes, JSON.stringify([futureNode]));
    const service = new EditorResourceLibraryService(storage);
    const loaded = service.getState().savedNodes[0] as typeof futureNode & { compatibility?: string };
    expect(loaded.compatibility).toBe("future");
    expect((loaded as any).futureMetadata).toEqual({ keep: true });
    const persisted = JSON.parse(storage.values.get(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes) ?? "[]")[0];
    expect(persisted.futureMetadata).toEqual({ keep: true });
  });


  it("preserves future and invalid resource payloads byte-semantically across reload/persist cycles", () => {
    const storage = memoryStorage();
    const futureFlow = {
      id: "future-flow", name: "Future", savedAt: "future", resourceSchemaVersion: 99,
      document: JSON.stringify({ schemaVersion: 99, name: "Future", nodes: [], edges: [] }),
      futureMetadata: { nested: [1, { keep: "exact" }] },
    };
    const invalidNode = {
      id: "invalid-node", name: "Invalid", savedAt: "invalid", resourceSchemaVersion: "future-string-version",
      node: node("invalid"), extra: { preserve: true },
    };
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.flows, JSON.stringify([futureFlow]));
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes, JSON.stringify([invalidNode]));
    storage.values.set(RESOURCE_LIBRARY_STORAGE_KEYS.groups, JSON.stringify([]));

    const service = new EditorResourceLibraryService(storage);
    expect(service.getState().flows[0].compatibility).toBe("future");
    expect(service.getState().savedNodes[0].compatibility).toBe("invalid");
    expect(service.renameFlow("future-flow", "changed")).toBeNull();
    expect(service.removeFlow("future-flow")).toBe(false);
    expect(service.renameNode("invalid-node", "changed")).toBe(false);
    expect(service.removeNode("invalid-node")).toBe(false);

    const persistedFlow = JSON.parse(storage.values.get(RESOURCE_LIBRARY_STORAGE_KEYS.flows) ?? "[]")[0];
    const persistedNode = JSON.parse(storage.values.get(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes) ?? "[]")[0];
    expect(persistedFlow).toEqual(futureFlow);
    expect(persistedNode).toEqual(invalidNode);

    service.reload();
    expect(JSON.parse(storage.values.get(RESOURCE_LIBRARY_STORAGE_KEYS.flows) ?? "[]")[0]).toEqual(futureFlow);
    expect(JSON.parse(storage.values.get(RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes) ?? "[]")[0]).toEqual(invalidNode);
  });

  it("replaces scanned external flows without retaining vanished external entries", () => {
    const storage = memoryStorage();
    const service = new EditorResourceLibraryService(storage);
    service.addFlowDocument("本地", JSON.stringify(serializeWorkflow("本地", [], [])), { id: "local", savedAt: "now" });
    service.mergeExternalFlows([{ uri: "content://a", name: "A", content: "{}" }, { uri: "content://b", name: "B", content: "{}" }]);
    expect(service.getState().flows.filter((entry) => entry.external)).toHaveLength(2);
    service.mergeExternalFlows([{ uri: "content://b", name: "B", content: "{}" }]);
    expect(service.getState().flows.map((entry) => entry.id)).toEqual(["external-content://b", "local"]);
  });
});
