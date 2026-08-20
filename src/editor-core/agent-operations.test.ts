import { describe, expect, it } from "vitest";
import { getNodeSpec } from "../nodeCatalog";
import type { WorkflowNode } from "../workflow";
import { emptyWorkflowSnapshot } from "../workflow-core";
import { applyAgentOperationsToSession } from "./agent-operations";
import { EditorWorkspaceSession } from "./session";

function createNode(id: string, nodeType: string, x: number, y: number, parameters: Record<string, string | number | boolean | null>): WorkflowNode {
  const spec = getNodeSpec(nodeType);
  if (!spec) throw new Error(`missing spec: ${nodeType}`);
  return {
    id,
    type: "workflowNode",
    position: { x, y },
    data: {
      nodeType,
      label: spec.label,
      parameters: { ...spec.defaults, ...parameters },
    },
  } as WorkflowNode;
}

describe("AI Editor Core batch transaction", () => {
  it("applies a valid plan as one undoable session transaction", () => {
    const session = new EditorWorkspaceSession("agent", emptyWorkflowSnapshot());
    const result = applyAgentOperationsToSession(session, [
      { type: "add_node", id: "source", nodeType: "generate.random_table", parameters: {} },
      { type: "add_node", id: "abs", nodeType: "table.absolute", parameters: {} },
      { type: "connect", source: "source", target: "abs" },
      { type: "arrange", direction: "horizontal" },
    ], { canvasId: null, viewportWidth: 1200, createNode });

    expect(result.changed).toBe(true);
    expect(result.snapshot.nodes).toHaveLength(2);
    expect(result.snapshot.edges).toHaveLength(1);
    expect(session.history.entries).toHaveLength(1);
    expect(session.undo()?.nodes).toHaveLength(0);
  });

  it("rejects an invalid plan without partially mutating the workspace", () => {
    const session = new EditorWorkspaceSession("agent", emptyWorkflowSnapshot());
    expect(() => applyAgentOperationsToSession(session, [
      { type: "add_node", id: "temporary", nodeType: "generate.random_table", parameters: {} },
      { type: "connect", source: "missing", target: "temporary" },
    ], { canvasId: null, viewportWidth: 1200, createNode })).toThrow();
    expect(session.getRuntimeState().snapshot.nodes).toHaveLength(0);
    expect(session.getRuntimeState().snapshot.edges).toHaveLength(0);
    expect(session.history.entries).toHaveLength(0);
  });
});
