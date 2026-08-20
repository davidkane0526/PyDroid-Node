import { deleteNodesFromGraph, disconnectEdgesFromGraph, disconnectNodesFromGraph } from "../workflow-core/commands";
import { cloneWorkflowSnapshot, type WorkflowSnapshot } from "../workflow-core/model";

export type EditorGraphCommand =
  | { type: "delete-nodes"; nodeIds: string[] }
  | { type: "disconnect-nodes"; nodeIds: string[] }
  | { type: "disconnect-edges"; edgeIds: string[] };

export type EditorGraphCommandResult = {
  snapshot: WorkflowSnapshot;
  changed: boolean;
  affectedCount: number;
};

export function applyEditorGraphCommand(snapshot: WorkflowSnapshot, command: EditorGraphCommand): EditorGraphCommandResult {
  if (command.type === "delete-nodes") {
    const next = deleteNodesFromGraph(snapshot.nodes, snapshot.edges, command.nodeIds);
    return {
      snapshot: { ...cloneWorkflowSnapshot(snapshot), nodes: next.nodes, edges: next.edges },
      changed: next.removedIds.size > 0,
      affectedCount: next.removedIds.size,
    };
  }
  if (command.type === "disconnect-nodes") {
    const edges = disconnectNodesFromGraph(snapshot.edges, command.nodeIds);
    return {
      snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
      changed: edges.length !== snapshot.edges.length,
      affectedCount: snapshot.edges.length - edges.length,
    };
  }
  const edges = disconnectEdgesFromGraph(snapshot.edges, command.edgeIds);
  return {
    snapshot: { ...cloneWorkflowSnapshot(snapshot), edges },
    changed: edges.length !== snapshot.edges.length,
    affectedCount: snapshot.edges.length - edges.length,
  };
}
