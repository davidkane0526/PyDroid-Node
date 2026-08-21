import type { Edge, Node } from "@xyflow/react";
import type { PortSpec, ValueType } from "./nodeCatalog";
import { migrateWorkflowDocumentWithReport, normalizeWorkflowNodeVersions, validateWorkflowMigrationEnvelope, workflowSchemaVersionOf, type WorkflowSchemaMigrationStep } from "./workflow-core/migrations";
import { CURRENT_WORKFLOW_SCHEMA_VERSION, ensureBuiltInWorkflowMigrationsRegistered } from "./workflow-core/schema-migrations";
import { migrateWorkflowNodeContracts, type NodeMigrationStep } from "./workflow-core/node-migrations";
import { reconcileWorkflowFunctionCalls, type FunctionCallMigrationStep } from "./workflow-core/function-migrations";
import { getNodeContract } from "./nodeContract";
import { getNodeSpec } from "./nodeCatalog";
import { validateWorkflowDocument } from "./workflow-core/validation";

export const WORKFLOW_SCHEMA_VERSION = CURRENT_WORKFLOW_SCHEMA_VERSION;

ensureBuiltInWorkflowMigrationsRegistered();

export type NodeStatus = "idle" | "running" | "success" | "error";

export type WorkflowNodeData = {
  label: string;
  nodeType: string;
  nodeVersion: number;
  parameters: Record<string, string | number | boolean | null>;
  status: NodeStatus;
  tags?: string[];
  branch?: "true" | "false" | "body";
  canvasParentId?: string;
  groupInputs?: WorkflowGroupPort[];
  groupOutputs?: WorkflowGroupPort[];
  functionInputs?: PortSpec[];
  functionOutputs?: PortSpec[];
  functionSourceId?: string;
};

export type WorkflowGroupPort = {
  id: string;
  label: string;
  valueType: ValueType;
  internalNodeId: string;
  internalHandle?: string | null;
};

export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowFunctionDefinition = {
  id: string;
  name: string;
  version: number;
  description?: string;
  inputs: WorkflowGroupPort[];
  outputs: WorkflowGroupPort[];
  nodes: WorkflowNode[];
  edges: Edge[];
};

export type WorkflowDocument = {
  schemaVersion: number;
  name: string;
  nodes: WorkflowNode[];
  edges: Edge[];
  functions: WorkflowFunctionDefinition[];
  requirements: string[];
};

export function normalizeNodePositions(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node, index) => {
    const { x, y } = node.position ?? {};
    const valid = Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 20_000 && Math.abs(y) <= 20_000;
    if (valid) return node;
    return {
      ...node,
      position: {
        x: 45 + (index % 4) * 196,
        y: 55 + Math.floor(index / 4) * 112,
      },
    };
  });
}

export function flattenWorkflowGroups(nodes: WorkflowNode[], edges: Edge[]): { nodes: WorkflowNode[]; edges: Edge[] } {
  let flatEdges = edges.map((edge) => ({ ...edge }));
  const groups = new Map(nodes.filter((node) => node.data.nodeType === "workflow.group").map((node) => [node.id, node]));
  for (let pass = 0; pass <= groups.size; pass += 1) {
    let changed = false;
    flatEdges = flatEdges.flatMap((edge) => {
      const targetGroup = groups.get(edge.target);
      if (targetGroup) {
        const port = (targetGroup.data.groupInputs ?? []).find((item) => item.id === edge.targetHandle);
        if (!port) return [];
        changed = true;
        return [{ ...edge, target: port.internalNodeId, targetHandle: port.internalHandle ?? undefined }];
      }
      const sourceGroup = groups.get(edge.source);
      if (sourceGroup) {
        const port = (sourceGroup.data.groupOutputs ?? []).find((item) => item.id === edge.sourceHandle);
        if (!port) return [];
        changed = true;
        return [{ ...edge, source: port.internalNodeId, sourceHandle: port.internalHandle ?? undefined }];
      }
      return [edge];
    });
    if (!changed) break;
  }
  return {
    nodes: nodes.filter((node) => node.data.nodeType !== "workflow.group").map((node) => ({
      ...node,
      data: { ...node.data, canvasParentId: undefined },
    })),
    edges: flatEdges,
  };
}

export function compactNodeLayout(nodes: WorkflowNode[], viewportWidth = 1200, direction: "horizontal" | "vertical" = "horizontal", edges: Edge[] = []): WorkflowNode[] {
  if (nodes.some((node) => node.data.canvasParentId)) {
    const canvasIds = new Set<string | null>(nodes.map((node) => node.data.canvasParentId ?? null));
    const positions = new Map<string, { x: number; y: number }>();
    for (const canvasId of canvasIds) {
      const layer = nodes.filter((node) => (node.data.canvasParentId ?? null) === canvasId);
      const layerIds = new Set(layer.map((node) => node.id));
      const arranged = compactNodeLayout(
        layer.map((node) => ({ ...node, data: { ...node.data, canvasParentId: undefined } })),
        viewportWidth, direction, edges.filter((edge) => layerIds.has(edge.source) && layerIds.has(edge.target)),
      );
      arranged.forEach((node) => positions.set(node.id, node.position));
    }
    return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
  }
  const layoutNodes = nodes.filter((node) => !node.parentId);
  const byId = new Map(layoutNodes.map((node) => [node.id, node]));
  const outgoing = new Map(layoutNodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(layoutNodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.targetHandle === "continue") continue;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const depth = new Map<string, number>();
  const queue = layoutNodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  queue.forEach((id) => depth.set(id, 0));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    for (const target of outgoing.get(source) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(source) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  let fallbackDepth = Math.max(0, ...depth.values()) + 1;
  for (const node of layoutNodes) if (!depth.has(node.id)) depth.set(node.id, fallbackDepth++);
  const layers = new Map<number, WorkflowNode[]>();
  for (const node of layoutNodes) {
    const layer = depth.get(node.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }
  const orderedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
  // Use actual measured dimensions when they are available. Fixed offsets caused wide
  // nodes and structure nodes to visually drift out of their rows and columns.
  const sizeOf = (node: WorkflowNode) => ({
    width: Number(node.measured?.width ?? node.width ?? node.style?.width ?? 210),
    height: Number(node.measured?.height ?? node.height ?? node.style?.height ?? 86),
  });
  const positions = new Map<string, { x: number; y: number }>();
  if (direction === "vertical") {
    let y = 55;
    for (const [, items] of orderedLayers) {
      const sizes = items.map(sizeOf);
      const rowWidth = sizes.reduce((total, size) => total + size.width, 0) + Math.max(0, items.length - 1) * 50;
      let x = Math.max(40, (Math.max(viewportWidth, 360) - rowWidth) / 2);
      const rowHeight = Math.max(...sizes.map((size) => size.height), 86);
      items.forEach((node, index) => {
        positions.set(node.id, { x, y });
        x += sizes[index].width + 50;
      });
      y += rowHeight + 64;
    }
  } else {
    const columnHeights = orderedLayers.map(([, items]) => items.map(sizeOf).reduce((total, size) => total + size.height, 0) + Math.max(0, items.length - 1) * 46);
    const maxColumnHeight = Math.max(86, ...columnHeights);
    let x = 45;
    orderedLayers.forEach(([, items], layerIndex) => {
      const sizes = items.map(sizeOf);
      let y = 55 + (maxColumnHeight - columnHeights[layerIndex]) / 2;
      const columnWidth = Math.max(...sizes.map((size) => size.width), 210);
      items.forEach((node, index) => {
        positions.set(node.id, { x, y });
        y += sizes[index].height + 46;
      });
      x += columnWidth + 85;
    });
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}

export function collectReachableFunctionNodes(nodes: WorkflowNode[], functions: WorkflowFunctionDefinition[] = []): WorkflowNode[] {
  const byId = new Map(functions.map((definition) => [definition.id, definition]));
  const collected: WorkflowNode[] = [...nodes];
  const visited = new Set<string>();
  const visitNodes = (items: WorkflowNode[]) => {
    for (const node of items) {
      if (node.data.nodeType !== "function.call" && node.data.nodeType !== "function.map") continue;
      const functionId = String(node.data.parameters.functionId ?? "").trim();
      if (!functionId || visited.has(functionId)) continue;
      visited.add(functionId);
      const definition = byId.get(functionId);
      if (!definition) continue;
      collected.push(...definition.nodes);
      visitNodes(definition.nodes);
    }
  };
  visitNodes(nodes);
  return collected;
}

export function serializeWorkflow(
  name: string,
  nodes: WorkflowNode[],
  edges: Edge[],
  requirements: string[] = [],
  functions: WorkflowFunctionDefinition[] = [],
): WorkflowDocument {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    name,
    nodes,
    edges,
    functions,
    requirements,
  };
}

export type WorkflowCompatibilityReport = {
  schemaFromVersion: number;
  schemaToVersion: number;
  schemaSteps: WorkflowSchemaMigrationStep[];
  nodeSteps: NodeMigrationStep[];
  functionCallSteps: FunctionCallMigrationStep[];
};

export function parseWorkflowWithReport(text: string): { document: WorkflowDocument; report: WorkflowCompatibilityReport } {
  const parsed: unknown = JSON.parse(text);
  const sourceVersion = workflowSchemaVersionOf(parsed);
  // Future documents are rejected by version before this build interprets their shape.
  // Supported historical documents receive a minimal structural check before any
  // migration is allowed to transform them, then full semantic validation runs after
  // schema/NodeSpec/function reconciliation.
  if (sourceVersion <= WORKFLOW_SCHEMA_VERSION) validateWorkflowMigrationEnvelope(parsed);
  const schema = migrateWorkflowDocumentWithReport(parsed, WORKFLOW_SCHEMA_VERSION);
  const normalized = normalizeWorkflowNodeVersions(schema.document);
  const nodes = migrateWorkflowNodeContracts(
    normalized,
    (nodeType) => getNodeContract(nodeType)?.version,
    (nodeType) => getNodeSpec(nodeType)?.defaults,
  );
  const functions = reconcileWorkflowFunctionCalls(nodes.document);
  const document = functions.document;
  validateWorkflowDocument(document);
  return {
    document,
    report: {
      schemaFromVersion: schema.fromVersion,
      schemaToVersion: schema.toVersion,
      schemaSteps: schema.steps,
      nodeSteps: nodes.report.steps,
      functionCallSteps: functions.steps,
    },
  };
}

export function parseWorkflow(text: string): WorkflowDocument {
  return parseWorkflowWithReport(text).document;
}
