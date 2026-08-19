import { parseWorkflow, serializeWorkflow, type WorkflowDocument } from "../workflow";
import { workflowSnapshotForPersistence, workflowSnapshotSignature, type WorkflowSnapshot } from "./model";

export function serializeWorkflowSnapshot(name: string, snapshot: WorkflowSnapshot): WorkflowDocument {
  const persistent = workflowSnapshotForPersistence(snapshot);
  return serializeWorkflow(name, persistent.nodes, persistent.edges, persistent.requirements ?? [], persistent.functions ?? []);
}

export function stringifyWorkflowSnapshot(name: string, snapshot: WorkflowSnapshot, pretty = true): string {
  return JSON.stringify(serializeWorkflowSnapshot(name, snapshot), null, pretty ? 2 : undefined);
}

export function parseWorkflowSnapshot(text: string, fallbackRequirements: string[] = []): WorkflowSnapshot {
  const document = parseWorkflow(text);
  return { nodes: document.nodes, edges: document.edges, functions: document.functions ?? [], requirements: document.requirements ?? fallbackRequirements };
}

export { workflowSnapshotSignature };
