import type { StorageLike } from "../workflow-core";
import { readStorage, writeStorage } from "../workflow-core";
import { describeFlow, describeGroup, describeSavedNode, isEditorResourceUsable, type FlowLibraryEntry, type GroupLibraryEntry, type SavedNodeEntry } from "./resource-contract";
import { repairWorkflowGroupInterfaces } from "./workflow-structure";
import { EDITOR_RESOURCE_SCHEMA_VERSION, migrateFlowEntry, migrateGroupEntry, migrateSavedNodeEntry } from "./resource-migrations";

export const RESOURCE_LIBRARY_STORAGE_KEYS = {
  flows: "pydroid-flow.workflow-library.v1",
  groups: "pydroid-flow.group-library.v1",
  savedNodes: "pydroid-flow.saved-node-library.v1",
} as const;

export type ResourceLibraryMirrorWriter = (path: string, content: string) => Promise<unknown> | unknown;

export type EditorResourceLibraryState = {
  flows: FlowLibraryEntry[];
  groups: GroupLibraryEntry[];
  savedNodes: SavedNodeEntry[];
  revision: number;
};

export type ExternalFlowResource = {
  uri: string;
  name: string;
  content: string;
};

function cloneFlow(entry: FlowLibraryEntry): FlowLibraryEntry {
  return { ...entry };
}

function cloneSavedNode(entry: SavedNodeEntry): SavedNodeEntry {
  return { ...entry, node: structuredClone(entry.node) };
}

function cloneGroup(entry: GroupLibraryEntry): GroupLibraryEntry {
  return {
    ...entry,
    nodes: structuredClone(entry.nodes),
    edges: structuredClone(entry.edges),
  };
}

function parseArray<T>(storage: StorageLike, key: string, predicate: (value: unknown) => value is T): T[] {
  try {
    const parsed: unknown = JSON.parse(readStorage(storage, key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(predicate) : [];
  } catch {
    return [];
  }
}

function isFlowEntry(value: unknown): value is FlowLibraryEntry {
  const entry = value as Partial<FlowLibraryEntry> | null;
  return Boolean(entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.name === "string" && typeof entry.document === "string");
}

function isGroupEntry(value: unknown): value is GroupLibraryEntry {
  const entry = value as Partial<GroupLibraryEntry> | null;
  return Boolean(entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.name === "string" && Array.isArray(entry.nodes) && Array.isArray(entry.edges));
}

function isSavedNodeEntry(value: unknown): value is SavedNodeEntry {
  const entry = value as Partial<SavedNodeEntry> | null;
  return Boolean(entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.name === "string" && entry.node && typeof entry.node === "object");
}

export class EditorResourceLibraryService {
  private readonly listeners = new Set<() => void>();
  private readonly protectedRaw = {
    flows: new Map<string, FlowLibraryEntry>(),
    groups: new Map<string, GroupLibraryEntry>(),
    savedNodes: new Map<string, SavedNodeEntry>(),
  };
  private state: EditorResourceLibraryState;
  private readonly storage: StorageLike;
  private readonly builtInGroups: GroupLibraryEntry[];
  private readonly mirror?: ResourceLibraryMirrorWriter;

  constructor(
    storage: StorageLike,
    builtInGroups: GroupLibraryEntry[] = [],
    mirror?: ResourceLibraryMirrorWriter,
  ) {
    this.storage = storage;
    this.builtInGroups = builtInGroups;
    this.mirror = mirror;
    this.state = this.loadState();
    // Resource upgrades are transactional at the local-storage boundary: the original
    // entry survives parsing/migration failures, while compatible legacy entries are
    // immediately rewritten in the current canonical format.
    this.persistFlows(this.state.flows);
    this.persistGroups(this.state.groups);
    this.persistSavedNodes(this.state.savedNodes);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): EditorResourceLibraryState => this.state;

  private emit(next: Omit<EditorResourceLibraryState, "revision">): EditorResourceLibraryState {
    this.state = { ...next, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
    return this.state;
  }

  private mirrorFile(path: string, content: string): void {
    if (!this.mirror) return;
    try {
      void Promise.resolve(this.mirror(path, content)).catch(() => undefined);
    } catch {
      // Profile mirroring is best-effort; local storage remains authoritative.
    }
  }

  private persistGroups(groups: GroupLibraryEntry[]): void {
    const custom = groups.filter((entry) => !entry.builtIn).map((entry) => {
      const protectedEntry = !isEditorResourceUsable(entry) ? this.protectedRaw.groups.get(entry.id) : undefined;
      return protectedEntry ? structuredClone(protectedEntry) : cloneGroup(entry);
    });
    writeStorage(this.storage, RESOURCE_LIBRARY_STORAGE_KEYS.groups, JSON.stringify(custom));
    this.mirrorFile("workflows/groups.json", JSON.stringify(custom, null, 2));
  }

  private persistSavedNodes(savedNodes: SavedNodeEntry[]): void {
    const cloned = savedNodes.map((entry) => {
      const protectedEntry = !isEditorResourceUsable(entry) ? this.protectedRaw.savedNodes.get(entry.id) : undefined;
      return protectedEntry ? structuredClone(protectedEntry) : cloneSavedNode(entry);
    });
    writeStorage(this.storage, RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes, JSON.stringify(cloned));
    this.mirrorFile("nodes/saved-nodes.json", JSON.stringify(cloned, null, 2));
  }

  private persistFlows(flows: FlowLibraryEntry[]): void {
    const cloned = flows.map((entry) => {
      const protectedEntry = !isEditorResourceUsable(entry) ? this.protectedRaw.flows.get(entry.id) : undefined;
      return protectedEntry ? structuredClone(protectedEntry) : cloneFlow(entry);
    });
    writeStorage(this.storage, RESOURCE_LIBRARY_STORAGE_KEYS.flows, JSON.stringify(cloned));
    this.mirrorFile("workflows/library.json", JSON.stringify(cloned, null, 2));
  }

  private loadState(): EditorResourceLibraryState {
    this.protectedRaw.flows.clear();
    this.protectedRaw.groups.clear();
    this.protectedRaw.savedNodes.clear();

    const compatibleGroup = (entry: GroupLibraryEntry, preserveRaw: boolean): GroupLibraryEntry => {
      const raw = structuredClone(entry);
      const migrated = migrateGroupEntry(cloneGroup(entry));
      if (!isEditorResourceUsable(migrated)) {
        if (preserveRaw) this.protectedRaw.groups.set(entry.id, raw);
        return migrated;
      }
      return { ...migrated, nodes: repairWorkflowGroupInterfaces(migrated.nodes, migrated.edges) };
    };
    const customGroups = parseArray(this.storage, RESOURCE_LIBRARY_STORAGE_KEYS.groups, isGroupEntry)
      .filter((entry) => !entry.builtIn)
      .map((entry) => compatibleGroup(entry, true));
    const groups = [
      ...this.builtInGroups.map((entry) => ({ ...compatibleGroup(entry, false), builtIn: true })),
      ...customGroups,
    ];
    const flows = parseArray(this.storage, RESOURCE_LIBRARY_STORAGE_KEYS.flows, isFlowEntry).map((entry) => {
      const raw = structuredClone(entry);
      const migrated = migrateFlowEntry(cloneFlow(entry));
      if (!isEditorResourceUsable(migrated)) this.protectedRaw.flows.set(entry.id, raw);
      return migrated;
    });
    const savedNodes = parseArray(this.storage, RESOURCE_LIBRARY_STORAGE_KEYS.savedNodes, isSavedNodeEntry).map((entry) => {
      const raw = structuredClone(entry);
      const migrated = migrateSavedNodeEntry(cloneSavedNode(entry));
      if (!isEditorResourceUsable(migrated)) this.protectedRaw.savedNodes.set(entry.id, raw);
      return migrated;
    });
    return { flows, groups, savedNodes, revision: 0 };
  }

  reload(): EditorResourceLibraryState {
    const loaded = this.loadState();
    this.persistFlows(loaded.flows);
    this.persistGroups(loaded.groups);
    this.persistSavedNodes(loaded.savedNodes);
    return this.emit({ flows: loaded.flows, groups: loaded.groups, savedNodes: loaded.savedNodes });
  }

  saveGroup(entry: GroupLibraryEntry): GroupLibraryEntry {
    const existing = this.state.groups.find((item) => item.id === entry.id);
    if (existing?.builtIn) throw new Error("内置组合不能被资源库覆盖");
    const migrated = migrateGroupEntry({ ...cloneGroup(entry), resourceSchemaVersion: EDITOR_RESOURCE_SCHEMA_VERSION, compatibility: "current" });
    if (migrated.compatibility === "future" || migrated.compatibility === "invalid") throw new Error("无法添加组合资源");
    const normalized = { ...migrated, builtIn: false, nodes: repairWorkflowGroupInterfaces(migrated.nodes, migrated.edges) };
    this.protectedRaw.groups.delete(normalized.id);
    const groups = [normalized, ...this.state.groups.filter((item) => item.id !== normalized.id)];
    this.persistGroups(groups);
    this.emit({ flows: this.state.flows, groups, savedNodes: this.state.savedNodes });
    return normalized;
  }

  renameGroup(id: string, name: string): boolean {
    const current = this.state.groups.find((entry) => entry.id === id);
    const normalizedName = name.trim();
    if (!current || !normalizedName || !describeGroup(current).capabilities.rename) return false;
    const groups = this.state.groups.map((entry) => entry.id === id ? {
      ...entry,
      name: normalizedName,
      nodes: entry.nodes.map((node) => node.data.nodeType === "workflow.group" ? { ...node, data: { ...node.data, label: normalizedName } } : node),
    } : entry);
    this.persistGroups(groups);
    this.emit({ flows: this.state.flows, groups, savedNodes: this.state.savedNodes });
    return true;
  }

  removeGroup(id: string): boolean {
    const current = this.state.groups.find((entry) => entry.id === id);
    if (!current || !describeGroup(current).capabilities.remove) return false;
    const groups = this.state.groups.filter((entry) => entry.id !== id);
    this.persistGroups(groups);
    this.emit({ flows: this.state.flows, groups, savedNodes: this.state.savedNodes });
    return true;
  }

  saveNode(entry: SavedNodeEntry): SavedNodeEntry {
    const normalized = migrateSavedNodeEntry({ ...cloneSavedNode(entry), resourceSchemaVersion: EDITOR_RESOURCE_SCHEMA_VERSION, compatibility: "current" });
    if (normalized.compatibility === "future" || normalized.compatibility === "invalid") throw new Error("无法添加节点资源");
    this.protectedRaw.savedNodes.delete(normalized.id);
    const savedNodes = [normalized, ...this.state.savedNodes.filter((item) => item.id !== normalized.id)];
    this.persistSavedNodes(savedNodes);
    this.emit({ flows: this.state.flows, groups: this.state.groups, savedNodes });
    return normalized;
  }

  renameNode(id: string, name: string): boolean {
    const current = this.state.savedNodes.find((entry) => entry.id === id);
    const normalizedName = name.trim();
    if (!current || !normalizedName || !describeSavedNode(current).capabilities.rename) return false;
    const savedNodes = this.state.savedNodes.map((entry) => entry.id === id ? { ...entry, name: normalizedName } : entry);
    this.persistSavedNodes(savedNodes);
    this.emit({ flows: this.state.flows, groups: this.state.groups, savedNodes });
    return true;
  }

  removeNode(id: string): boolean {
    const current = this.state.savedNodes.find((entry) => entry.id === id);
    if (!current || !describeSavedNode(current).capabilities.remove) return false;
    const savedNodes = this.state.savedNodes.filter((entry) => entry.id !== id);
    this.persistSavedNodes(savedNodes);
    this.emit({ flows: this.state.flows, groups: this.state.groups, savedNodes });
    return true;
  }

  reorderNodes(dragId: string, overId: string): boolean {
    const from = this.state.savedNodes.findIndex((item) => item.id === dragId);
    const to = this.state.savedNodes.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0 || from === to) return false;
    const savedNodes = [...this.state.savedNodes];
    const [moved] = savedNodes.splice(from, 1);
    savedNodes.splice(to, 0, moved);
    this.persistSavedNodes(savedNodes);
    this.emit({ flows: this.state.flows, groups: this.state.groups, savedNodes });
    return true;
  }

  addFlowDocument(name: string, document: string, options: { limit?: number; id?: string; savedAt?: string } = {}): FlowLibraryEntry {
    const entry = migrateFlowEntry({
      resourceSchemaVersion: EDITOR_RESOURCE_SCHEMA_VERSION,
      compatibility: "current",
      id: options.id ?? `flow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name || `流程 ${new Date().toLocaleString()}`,
      savedAt: options.savedAt ?? new Date().toISOString(),
      document,
    } satisfies FlowLibraryEntry);
    if (entry.compatibility === "future" || entry.compatibility === "invalid") throw new Error("流程库条目已损坏，无法打开");
    this.protectedRaw.flows.delete(entry.id);
    const flows = [entry, ...this.state.flows.filter((item) => item.id !== entry.id)].slice(0, options.limit ?? 40);
    this.persistFlows(flows);
    this.mirrorFile(`workflows/${entry.id}.workflow.json`, entry.document);
    this.emit({ flows, groups: this.state.groups, savedNodes: this.state.savedNodes });
    return entry;
  }

  replaceFlows(flows: FlowLibraryEntry[]): EditorResourceLibraryState {
    const nextFlows = flows.map((entry) => {
      const raw = structuredClone(entry);
      const migrated = migrateFlowEntry(cloneFlow(entry));
      if (isEditorResourceUsable(migrated)) this.protectedRaw.flows.delete(migrated.id);
      else if (!this.protectedRaw.flows.has(migrated.id)) this.protectedRaw.flows.set(migrated.id, raw);
      return migrated;
    });
    const retainedIds = new Set(nextFlows.map((entry) => entry.id));
    for (const id of this.protectedRaw.flows.keys()) if (!retainedIds.has(id)) this.protectedRaw.flows.delete(id);
    this.persistFlows(nextFlows);
    return this.emit({ flows: nextFlows, groups: this.state.groups, savedNodes: this.state.savedNodes });
  }

  mergeExternalFlows(entries: ExternalFlowResource[]): EditorResourceLibraryState {
    const external = entries.map((entry) => {
      const id = `external-${entry.uri}`;
      const previous = this.state.flows.find((item) => item.id === id);
      return { id, name: previous?.name ?? entry.name, savedAt: "", document: entry.content, uri: entry.uri, external: true, locked: previous?.locked } satisfies FlowLibraryEntry;
    });
    const externalIds = new Set(external.map((entry) => entry.id));
    return this.replaceFlows([...external, ...this.state.flows.filter((entry) => !entry.external && !externalIds.has(entry.id))]);
  }

  updateFlow(id: string, patch: Partial<Pick<FlowLibraryEntry, "id" | "name" | "uri" | "locked">>): FlowLibraryEntry | null {
    const current = this.state.flows.find((entry) => entry.id === id);
    if (!current || !isEditorResourceUsable(current)) return null;
    const next = { ...current, ...patch };
    const flows = this.state.flows.map((entry) => entry.id === id ? next : entry);
    this.persistFlows(flows);
    this.emit({ flows, groups: this.state.groups, savedNodes: this.state.savedNodes });
    return next;
  }

  renameFlow(id: string, name: string, uri?: string): FlowLibraryEntry | null {
    const current = this.state.flows.find((entry) => entry.id === id);
    const normalizedName = name.trim();
    if (!current || !normalizedName || !describeFlow(current).capabilities.rename) return null;
    const nextId = uri && current.external ? `external-${uri}` : current.id;
    return this.updateFlow(id, { id: nextId, name: normalizedName, ...(uri ? { uri } : {}) });
  }

  toggleFlowLock(id: string): FlowLibraryEntry | null {
    const current = this.state.flows.find((entry) => entry.id === id);
    if (!current || !describeFlow(current).capabilities.lock) return null;
    return this.updateFlow(id, { locked: !current.locked });
  }

  removeFlow(id: string): boolean {
    const current = this.state.flows.find((entry) => entry.id === id);
    if (!current || !describeFlow(current).capabilities.remove) return false;
    const flows = this.state.flows.filter((entry) => entry.id !== id);
    this.persistFlows(flows);
    this.emit({ flows, groups: this.state.groups, savedNodes: this.state.savedNodes });
    return true;
  }
}
