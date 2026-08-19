import { describe, expect, it } from "vitest";
import { validateWorkflowDocument } from "./validation";

const node = (id: string, nodeType: string, nodeVersion = 1) => ({ id, data: { nodeType, nodeVersion } });

describe("workflow validation", () => {
  it("rejects unknown node types through NodeContract", () => {
    expect(() => validateWorkflowDocument({ name: "bad", nodes: [node("n1", "unknown.node")], edges: [] })).toThrow(/未知节点类型/);
  });

  it("rejects node versions newer than the contract", () => {
    expect(() => validateWorkflowDocument({ name: "future", nodes: [node("n1", "python.print", 99)], edges: [] })).toThrow(/高于当前支持版本/);
  });

  it("rejects explicit unknown ports", () => {
    expect(() => validateWorkflowDocument({
      name: "bad-port",
      nodes: [node("source", "generate.empty_table"), node("target", "python.print")],
      edges: [{ source: "source", target: "target", sourceHandle: "missing", targetHandle: "input" }],
    })).toThrow(/不存在输出端口/);
  });

  it("rejects incompatible declared port types", () => {
    expect(() => validateWorkflowDocument({
      name: "bad-type",
      nodes: [node("source", "generate.empty_table"), node("target", "python.round")],
      edges: [{ source: "source", target: "target", sourceHandle: "output", targetHandle: "input" }],
    })).toThrow(/连线类型不兼容/);
  });

  it("accepts compatible declared ports", () => {
    expect(() => validateWorkflowDocument({
      name: "ok",
      nodes: [node("source", "generate.empty_table"), node("target", "python.print")],
      edges: [{ source: "source", target: "target", sourceHandle: "output", targetHandle: "input" }],
    })).not.toThrow();
  });
});
