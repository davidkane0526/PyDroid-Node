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
  it("inserts, duplicates and mutates nodes through explicit command types", () => {
    const inserted = applyEditorGraphCommand(snapshot, {
      type: "insert-node",
      node: { id: "c", position: { x: 2, y: 2 }, data: { label: "c", nodeType: "python.print", nodeVersion: 1, parameters: { prefix: "" }, status: "idle" } },
    });
    expect(inserted.changed).toBe(true);
    expect(inserted.meta?.primaryNodeId).toBe("c");

    const duplicated = applyEditorGraphCommand(inserted.snapshot, { type: "duplicate-node", sourceNodeId: "c", duplicateId: "c-copy" });
    expect(duplicated.snapshot.nodes.find((node) => node.id === "c-copy")?.data.label).toBe("c 副本");

    const updated = applyEditorGraphCommand(duplicated.snapshot, { type: "update-node-parameters", nodeId: "c-copy", patch: { prefix: "phase9" } });
    expect(updated.changed).toBe(true);
    expect(updated.snapshot.nodes.find((node) => node.id === "c-copy")?.data.parameters.prefix).toBe("phase9");
  });

  it("arranges a canvas without moving nodes on another canvas", () => {
    const nested: WorkflowSnapshot = {
      ...snapshot,
      nodes: [
        ...snapshot.nodes,
        { id: "nested", position: { x: 77, y: 88 }, data: { label: "nested", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle", canvasParentId: "group-a" } },
      ],
    };
    const result = applyEditorGraphCommand(nested, { type: "arrange-canvas", canvasId: null, viewportWidth: 1200, direction: "horizontal" });
    expect(result.changed).toBe(true);
    expect(result.snapshot.nodes.find((node) => node.id === "nested")?.position).toEqual({ x: 77, y: 88 });
  });

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

it("inserts a reusable function as a list-producing function.map node", () => {
  const definition = {
    id: "fn-table",
    name: "Per table",
    version: 1,
    inputs: [{ id: "table", label: "表格", valueType: "table" as const, internalNodeId: "abs", internalHandle: "input" }],
    outputs: [{ id: "result", label: "结果", valueType: "table" as const, internalNodeId: "abs", internalHandle: "output" }],
    nodes: [{ id: "abs", position: { x: 0, y: 0 }, data: { label: "绝对值", nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle" as const } }],
    edges: [],
  };
  const inserted = applyEditorGraphCommand(snapshot, { type: "insert-function-map", definition, position: { x: 20, y: 20 }, canvasId: null });
  const map = inserted.snapshot.nodes.find((node) => node.id === inserted.meta?.createdNodeIds?.[0]);
  expect(map?.data.nodeType).toBe("function.map");
  expect(map?.data.parameters).toMatchObject({ functionId: "fn-table", mapInput: "table", collectMode: "list" });
  expect(map?.data.functionInputs).toEqual([{ id: "table", label: "表格 列表", valueType: "list", required: true }]);
  expect(map?.data.functionOutputs).toEqual([{ id: "output", label: "表格结果列表", valueType: "list" }]);
});

it("owns connection creation, reconnection, replacement and metadata edits", () => {
  const graph: WorkflowSnapshot = {
    nodes: [
      { id: "source", position: { x: 0, y: 0 }, data: { label: "Source", nodeType: "generate.random_table", nodeVersion: 1, parameters: { count: 3, distribution: "uniform", min: -1, max: 1, mean: 0, std: 1, seed: 1, indexColumn: "index", valueColumn: "value" }, status: "idle" } },
      { id: "abs", position: { x: 200, y: 0 }, data: { label: "Absolute", nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle" } },
      { id: "print", position: { x: 400, y: 0 }, data: { label: "Print", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } },
    ],
    edges: [],
    functions: [],
    requirements: [],
  };

  const connected = applyEditorGraphCommand(graph, {
    type: "connect-edge",
    connection: { source: "source", target: "abs", sourceHandle: "output", targetHandle: "input" },
  });
  expect(connected.changed).toBe(true);
  expect(connected.snapshot.edges).toHaveLength(1);

  const firstEdge = connected.snapshot.edges[0]!;
  const reconnected = applyEditorGraphCommand(connected.snapshot, {
    type: "reconnect-edge",
    edgeId: firstEdge.id,
    connection: { source: "source", target: "print", sourceHandle: "output", targetHandle: "input" },
  });
  expect(reconnected.changed).toBe(true);
  expect(reconnected.snapshot.edges[0]?.target).toBe("print");

  const tagged = applyEditorGraphCommand(reconnected.snapshot, { type: "update-node-tags", nodeId: "abs", tags: ["clean", "important"] });
  expect(tagged.snapshot.nodes.find((node) => node.id === "abs")?.data.tags).toEqual(["clean", "important"]);

  const replaced = applyEditorGraphCommand(tagged.snapshot, { type: "replace-node", nodeId: "print", nextNodeType: "generate.random_table" });
  expect(replaced.changed).toBe(true);
  expect(replaced.snapshot.nodes.find((node) => node.id === "print")?.data.nodeType).toBe("generate.random_table");
  expect(replaced.meta?.removedEdgeCount).toBe(1);
  expect(replaced.snapshot.edges).toHaveLength(0);
});

it("updates group labels/ports and applies code templates as graph transactions", () => {
  const graph: WorkflowSnapshot = {
    nodes: [
      { id: "custom", position: { x: 0, y: 0 }, data: { label: "Custom", nodeType: "custom.python_function", nodeVersion: 1, parameters: { code: "def old(x):\n    return x" }, status: "idle" } },
      { id: "print", position: { x: 200, y: 0 }, data: { label: "Print", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } },
      { id: "group", position: { x: 400, y: 0 }, data: { label: "Group", nodeType: "workflow.group", nodeVersion: 1, parameters: {}, status: "idle", groupInputs: [{ id: "in", label: "Old input", valueType: "table", internalNodeId: "custom", internalHandle: "input" }], groupOutputs: [] } },
    ],
    edges: [{ id: "custom-print", source: "custom", target: "print", sourceHandle: "output", targetHandle: "input" }],
    functions: [],
    requirements: [],
  };

  const renamed = applyEditorGraphCommand(graph, { type: "update-node-label", nodeId: "group", label: "Renamed" });
  const port = applyEditorGraphCommand(renamed.snapshot, { type: "update-group-port-label", groupId: "group", direction: "input", portId: "in", label: "Input table" });
  expect(port.snapshot.nodes.find((node) => node.id === "group")?.data.groupInputs?.[0]?.label).toBe("Input table");

  const templated = applyEditorGraphCommand(port.snapshot, { type: "apply-code-template", nodeId: "custom", code: "def next_value(x):\n    return x" });
  expect(templated.changed).toBe(true);
  expect(templated.snapshot.edges).toHaveLength(0);
  expect(templated.meta?.removedEdgeCount).toBe(1);
  expect(templated.snapshot.nodes.find((node) => node.id === "custom")?.data.parameters.code).toContain("next_value");
});

it("reconnects with the same single-input exclusivity as a fresh connection", () => {
  const graph: WorkflowSnapshot = {
    nodes: [
      { id: "source-a", position: { x: 0, y: 0 }, data: { label: "A", nodeType: "generate.random_table", nodeVersion: 1, parameters: { count: 3, distribution: "uniform", min: 0, max: 1, mean: 0, std: 1, seed: 1, indexColumn: "index", valueColumn: "value" }, status: "idle" } },
      { id: "source-b", position: { x: 0, y: 120 }, data: { label: "B", nodeType: "generate.random_table", nodeVersion: 1, parameters: { count: 3, distribution: "uniform", min: 0, max: 1, mean: 0, std: 1, seed: 2, indexColumn: "index", valueColumn: "value" }, status: "idle" } },
      { id: "abs", position: { x: 200, y: 0 }, data: { label: "Absolute", nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle" } },
      { id: "print", position: { x: 400, y: 0 }, data: { label: "Print", nodeType: "python.print", nodeVersion: 1, parameters: {}, status: "idle" } },
    ],
    edges: [
      { id: "moving", source: "source-a", target: "abs", sourceHandle: "output", targetHandle: "input" },
      { id: "occupied", source: "source-b", target: "print", sourceHandle: "output", targetHandle: "input" },
    ],
    functions: [],
    requirements: [],
  };

  const result = applyEditorGraphCommand(graph, {
    type: "reconnect-edge",
    edgeId: "moving",
    connection: { source: "source-a", target: "print", sourceHandle: "output", targetHandle: "input" },
  });
  expect(result.changed).toBe(true);
  expect(result.meta?.removedEdgeCount).toBe(1);
  expect(result.snapshot.edges).toHaveLength(1);
  expect(result.snapshot.edges[0]).toMatchObject({ id: "moving", source: "source-a", target: "print", targetHandle: "input" });
});


it("owns workflow dependency mutations as undoable editor commands", () => {
  const added = applyEditorGraphCommand(snapshot, { type: "upsert-requirement", requirement: "scipy>=1.12" });
  expect(added.changed).toBe(true);
  expect(added.snapshot.requirements).toEqual(["scipy>=1.12"]);

  const replaced = applyEditorGraphCommand(added.snapshot, { type: "upsert-requirement", requirement: "scipy==1.13.1" });
  expect(replaced.snapshot.requirements).toEqual(["scipy==1.13.1"]);

  const removed = applyEditorGraphCommand(replaced.snapshot, { type: "remove-requirement", requirement: "scipy==1.13.1" });
  expect(removed.changed).toBe(true);
  expect(removed.snapshot.requirements).toEqual([]);
  expect(snapshot.requirements).toEqual([]);
});
