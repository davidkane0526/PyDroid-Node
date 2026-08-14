import { describe, expect, it } from "vitest";
import { compactNodeLayout, flattenWorkflowGroups, normalizeNodePositions, parseWorkflow, serializeWorkflow, WORKFLOW_SCHEMA_VERSION, type WorkflowNode } from "./workflow";

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

  it("repairs non-finite or extreme node positions", () => {
    const node = { id: "bad", position: { x: 1, y: 451469 }, data: {} } as WorkflowNode;
    expect(normalizeNodePositions([node])[0].position).toEqual({ x: 45, y: 55 });
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseWorkflow('{"schemaVersion":99,"name":"x","nodes":[],"edges":[]}')).toThrow(
      "不支持的工作流版本",
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
