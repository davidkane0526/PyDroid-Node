import type { Edge } from "@xyflow/react";
import type { WorkflowFunctionDefinition, WorkflowNode } from "../workflow";

export type WorkflowSnapshot = {
  nodes: WorkflowNode[];
  edges: Edge[];
  functions?: WorkflowFunctionDefinition[];
  requirements?: string[];
};

export type WorkspaceRuntimeInputState = {
  fileName: string | null;
  csvText: string;
  csvBytes: Uint8Array | null;
  csvFiles: Array<{ name: string; bytes: Uint8Array }>;
};

export type WorkspaceRuntimeState = {
  snapshot: WorkflowSnapshot;
  savedSignature: string;
  input?: WorkspaceRuntimeInputState;
};

export function cloneWorkflowSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return structuredClone(snapshot);
}

export function workflowSnapshotForPersistence(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => {
      const { selected: _selected, dragging: _dragging, measured: _measured, className: _className, ...rest } = node;
      const { status: _status, ...data } = node.data;
      return { ...rest, data } as WorkflowNode;
    }),
    edges: snapshot.edges.map((edge) => {
      const { selected: _selected, ...rest } = edge;
      return rest as Edge;
    }),
    functions: structuredClone(snapshot.functions ?? []),
    requirements: [...(snapshot.requirements ?? [])],
  };
}

export function workflowSnapshotSignature(snapshot: WorkflowSnapshot): string {
  return JSON.stringify(workflowSnapshotForPersistence(snapshot));
}

export function workflowHasContent(snapshot: WorkflowSnapshot): boolean {
  return snapshot.nodes.length > 0 || snapshot.edges.length > 0 || Boolean(snapshot.functions?.length) || Boolean(snapshot.requirements?.length);
}

export function emptyWorkflowSnapshot(): WorkflowSnapshot {
  return { nodes: [], edges: [], functions: [], requirements: [] };
}

export function createWorkspaceRuntimeState(snapshot: WorkflowSnapshot = emptyWorkflowSnapshot(), savedSignature?: string): WorkspaceRuntimeState {
  const cloned = cloneWorkflowSnapshot(snapshot);
  return { snapshot: cloned, savedSignature: savedSignature ?? workflowSnapshotSignature(cloned) };
}
