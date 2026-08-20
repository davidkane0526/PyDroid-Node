import { describe, expect, it } from "vitest";
import { applyEditorGraphCommand } from "./commands";
import type { WorkflowSnapshot } from "../workflow-core/model";

const snapshot: WorkflowSnapshot = {
  nodes: [
    { id: "a", position: { x: 0, y: 0 }, data: { label: "a", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } },
    { id: "b", position: { x: 1, y: 0 }, data: { label: "b", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } },
  ],
  edges: [{ id: "ab", source: "a", target: "b" }],
  functions: [],
  requirements: [],
};

describe("editor graph commands", () => {
  it("applies deletion through one command boundary", () => {
    const result = applyEditorGraphCommand(snapshot, { type: "delete-nodes", nodeIds: ["a"] });
    expect(result.changed).toBe(true);
    expect(result.affectedCount).toBe(1);
    expect(result.snapshot.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(result.snapshot.edges).toEqual([]);
  });

  it("applies disconnect without mutating the input snapshot", () => {
    const result = applyEditorGraphCommand(snapshot, { type: "disconnect-edges", edgeIds: ["ab"] });
    expect(result.snapshot.edges).toEqual([]);
    expect(snapshot.edges).toHaveLength(1);
  });
});

it("creates and dissolves a group as one snapshot transaction", () => {
  const grouped = applyEditorGraphCommand(snapshot, { type: "create-group", nodeIds: ["a", "b"], groupId: "group", label: "Group", canvasId: null });
  expect(grouped.changed).toBe(true);
  expect(grouped.snapshot.nodes.find((node) => node.id === "group")?.data.nodeType).toBe("workflow.group");
  expect(grouped.snapshot.nodes.filter((node) => ["a", "b"].includes(node.id)).every((node) => node.data.canvasParentId === "group")).toBe(true);
  expect(grouped.meta?.primaryNodeId).toBe("group");

  const dissolved = applyEditorGraphCommand(grouped.snapshot, { type: "dissolve-group", groupId: "group" });
  expect(dissolved.changed).toBe(true);
  expect(dissolved.snapshot.nodes.some((node) => node.id === "group")).toBe(false);
  expect(dissolved.snapshot.nodes.filter((node) => ["a", "b"].includes(node.id)).every((node) => node.data.canvasParentId === undefined)).toBe(true);
});

it("inserts resource instances without mutating existing graph ids", () => {
  const resourceNode = { id: "resource", position: { x: 2, y: 2 }, data: { label: "resource", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" as const } };
  const inserted = applyEditorGraphCommand(snapshot, { type: "insert-resource", nodes: [resourceNode], edges: [], primaryNodeId: "resource" });
  expect(inserted.changed).toBe(true);
  expect(inserted.snapshot.nodes.map((node) => node.id)).toContain("resource");
  expect(inserted.meta?.selectedNodeIds).toEqual(["resource"]);

  const duplicate = applyEditorGraphCommand(inserted.snapshot, { type: "insert-resource", nodes: [resourceNode], edges: [], primaryNodeId: "resource" });
  expect(duplicate.changed).toBe(false);
  expect(duplicate.meta?.blockedReason).toMatch(/重复节点 ID/);
});


it("saves a group as a function, inserts a call, and protects referenced definitions", () => {
  const grouped = applyEditorGraphCommand(snapshot, { type: "create-group", nodeIds: ["a", "b"], groupId: "group-fn", label: "Function Group", canvasId: null });
  const saved = applyEditorGraphCommand(grouped.snapshot, { type: "save-group-as-function", groupId: "group-fn" });
  const definition = saved.meta?.functionDefinition;
  expect(saved.changed).toBe(true);
  expect(definition).toBeTruthy();
  expect(saved.snapshot.functions?.map((item) => item.id)).toContain(definition!.id);

  const inserted = applyEditorGraphCommand(saved.snapshot, { type: "insert-function-call", definition: definition!, position: { x: 20, y: 20 }, canvasId: null });
  const callId = inserted.meta?.createdNodeIds?.[0];
  expect(inserted.snapshot.nodes.find((node) => node.id === callId)?.data.nodeType).toBe("function.call");
  const blocked = applyEditorGraphCommand(inserted.snapshot, { type: "delete-function", functionId: definition!.id });
  expect(blocked.changed).toBe(false);
  expect(blocked.meta?.blockedReason).toMatch(/调用节点/);
});
