import { describe, expect, it } from "vitest";
import { validateWorkflowDocument } from "./validation";

describe("workflow validation", () => {
  it("rejects unknown node types using the shared node contract", () => {
    expect(() => validateWorkflowDocument({
      name: "bad",
      nodes: [{ id: "n1", data: { nodeType: "unknown.node" } }],
      edges: [],
    })).toThrow(/未知节点类型/);
  });

  it("accepts known node types", () => {
    expect(() => validateWorkflowDocument({
      name: "ok",
      nodes: [{ id: "n1", data: { nodeType: "python.print" } }],
      edges: [],
    })).not.toThrow();
  });
});
