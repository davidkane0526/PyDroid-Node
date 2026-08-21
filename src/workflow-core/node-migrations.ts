import { WorkflowCompatibilityError } from "./migrations";

export type RawWorkflowNodeRecord = Record<string, unknown> & {
  id?: unknown;
  data?: Record<string, unknown>;
};

export type NodeMigrationResult = {
  node: RawWorkflowNodeRecord;
  inputHandleRenames?: Record<string, string>;
  outputHandleRenames?: Record<string, string>;
};

export type NodeMigration = (node: RawWorkflowNodeRecord) => NodeMigrationResult | RawWorkflowNodeRecord;
export type NodeContractVersionResolver = (nodeType: string) => number | undefined;
export type NodeDefaultResolver = (nodeType: string) => Record<string, string | number | boolean | null> | undefined;
export type NodeMigrationStep = { nodeId: string; nodeType: string; toNodeType: string; fromVersion: number; toVersion: number };
export type WorkflowNodeMigrationReport = { steps: NodeMigrationStep[] };

const migrations = new Map<string, Map<number, NodeMigration>>();

export type DeclarativeNodeMigration = {
  renameParameters?: Record<string, string>;
  removeParameters?: string[];
  defaults?: Record<string, string | number | boolean | null>;
  replaceNodeType?: string;
  targetVersion?: number;
  inputHandleRenames?: Record<string, string>;
  outputHandleRenames?: Record<string, string>;
};

export function createNodeMigration(recipe: DeclarativeNodeMigration): NodeMigration {
  return (node) => {
    const data = asRecord(node.data) ?? {};
    const currentVersion = Number(data.nodeVersion ?? 1);
    const parameters = { ...(asRecord(data.parameters) ?? {}) };
    for (const [from, to] of Object.entries(recipe.renameParameters ?? {})) {
      if (Object.prototype.hasOwnProperty.call(parameters, from) && !Object.prototype.hasOwnProperty.call(parameters, to)) parameters[to] = parameters[from];
      delete parameters[from];
    }
    for (const key of recipe.removeParameters ?? []) delete parameters[key];
    for (const [key, value] of Object.entries(recipe.defaults ?? {})) if (!Object.prototype.hasOwnProperty.call(parameters, key)) parameters[key] = value;
    return {
      node: {
        ...node,
        data: {
          ...data,
          nodeType: recipe.replaceNodeType ?? data.nodeType,
          nodeVersion: recipe.targetVersion ?? currentVersion + 1,
          parameters,
        },
      },
      inputHandleRenames: recipe.inputHandleRenames,
      outputHandleRenames: recipe.outputHandleRenames,
    };
  };
}


export function registerNodeMigration(nodeType: string, fromVersion: number, migration: NodeMigration): void {
  if (!nodeType.trim()) throw new Error("Node migration type must be non-empty");
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error("Node migration version must be a positive integer");
  const byVersion = migrations.get(nodeType) ?? new Map<number, NodeMigration>();
  if (byVersion.has(fromVersion)) throw new Error(`Node migration ${nodeType} v${fromVersion} is already registered`);
  byVersion.set(fromVersion, migration);
  migrations.set(nodeType, byVersion);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nodeIdentity(node: RawWorkflowNodeRecord): { id: string; type: string; version: number } {
  const data = asRecord(node.data);
  const id = typeof node.id === "string" ? node.id : "<unknown>";
  const type = typeof data?.nodeType === "string" ? data.nodeType : "";
  const rawVersion = data?.nodeVersion ?? 1;
  if (!type) throw new WorkflowCompatibilityError("invalid-node-migration", `节点 ${id} 缺少 nodeType`, { nodeId: id });
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1) {
    throw new WorkflowCompatibilityError("invalid-node-migration", `节点版本无效：${id}`, { nodeId: id, nodeType: type, nodeVersion: data?.nodeVersion });
  }
  return { id, type, version: rawVersion };
}

function mergeRename(target: Map<string, Map<string, string>>, nodeId: string, values: Record<string, string> | undefined): void {
  if (!values) return;
  const map = target.get(nodeId) ?? new Map<string, string>();
  for (const [from, to] of Object.entries(values)) {
    if (!from || !to || from === to) continue;
    for (const [existingFrom, existingTo] of map.entries()) if (existingTo === from) map.set(existingFrom, to);
    map.set(from, to);
  }
  target.set(nodeId, map);
}

function renameHandle(value: unknown, map: Map<string, string> | undefined): unknown {
  if (typeof value !== "string" || !map) return value;
  return map.get(value) ?? value;
}

function canonicalizeNode(node: RawWorkflowNodeRecord, defaults: NodeDefaultResolver): RawWorkflowNodeRecord {
  const data = asRecord(node.data) ?? {};
  const type = typeof data.nodeType === "string" ? data.nodeType : "";
  const currentParameters = asRecord(data.parameters) ?? {};
  const resolvedDefaults = defaults(type) ?? {};
  return {
    ...node,
    data: {
      ...data,
      nodeVersion: Number(data.nodeVersion ?? 1),
      parameters: { ...resolvedDefaults, ...currentParameters },
    },
  };
}

function migrateGraph(
  rawNodes: unknown,
  rawEdges: unknown,
  resolveVersion: NodeContractVersionResolver,
  defaults: NodeDefaultResolver,
  report: WorkflowNodeMigrationReport,
): { nodes: unknown; edges: unknown; inputRenames: Map<string, Map<string, string>>; outputRenames: Map<string, Map<string, string>> } {
  if (!Array.isArray(rawNodes)) return { nodes: rawNodes, edges: rawEdges, inputRenames: new Map(), outputRenames: new Map() };
  const inputRenames = new Map<string, Map<string, string>>();
  const outputRenames = new Map<string, Map<string, string>>();

  const nodes = rawNodes.map((value) => {
    const initial = asRecord(value);
    if (!initial) return value;
    let node = structuredClone(initial) as RawWorkflowNodeRecord;
    let guard = 0;
    while (guard++ < 100) {
      const identity = nodeIdentity(node);
      const supported = resolveVersion(identity.type);
      if (supported === undefined) break; // validation owns unknown-node errors.
      if (identity.version > supported) {
        throw new WorkflowCompatibilityError(
          "future-node-version",
          `节点 ${identity.id} 的版本 ${identity.version} 高于当前支持版本 ${supported}`,
          { nodeId: identity.id, nodeType: identity.type, nodeVersion: identity.version, supportedVersion: supported },
        );
      }
      if (identity.version === supported) break;
      const migration = migrations.get(identity.type)?.get(identity.version);
      if (!migration) {
        throw new WorkflowCompatibilityError(
          "missing-node-migration",
          `节点 ${identity.id} 缺少 ${identity.type} v${identity.version} → v${identity.version + 1} 的迁移器`,
          { nodeId: identity.id, nodeType: identity.type, fromVersion: identity.version, toVersion: identity.version + 1 },
        );
      }
      const rawResult = migration(structuredClone(node));
      const result: NodeMigrationResult = "node" in rawResult ? rawResult as NodeMigrationResult : { node: rawResult as RawWorkflowNodeRecord };
      const next = result.node;
      const nextIdentity = nodeIdentity(next);
      if (nextIdentity.id !== identity.id) {
        throw new WorkflowCompatibilityError(
          "invalid-node-migration",
          `节点迁移器不得修改节点 id：${identity.id} → ${nextIdentity.id}`,
          { nodeId: identity.id, migratedNodeId: nextIdentity.id, nodeType: identity.type },
        );
      }
      const replacedType = nextIdentity.type !== identity.type;
      if (!replacedType && nextIdentity.version !== identity.version + 1) {
        throw new WorkflowCompatibilityError(
          "invalid-node-migration",
          `节点迁移器 ${identity.type} v${identity.version} 未生成 v${identity.version + 1}`,
          { nodeId: identity.id, nodeType: identity.type, fromVersion: identity.version, actualVersion: nextIdentity.version },
        );
      }
      if (replacedType) {
        const replacementSupported = resolveVersion(nextIdentity.type);
        if (replacementSupported === undefined) {
          throw new WorkflowCompatibilityError("invalid-node-migration", `节点 ${identity.id} 被迁移到未知类型：${nextIdentity.type}`, { nodeId: identity.id, fromNodeType: identity.type, toNodeType: nextIdentity.type });
        }
        if (nextIdentity.version > replacementSupported) {
          throw new WorkflowCompatibilityError("invalid-node-migration", `节点 ${identity.id} 的替换类型版本无效`, { nodeId: identity.id, toNodeType: nextIdentity.type, nodeVersion: nextIdentity.version, supportedVersion: replacementSupported });
        }
      }
      mergeRename(inputRenames, identity.id, result.inputHandleRenames);
      mergeRename(outputRenames, identity.id, result.outputHandleRenames);
      report.steps.push({ nodeId: identity.id, nodeType: identity.type, toNodeType: nextIdentity.type, fromVersion: identity.version, toVersion: nextIdentity.version });
      node = structuredClone(next);
    }
    if (guard >= 100) throw new WorkflowCompatibilityError("invalid-node-migration", "节点迁移超过安全步数", { nodeId: node.id });
    return canonicalizeNode(node, defaults);
  });

  const edges = Array.isArray(rawEdges) ? rawEdges.map((value) => {
    const edge = asRecord(value);
    if (!edge) return value;
    const sourceId = typeof edge.source === "string" ? edge.source : "";
    const targetId = typeof edge.target === "string" ? edge.target : "";
    return {
      ...edge,
      ...(edge.sourceHandle === undefined ? {} : { sourceHandle: renameHandle(edge.sourceHandle, outputRenames.get(sourceId)) }),
      ...(edge.targetHandle === undefined ? {} : { targetHandle: renameHandle(edge.targetHandle, inputRenames.get(targetId)) }),
    };
  }) : rawEdges;

  const withGroupInterfaces = nodes.map((value) => {
    const node = asRecord(value);
    const data = asRecord(node?.data);
    if (!node || !data || data.nodeType !== "workflow.group") return value;
    const remapPorts = (raw: unknown, direction: "input" | "output") => !Array.isArray(raw) ? raw : raw.map((portValue) => {
      const port = asRecord(portValue);
      if (!port || typeof port.internalNodeId !== "string") return portValue;
      const rename = direction === "input" ? inputRenames.get(port.internalNodeId) : outputRenames.get(port.internalNodeId);
      return { ...port, internalHandle: renameHandle(port.internalHandle, rename) };
    });
    return { ...node, data: { ...data, groupInputs: remapPorts(data.groupInputs, "input"), groupOutputs: remapPorts(data.groupOutputs, "output") } };
  });

  return { nodes: withGroupInterfaces, edges, inputRenames, outputRenames };
}

export function migrateWorkflowNodeContracts(
  value: Record<string, unknown>,
  resolveVersion: NodeContractVersionResolver,
  defaults: NodeDefaultResolver = () => undefined,
): { document: Record<string, unknown>; report: WorkflowNodeMigrationReport } {
  const document = structuredClone(value);
  const report: WorkflowNodeMigrationReport = { steps: [] };

  if (Array.isArray(document.functions)) {
    document.functions = document.functions.map((rawDefinition) => {
      const definition = asRecord(rawDefinition);
      if (!definition) return rawDefinition;
      const graph = migrateGraph(definition.nodes, definition.edges, resolveVersion, defaults, report);
      const remapBoundary = (raw: unknown, direction: "input" | "output") => !Array.isArray(raw) ? raw : raw.map((portValue) => {
        const port = asRecord(portValue);
        if (!port || typeof port.internalNodeId !== "string") return portValue;
        const renames = direction === "input" ? graph.inputRenames.get(port.internalNodeId) : graph.outputRenames.get(port.internalNodeId);
        return { ...port, internalHandle: renameHandle(port.internalHandle, renames) };
      });
      return {
        ...definition,
        nodes: graph.nodes,
        edges: graph.edges,
        inputs: remapBoundary(definition.inputs, "input"),
        outputs: remapBoundary(definition.outputs, "output"),
      };
    });
  }

  const root = migrateGraph(document.nodes, document.edges, resolveVersion, defaults, report);
  document.nodes = root.nodes;
  document.edges = root.edges;
  return { document, report };
}
