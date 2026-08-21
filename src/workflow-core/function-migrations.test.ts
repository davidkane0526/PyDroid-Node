import { describe, expect, it } from "vitest";
import { reconcileWorkflowFunctionCalls } from "./function-migrations";

describe("workflow function-call compatibility", () => {
  const definition = { id: "fn", name: "fn", version: 2, inputs: [{ id: "table", label: "Table", valueType: "table", internalNodeId: "body", internalHandle: "input" }], outputs: [{ id: "result", label: "Result", valueType: "table", internalNodeId: "body", internalHandle: "output" }], nodes: [], edges: [] };

  it("upgrades call versions when the saved signature is structurally compatible", () => {
    const migrated = reconcileWorkflowFunctionCalls({
      functions: [definition],
      nodes: [{ id: "call", data: { nodeType: "function.call", parameters: { functionId: "fn", functionVersion: 1 }, functionInputs: [{ id: "table", label: "old", valueType: "table", required: true }], functionOutputs: [{ id: "result", label: "old", valueType: "table" }] } }],
      edges: [],
    });
    expect((migrated.document.nodes as Array<any>)[0].data.parameters.functionVersion).toBe(2);
    expect((migrated.document.nodes as Array<any>)[0].data.functionInputs[0].label).toBe("Table");
    expect(migrated.steps).toEqual([{ nodeId: "call", functionId: "fn", fromVersion: 1, toVersion: 2 }]);
  });

  it("refuses to guess a changed function signature", () => {
    expect(() => reconcileWorkflowFunctionCalls({
      functions: [definition],
      nodes: [{ id: "call", data: { nodeType: "function.call", parameters: { functionId: "fn", functionVersion: 1 }, functionInputs: [{ id: "legacy", label: "legacy", valueType: "table" }], functionOutputs: [] } }],
      edges: [],
    })).toThrow(/无法安全升级/);
  });

  it("fails closed when an older call has no saved signature evidence", () => {
    expect(() => reconcileWorkflowFunctionCalls({
      functions: [definition],
      nodes: [{ id: "call", data: { nodeType: "function.call", parameters: { functionId: "fn", functionVersion: 1 } } }],
      edges: [],
    })).toThrow(/无法安全升级/);
  });

});
