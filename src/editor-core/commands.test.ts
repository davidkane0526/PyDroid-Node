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
