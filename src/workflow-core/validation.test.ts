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


  it("validates versioned reusable function calls and dynamic ports", () => {
    const functions = [{
      id: "fn-abs", name: "Abs", version: 1,
      inputs: [{ id: "table", label: "Table", valueType: "table", internalNodeId: "abs", internalHandle: "input" }],
      outputs: [{ id: "result", label: "Result", valueType: "table", internalNodeId: "abs", internalHandle: "output" }],
      nodes: [node("abs", "table.absolute")], edges: [],
    }];
    expect(() => validateWorkflowDocument({
      name: "functions", functions,
      nodes: [node("source", "generate.empty_table"), { id: "call", data: { nodeType: "function.call", nodeVersion: 1, parameters: { functionId: "fn-abs", functionVersion: 1 } } }],
      edges: [{ source: "source", target: "call", sourceHandle: "output", targetHandle: "table" }],
    })).not.toThrow();
  });

  it("validates function.map against its collected-list port instead of the scalar function input type", () => {
    const functions = [{
      id: "fn-abs-map", name: "Abs", version: 1,
      inputs: [{ id: "table", label: "Table", valueType: "table", internalNodeId: "abs", internalHandle: "input" }],
      outputs: [{ id: "result", label: "Result", valueType: "table", internalNodeId: "abs", internalHandle: "output" }],
      nodes: [node("abs", "table.absolute")], edges: [],
    }];
    const mapNode = { id: "map", data: {
      nodeType: "function.map", nodeVersion: 1, parameters: { functionId: "fn-abs-map", functionVersion: 1, mapInput: "table", collectMode: "list" },
      functionInputs: [{ id: "table", label: "Table 列表", valueType: "list", required: true }],
      functionOutputs: [{ id: "output", label: "结果列表", valueType: "list" }],
    } };
    expect(() => validateWorkflowDocument({
      name: "function-map", functions,
      nodes: [node("source", "generate.empty_list"), mapNode],
      edges: [{ source: "source", target: "map", sourceHandle: "output", targetHandle: "table" }],
    })).not.toThrow();
    expect(() => validateWorkflowDocument({
      name: "bad-function-map", functions,
      nodes: [{ ...mapNode, data: { ...mapNode.data, parameters: { ...mapNode.data.parameters, mapInput: "missing" } } }], edges: [],
    })).toThrow(/mapInput/);
    expect(() => validateWorkflowDocument({
      name: "bad-function-map-mode", functions,
      nodes: [{ ...mapNode, data: { ...mapNode.data, parameters: { ...mapNode.data.parameters, collectMode: "mystery" } } }], edges: [],
    })).toThrow(/collectMode/);
    expect(() => validateWorkflowDocument({
      name: "bad-function-map-concat", functions,
      nodes: [{ ...mapNode, data: { ...mapNode.data, parameters: { ...mapNode.data.parameters, collectMode: "concat_columns" } } }], edges: [],
    })).toThrow(/concatInitialVariable/);
  });

  it("rejects function version drift and recursive definitions", () => {
    const definition = {
      id: "fn-rec", name: "Recursive", version: 2, inputs: [],
      outputs: [{ id: "result", label: "Result", valueType: "any", internalNodeId: "self", internalHandle: "output" }],
      nodes: [{ id: "self", data: { nodeType: "function.call", nodeVersion: 1, parameters: { functionId: "fn-rec", functionVersion: 2 } } }], edges: [],
    };
    expect(() => validateWorkflowDocument({ name: "recursive", functions: [definition], nodes: [], edges: [] })).toThrow(/递归环/);
    expect(() => validateWorkflowDocument({
      name: "mismatch",
      functions: [{ ...definition, nodes: [node("range", "logic.for_range")], outputs: [{ id: "result", label: "Result", valueType: "table", internalNodeId: "range", internalHandle: "output" }] }],
      nodes: [{ id: "call", data: { nodeType: "function.call", nodeVersion: 1, parameters: { functionId: "fn-rec", functionVersion: 1 } } }], edges: [],
    })).toThrow(/版本不匹配/);
  });
});
