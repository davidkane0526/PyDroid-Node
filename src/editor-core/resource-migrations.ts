import { parseWorkflow, serializeWorkflow, WORKFLOW_SCHEMA_VERSION, type WorkflowNode } from "../workflow";
import { getNodeContract } from "../nodeContract";
import { getNodeSpec } from "../nodeCatalog";
import { isWorkflowCompatibilityError, normalizeWorkflowNodeVersions, WorkflowCompatibilityError } from "../workflow-core/migrations";
import { migrateWorkflowNodeContracts } from "../workflow-core/node-migrations";
import type { FlowLibraryEntry, GroupLibraryEntry, SavedNodeEntry } from "./resource-contract";

export const EDITOR_RESOURCE_SCHEMA_VERSION = 2;

function resourceVersion(value: { resourceSchemaVersion?: number }): number | null {
  const version = value.resourceSchemaVersion ?? 1;
  return typeof version === "number" && Number.isInteger(version) && version >= 1 ? version : null;
}

function compatibilityForError(error: unknown): "future" | "invalid" {
  return isWorkflowCompatibilityError(error, "future-schema-version")
    || isWorkflowCompatibilityError(error, "future-node-version")
    || isWorkflowCompatibilityError(error, "future-function-version")
    ? "future"
    : "invalid";
}

function migrateResourceGraph(nodes: WorkflowNode[], edges: unknown[]): { nodes: WorkflowNode[]; edges: unknown[] } {
  const normalized = normalizeWorkflowNodeVersions({ nodes, edges });
  const migrated = migrateWorkflowNodeContracts(
    normalized,
    (nodeType) => getNodeContract(nodeType)?.version,
    (nodeType) => getNodeSpec(nodeType)?.defaults,
  );
  const migratedNodes = (migrated.document.nodes ?? []) as WorkflowNode[];
  for (const node of migratedNodes) {
    if (!getNodeContract(node.data.nodeType)) {
      throw new WorkflowCompatibilityError("invalid-node-migration", `资源包含未知节点类型：${node.data.nodeType}`, { nodeId: node.id, nodeType: node.data.nodeType });
    }
  }
  return { nodes: migratedNodes, edges: (migrated.document.edges ?? []) as unknown[] };
}

function canonicalNode(node: WorkflowNode): WorkflowNode {
  const migrated = migrateResourceGraph([node], []);
  return migrated.nodes[0];
}

export function migrateSavedNodeEntry(entry: SavedNodeEntry): SavedNodeEntry {
  const version = resourceVersion(entry);
  if (version === null) return { ...entry, compatibility: "invalid" };
  if (version > EDITOR_RESOURCE_SCHEMA_VERSION) return { ...entry, compatibility: "future" };
  try {
    const node = canonicalNode(entry.node);
    return {
      ...entry,
      resourceSchemaVersion: EDITOR_RESOURCE_SCHEMA_VERSION,
      compatibility: version < EDITOR_RESOURCE_SCHEMA_VERSION ? "migrated" : "current",
      node,
    };
  } catch (error) {
    return { ...entry, compatibility: compatibilityForError(error) };
  }
}

export function migrateGroupEntry(entry: GroupLibraryEntry): GroupLibraryEntry {
  const version = resourceVersion(entry);
  if (version === null) return { ...entry, compatibility: "invalid" };
  if (version > EDITOR_RESOURCE_SCHEMA_VERSION) return { ...entry, compatibility: "future" };
  try {
    // Group/saved-node resources are fragments, not standalone WorkflowDocuments.
    // Migrate their NodeSpecs and graph handles without applying document-level
    // semantic checks that require context the fragment intentionally does not own
    // (for example a function.call that binds to a definition in the destination flow).
    const graph = migrateResourceGraph(entry.nodes, entry.edges);
    return {
      ...entry,
      resourceSchemaVersion: EDITOR_RESOURCE_SCHEMA_VERSION,
      compatibility: version < EDITOR_RESOURCE_SCHEMA_VERSION ? "migrated" : "current",
      nodes: graph.nodes,
      edges: graph.edges as GroupLibraryEntry["edges"],
    };
  } catch (error) {
    return { ...entry, compatibility: compatibilityForError(error) };
  }
}

export function migrateFlowEntry(entry: FlowLibraryEntry): FlowLibraryEntry {
  const version = resourceVersion(entry);
  if (version === null) return { ...entry, compatibility: "invalid" };
  if (version > EDITOR_RESOURCE_SCHEMA_VERSION) return { ...entry, compatibility: "future" };
  try {
    const document = parseWorkflow(entry.document);
    const migrated = document.schemaVersion === WORKFLOW_SCHEMA_VERSION
      ? JSON.stringify(document, null, 2)
      : entry.document;
    return {
      ...entry,
      resourceSchemaVersion: EDITOR_RESOURCE_SCHEMA_VERSION,
      compatibility: version < EDITOR_RESOURCE_SCHEMA_VERSION || migrated !== entry.document ? "migrated" : "current",
      document: migrated,
    };
  } catch (error) {
    return { ...entry, compatibility: compatibilityForError(error) };
  }
}

export function canonicalFlowDocument(name: string, document: string): string {
  const parsed = parseWorkflow(document);
  return JSON.stringify(serializeWorkflow(name || parsed.name, parsed.nodes, parsed.edges, parsed.requirements, parsed.functions, parsed.environment, parsed.parameters), null, 2);
}
