import { executeNode, type NodeOutput } from "../nodes";
import { containerChildren, dataEdges, nodeUpstream, orderedNodes } from "./graph";
import type { Workflow, WorkflowInputFile, WorkflowNode } from "./types";
import { executeGenericStructure, GENERIC_VISUAL_STRUCTURE_TYPES } from "./generic-structures";

function executeContainerGraph(
  workflow: Workflow,
  children: WorkflowNode[],
  seed: unknown,
  csvText: string,
  inputFiles: WorkflowInputFile[],
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
  workspaceVariables: Map<string, unknown>,
  executeChild?: (node: WorkflowNode, upstream: unknown) => NodeOutput,
): unknown {
  const childIds = new Set(children.map((child) => child.id));
  const internalEdges = dataEdges(workflow).filter((edge) => childIds.has(edge.source) && childIds.has(edge.target));
  const internalWorkflow: Workflow = { nodes: children, edges: internalEdges };
  const values = new Map<string, Record<string, unknown>>();
  const ordered = orderedNodes(internalWorkflow);
  for (const child of ordered) {
    const hasInternalInput = internalEdges.some((edge) => edge.target === child.id);
    const upstream = hasInternalInput ? nodeUpstream(child.id, child.data.nodeType, internalWorkflow, values) : seed;
    const result = GENERIC_VISUAL_STRUCTURE_TYPES.has(child.data.nodeType)
      ? { outputs: executeVisualStructure(child, workflow, upstream, csvText, inputFiles, notebookNamespace, variables, workspaceVariables, executeChild) }
      : executeChild
        ? executeChild(child, upstream)
        : executeNode(child.data.nodeType, child.data.parameters, upstream, { csvText, inputFiles, notebookNamespace, variables, workspaceVariables });
    values.set(child.id, result.outputs);
  }
  if (!ordered.length) return seed;
  const sinks = ordered.filter((child) => !internalEdges.some((edge) => edge.source === child.id));
  if (sinks.length > 1) throw new Error("Structure branch must have exactly one output node; found multiple unconnected sinks");
  const selected = sinks[0] ?? ordered[ordered.length - 1];
  const outputs = values.get(selected.id) ?? {};
  return outputs.output ?? Object.values(outputs)[0] ?? seed;
}

export function executeVisualStructure(
  node: WorkflowNode,
  workflow: Workflow,
  upstream: unknown,
  csvText: string,
  inputFiles: WorkflowInputFile[],
  notebookNamespace: Record<string, unknown>,
  variables: Map<string, unknown>,
  workspaceVariables: Map<string, unknown>,
  executeChild?: (node: WorkflowNode, upstream: unknown) => NodeOutput,
): Record<string, unknown> {
  if (!GENERIC_VISUAL_STRUCTURE_TYPES.has(node.data.nodeType)) {
    throw new Error(`Unsupported visual structure: ${node.data.nodeType}`);
  }
  return executeGenericStructure(node, upstream, (branch, seed) =>
    executeContainerGraph(
      workflow,
      containerChildren(workflow, node.id, branch),
      seed,
      csvText,
      inputFiles,
      notebookNamespace,
      variables,
      workspaceVariables,
      executeChild,
    ),
    notebookNamespace,
  );
}
