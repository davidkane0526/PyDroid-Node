import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "../../workflow";
import { javascriptRuntime } from "./adapter";

function node(id: string, nodeType: string): WorkflowNode {
  return {
    id,
    type: "workflowNode",
    position: { x: 0, y: 0 },
    data: {
      label: nodeType,
      nodeType,
      parameters: {},
      status: "idle",
    },
  } as WorkflowNode;
}

describe("javascript runtime compatibility", () => {
  it("accepts a common table pipeline", () => {
    const support = javascriptRuntime.canExecute?.([
      node("read", "io.read_csv"),
      node("clean", "pandas.dropna"),
      node("group", "table.groupby_aggregate"),
      node("set", "variable.set"),
      node("get", "variable.get"),
      node("plot", "plot.line"),
    ]);
    expect(support?.supported).toBe(true);
  });

  it("rejects Python-source nodes so auto mode can fall back safely", () => {
    const support = javascriptRuntime.canExecute?.([node("custom", "custom.python_function")]);
    expect(support?.supported).toBe(false);
    expect(support?.reason).toContain("custom.python_function");
  });
});
