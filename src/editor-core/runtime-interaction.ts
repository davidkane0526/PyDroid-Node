import type { WorkflowNode } from "../workflow";

export function applyRuntimeNodeParameterOverride(
  nodes: WorkflowNode[],
  nodeId: string,
  patch: Record<string, string | number | boolean | null>,
): WorkflowNode[] {
  let found = false;
  const next = nodes.map((node) => {
    if (node.id !== nodeId) return node;
    found = true;
    return {
      ...node,
      data: {
        ...node.data,
        parameters: { ...node.data.parameters, ...patch },
      },
    };
  });
  return found ? next : nodes;
}
