import { describe, expect, it } from "vitest";
import { collectReachableFunctionNodes, compactNodeLayout, flattenWorkflowGroups, normalizeNodePositions, parseWorkflow, parseWorkflowWithReport, serializeWorkflow, WORKFLOW_SCHEMA_VERSION, type WorkflowFunctionDefinition, type WorkflowNode } from "./workflow";

describe("serializeWorkflow", () => {
  it("uses the current schema version", () => {
    const workflow = serializeWorkflow("test", [], []);
    expect(workflow.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
    expect(workflow.name).toBe("test");
  });

  it("round-trips a valid workflow", () => {
    const workflow = serializeWorkflow("valid", [], []);
    expect(parseWorkflow(JSON.stringify(workflow))).toEqual(workflow);
  });

  it("migrates schema v1 workflows through v4 and canonicalizes document collections", () => {
    const migrated = parseWorkflowWithReport(JSON.stringify({ schemaVersion: 1, name: "legacy", nodes: [], edges: [] }));
    expect(migrated.document.schemaVersion).toBe(4);
    expect(migrated.document.functions).toEqual([]);
    expect(migrated.document.requirements).toEqual([]);
    expect(migrated.document.environment).toEqual({ pythonImports: [], pythonDefinitions: [] });
    expect(migrated.document.parameters).toEqual([]);
    expect(migrated.report.schemaSteps).toEqual([{ fromVersion: 1, toVersion: 2 }, { fromVersion: 2, toVersion: 3 }, { fromVersion: 3, toVersion: 4 }]);
  });

  it("collects only function bodies reachable from root calls", () => {
    const call = { id: "call", position: { x: 0, y: 0 }, data: { label: "call", nodeType: "function.call", nodeVersion: 1, parameters: { functionId: "fn-a", functionVersion: 1 }, status: "idle" } } as WorkflowNode;
    const body = { id: "body", position: { x: 0, y: 0 }, data: { label: "body", nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle" } } as WorkflowNode;
    const unused = { id: "unused", position: { x: 0, y: 0 }, data: { label: "unused", nodeType: "custom.python_function", nodeVersion: 1, parameters: { code: "def transform(table): return table" }, status: "idle" } } as WorkflowNode;
    const functions: WorkflowFunctionDefinition[] = [
      { id: "fn-a", name: "A", version: 1, inputs: [], outputs: [{ id: "result", label: "result", valueType: "table", internalNodeId: "body", internalHandle: "output" }], nodes: [body], edges: [] },
      { id: "fn-unused", name: "unused", version: 1, inputs: [], outputs: [{ id: "result", label: "result", valueType: "table", internalNodeId: "unused", internalHandle: "output" }], nodes: [unused], edges: [] },
    ];
    expect(collectReachableFunctionNodes([call], functions).map((node) => node.id)).toEqual(["call", "body"]);
  });

  it("repairs non-finite or extreme node positions", () => {
    const node = { id: "bad", position: { x: 1, y: 451469 }, data: {} } as WorkflowNode;
    expect(normalizeNodePositions([node])[0].position).toEqual({ x: 45, y: 55 });
  });

  it("rejects string-encoded node and function versions instead of normalizing corrupted version fields", () => {
    expect(() => parseWorkflow(JSON.stringify({ schemaVersion: 4, name: "bad-node-version", nodes: [{ id: "n", data: { nodeType: "table.absolute", nodeVersion: "1", parameters: {} } }], edges: [], functions: [], requirements: [], environment: { pythonImports: [], pythonDefinitions: [] }, parameters: [] }))).toThrow(/节点版本无效/);
    expect(() => parseWorkflow(JSON.stringify({ schemaVersion: 4, name: "bad-function-version", nodes: [], edges: [], functions: [{ id: "fn", name: "fn", version: "1", inputs: [], outputs: [], nodes: [], edges: [] }], requirements: [], environment: { pythonImports: [], pythonDefinitions: [] }, parameters: [] }))).toThrow(/版本无效/);
  });

  it("rejects malformed supported-version structure before migration", () => {
    expect(() => parseWorkflow(JSON.stringify({ schemaVersion: 1, name: "broken", nodes: "not-an-array", edges: [] }))).toThrow(/缺少name、nodes或edges/);
    expect(() => parseWorkflow(JSON.stringify({ schemaVersion: 2, name: "broken", nodes: [], edges: [], requirements: "numpy" }))).toThrow(/requirements 必须是字符串数组/);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseWorkflow('{"schemaVersion":99,"name":"x","nodes":[],"edges":[]}')).toThrow(
      "高于当前支持",
    );
  });

  it("supports a top-to-bottom layout for vertical ports", () => {
    const nodes = [0, 1, 2].map((index) => ({ id: String(index), position: { x: 0, y: 0 }, data: {} })) as WorkflowNode[];
    const edges = [{ id: "a", source: "0", target: "1" }, { id: "b", source: "1", target: "2" }];
    expect(compactNodeLayout(nodes, 600, "vertical", edges).map((node) => node.position)).toEqual([
      { x: 195, y: 55 }, { x: 195, y: 205 }, { x: 195, y: 355 },
    ]);
  });

  it("spreads branches across a vertical graph layer", () => {
    const branchNodes = ["root", "left", "right", "merge"].map((id) => ({ id, position: { x: 0, y: 0 }, data: {} })) as WorkflowNode[];
    const edges = [
      { id: "a", source: "root", target: "left" }, { id: "b", source: "root", target: "right" },
      { id: "c", source: "left", target: "merge" }, { id: "d", source: "right", target: "merge" },
    ];
    const arranged = compactNodeLayout(branchNodes, 900, "vertical", edges);
    const left = arranged.find((node) => node.id === "left")!;
    const right = arranged.find((node) => node.id === "right")!;
    const merge = arranged.find((node) => node.id === "merge")!;
    expect(left.position.y).toBe(right.position.y);
    expect(left.position.x).not.toBe(right.position.x);
    expect(merge.position.y).toBeGreaterThan(left.position.y);
  });

  it("keeps child nodes inside a visual structure during automatic layout", () => {
    const container = { id: "if", position: { x: 0, y: 0 }, data: {} } as WorkflowNode;
    const child = { id: "child", parentId: "if", position: { x: 80, y: 90 }, data: {} } as WorkflowNode;
    const arranged = compactNodeLayout([container, child], 900, "vertical", []);
    expect(arranged.find((node) => node.id === "child")?.position).toEqual({ x: 80, y: 90 });
    expect(arranged.find((node) => node.id === "child")?.parentId).toBe("if");
  });

  it("expands a collapsed group to its original executable graph", () => {
    const source = { id: "source", position: { x: 0, y: 0 }, data: { label: "source", nodeType: "io.read_csv", nodeVersion: 1, parameters: {}, status: "idle" } } as WorkflowNode;
    const child = { id: "child", position: { x: 0, y: 0 }, data: { label: "child", nodeType: "table.absolute", nodeVersion: 1, parameters: {}, status: "idle", canvasParentId: "group" } } as WorkflowNode;
    const group = { id: "group", position: { x: 0, y: 0 }, data: { label: "group", nodeType: "workflow.group", nodeVersion: 1, parameters: {}, status: "idle", groupInputs: [{ id: "input-1", label: "表格", valueType: "table", internalNodeId: "child", internalHandle: "input" }], groupOutputs: [{ id: "output-1", label: "表格", valueType: "table", internalNodeId: "child", internalHandle: "output" }] } } as WorkflowNode;
    const sink = { id: "sink", position: { x: 0, y: 0 }, data: { label: "sink", nodeType: "output.csv", nodeVersion: 1, parameters: {}, status: "idle" } } as WorkflowNode;
    const expanded = flattenWorkflowGroups([source, child, group, sink], [
      { id: "a", source: "source", target: "group", targetHandle: "input-1" },
      { id: "b", source: "group", sourceHandle: "output-1", target: "sink" },
    ]);
    expect(expanded.nodes.map((node) => node.id)).toEqual(["source", "child", "sink"]);
    expect(expanded.edges).toMatchObject([{ source: "source", target: "child", targetHandle: "input" }, { source: "child", sourceHandle: "output", target: "sink" }]);
  });
});
