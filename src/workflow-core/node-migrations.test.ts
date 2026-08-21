import { describe, expect, it } from "vitest";
import { createNodeMigration, migrateWorkflowNodeContracts, registerNodeMigration } from "./node-migrations";

describe("NodeSpec migration graph", () => {
  it("migrates node parameters and remaps graph/group/function handles atomically", () => {
    registerNodeMigration("phase11.test", 1, (node) => {
      const data = node.data ?? {};
      const parameters = (data.parameters ?? {}) as Record<string, unknown>;
      return {
        node: { ...node, data: { ...data, nodeVersion: 2, parameters: { renamed: parameters.legacy ?? "default" } } },
        inputHandleRenames: { oldIn: "input" },
        outputHandleRenames: { oldOut: "output" },
      };
    });
    const source = {
      schemaVersion: 3,
      name: "migration",
      nodes: [
        { id: "inside", data: { nodeType: "phase11.test", nodeVersion: 1, parameters: { legacy: "value" } } },
        { id: "group", data: { nodeType: "workflow.group", nodeVersion: 1, parameters: {}, groupInputs: [{ id: "g-in", internalNodeId: "inside", internalHandle: "oldIn" }], groupOutputs: [{ id: "g-out", internalNodeId: "inside", internalHandle: "oldOut" }] } },
      ],
      edges: [{ id: "loop", source: "inside", sourceHandle: "oldOut", target: "inside", targetHandle: "oldIn" }],
      functions: [{ id: "fn", name: "fn", version: 1, inputs: [{ id: "in", internalNodeId: "f", internalHandle: "oldIn" }], outputs: [{ id: "out", internalNodeId: "f", internalHandle: "oldOut" }], nodes: [{ id: "f", data: { nodeType: "phase11.test", nodeVersion: 1, parameters: { legacy: "fn" } } }], edges: [] }],
      requirements: [],
    };
    const migrated = migrateWorkflowNodeContracts(source, (type) => type === "phase11.test" ? 2 : 1, () => ({ addedDefault: 7 }));
    const inside = (migrated.document.nodes as Array<any>)[0];
    expect(inside.data.nodeVersion).toBe(2);
    expect(inside.data.parameters).toEqual({ addedDefault: 7, renamed: "value" });
    expect((migrated.document.edges as Array<any>)[0]).toMatchObject({ sourceHandle: "output", targetHandle: "input" });
    const group = (migrated.document.nodes as Array<any>)[1];
    expect(group.data.groupInputs[0].internalHandle).toBe("input");
    expect(group.data.groupOutputs[0].internalHandle).toBe("output");
    const fn = (migrated.document.functions as Array<any>)[0];
    expect(fn.inputs[0].internalHandle).toBe("input");
    expect(fn.outputs[0].internalHandle).toBe("output");
    expect(fn.nodes[0].data.parameters).toEqual({ addedDefault: 7, renamed: "fn" });
    expect(migrated.report.steps).toHaveLength(2);
    expect((source.nodes[0].data as any).nodeVersion).toBe(1);
  });

  it("prevents historical NodeSpec migration steps from being overwritten", () => {
    registerNodeMigration("phase11.immutable", 1, (node) => ({ ...node, data: { ...node.data, nodeVersion: 2 } }));
    expect(() => registerNodeMigration("phase11.immutable", 1, (node) => ({ ...node, data: { ...node.data, nodeVersion: 2 } }))).toThrow(/already registered/);
  });

  it("supports declarative parameter rename/defaults, port rename and node replacement", () => {
    registerNodeMigration("phase11.legacy", 1, createNodeMigration({
      renameParameters: { oldName: "newName" },
      defaults: { enabled: true },
      replaceNodeType: "phase11.current",
      targetVersion: 1,
      inputHandleRenames: { oldInput: "input" },
      outputHandleRenames: { oldOutput: "output" },
    }));
    const migrated = migrateWorkflowNodeContracts({
      nodes: [{ id: "legacy", data: { nodeType: "phase11.legacy", nodeVersion: 1, parameters: { oldName: "kept" } } }],
      edges: [],
    }, (type) => type === "phase11.legacy" ? 2 : type === "phase11.current" ? 1 : undefined);
    expect((migrated.document.nodes as Array<any>)[0].data).toMatchObject({ nodeType: "phase11.current", nodeVersion: 1, parameters: { newName: "kept", enabled: true } });
    expect(migrated.report.steps[0]).toMatchObject({ nodeType: "phase11.legacy", toNodeType: "phase11.current" });
  });

  it("refuses node migrations that change stable node ids", () => {
    registerNodeMigration("phase11.id-stability", 1, (node) => ({
      ...node,
      id: "changed-id",
      data: { ...node.data, nodeVersion: 2 },
    }));
    expect(() => migrateWorkflowNodeContracts({
      nodes: [{ id: "stable-id", data: { nodeType: "phase11.id-stability", nodeVersion: 1, parameters: {} } }],
      edges: [],
    }, () => 2)).toThrow(/不得修改节点 id/);
  });

  it("refuses a newer node contract and a missing migration step", () => {
    expect(() => migrateWorkflowNodeContracts({ nodes: [{ id: "future", data: { nodeType: "phase11.future", nodeVersion: 3, parameters: {} } }], edges: [] }, () => 2)).toThrow(/高于当前支持版本/);
    expect(() => migrateWorkflowNodeContracts({ nodes: [{ id: "old", data: { nodeType: "phase11.missing", nodeVersion: 1, parameters: {} } }], edges: [] }, () => 2)).toThrow(/缺少 phase11\.missing v1/);
  });
});
