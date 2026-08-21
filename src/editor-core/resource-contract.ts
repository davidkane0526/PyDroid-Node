import type { Edge } from "@xyflow/react";
import type { WorkflowFunctionDefinition, WorkflowNode } from "../workflow";

export type EditorResourceKind = "node" | "saved-node" | "function" | "group" | "flow";
export type EditorResourcePrimaryAction = "insert" | "call" | "open";
export type EditorResourceCompatibility = "current" | "migrated" | "future" | "invalid";

export type FlowLibraryEntry = {
  resourceSchemaVersion?: number;
  compatibility?: EditorResourceCompatibility;
  id: string;
  name: string;
  savedAt: string;
  document: string;
  uri?: string;
  external?: boolean;
  locked?: boolean;
};

export type GroupLibraryEntry = {
  resourceSchemaVersion?: number;
  compatibility?: EditorResourceCompatibility;
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: Edge[];
  builtIn?: boolean;
  locked?: boolean;
};

export type SavedNodeEntry = {
  resourceSchemaVersion?: number;
  compatibility?: EditorResourceCompatibility;
  id: string;
  name: string;
  node: WorkflowNode;
  savedAt: string;
  locked?: boolean;
};

export type EditorResourceRef = {
  kind: EditorResourceKind;
  id: string;
  label: string;
};

export type EditorResourceCapabilities = {
  primaryAction: EditorResourcePrimaryAction;
  draggable: boolean;
  rename: boolean;
  remove: boolean;
  lock: boolean;
};

export type EditorResourceDescriptor = EditorResourceRef & {
  description?: string;
  builtIn?: boolean;
  locked?: boolean;
  capabilities: EditorResourceCapabilities;
};


export function isEditorResourceUsable(entry: { compatibility?: EditorResourceCompatibility }): boolean {
  return entry.compatibility !== "future" && entry.compatibility !== "invalid";
}

const CAPABILITIES: Record<EditorResourceKind, EditorResourceCapabilities> = {
  node: { primaryAction: "insert", draggable: true, rename: false, remove: false, lock: false },
  "saved-node": { primaryAction: "insert", draggable: true, rename: true, remove: true, lock: true },
  function: { primaryAction: "call", draggable: false, rename: false, remove: true, lock: false },
  group: { primaryAction: "insert", draggable: true, rename: true, remove: true, lock: true },
  flow: { primaryAction: "open", draggable: true, rename: true, remove: true, lock: true },
};

export function resourceCapabilities(kind: EditorResourceKind, options: { builtIn?: boolean; external?: boolean; locked?: boolean } = {}): EditorResourceCapabilities {
  const base = CAPABILITIES[kind];
  if (options.builtIn) return { ...base, rename: false, remove: false, lock: false };
  const resolved = { ...base };
  if (options.locked) return { ...resolved, rename: false, remove: false };
  return resolved;
}

export function describeCatalogNode(id: string, label: string): EditorResourceDescriptor {
  return { kind: "node", id, label, capabilities: resourceCapabilities("node") };
}

export function describeSavedNode(entry: SavedNodeEntry): EditorResourceDescriptor {
  const capabilities = resourceCapabilities("saved-node", { locked: entry.locked });
  return { kind: "saved-node", id: entry.id, label: entry.name, locked: entry.locked, capabilities: isEditorResourceUsable(entry) ? capabilities : { ...capabilities, draggable: false, rename: false, remove: false, lock: false } };
}

export function describeFunction(definition: WorkflowFunctionDefinition): EditorResourceDescriptor {
  return {
    kind: "function",
    id: definition.id,
    label: definition.name,
    description: definition.description,
    capabilities: resourceCapabilities("function"),
  };
}

export function describeGroup(entry: GroupLibraryEntry): EditorResourceDescriptor {
  const capabilities = resourceCapabilities("group", { builtIn: entry.builtIn, locked: entry.locked });
  return {
    kind: "group",
    id: entry.id,
    label: entry.name,
    description: entry.description,
    builtIn: entry.builtIn,
    locked: entry.locked,
    capabilities: isEditorResourceUsable(entry) ? capabilities : { ...capabilities, draggable: false, rename: false, remove: false, lock: false },
  };
}

export function describeFlow(entry: FlowLibraryEntry): EditorResourceDescriptor {
  const capabilities = resourceCapabilities("flow", { external: entry.external, locked: entry.locked });
  return {
    kind: "flow",
    id: entry.id,
    label: entry.name,
    locked: entry.locked,
    capabilities: isEditorResourceUsable(entry) ? capabilities : { ...capabilities, draggable: false, rename: false, remove: false, lock: false },
  };
}

export function resourceRef(resource: Pick<EditorResourceDescriptor, "kind" | "id" | "label">): EditorResourceRef {
  return { kind: resource.kind, id: resource.id, label: resource.label };
}

export function resourceContractKey(resource: Pick<EditorResourceRef, "kind" | "id">): string {
  return `${resource.kind}:${resource.id}`;
}
