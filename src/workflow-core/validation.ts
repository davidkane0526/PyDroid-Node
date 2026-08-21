import { getNodeContract } from "../nodeContract";
import { areValueTypesCompatible, getNodeSpec, type PortSpec, type ValueType } from "../nodeCatalog";
import type { WorkflowDocument } from "../workflow";

type RawPort = { id?: unknown; label?: unknown; valueType?: unknown; required?: unknown };
type RawInterfacePort = RawPort & { internalNodeId?: unknown; internalHandle?: unknown };
type RawWorkflowNode = {
  id: string;
  data: {
    nodeType: string;
    nodeVersion?: unknown;
    parameters?: Record<string, unknown>;
    groupInputs?: RawPort[];
    groupOutputs?: RawPort[];
    functionInputs?: RawPort[];
    functionOutputs?: RawPort[];
  };
};
type RawFunctionDefinition = {
  id: string;
  name: string;
  version: number;
  inputs: RawInterfacePort[];
  outputs: RawInterfacePort[];
  nodes: RawWorkflowNode[];
  edges: Array<Record<string, unknown>>;
};

type FunctionMap = Map<string, RawFunctionDefinition>;

function isValueType(value: unknown): value is ValueType {
  return ["table", "plot", "csv", "number", "text", "boolean", "list", "object", "any"].includes(String(value));
}

function normalizedPorts(rawPorts: RawPort[] | undefined): PortSpec[] {
  if (!Array.isArray(rawPorts)) return [];
  return rawPorts.flatMap((port) => typeof port?.id === "string" && isValueType(port.valueType)
    ? [{ id: port.id, label: typeof port.label === "string" ? port.label : port.id, valueType: port.valueType, ...(typeof port.required === "boolean" ? { required: port.required } : {}) } satisfies PortSpec]
    : []);
}

function functionSignaturePorts(definition: RawFunctionDefinition | undefined, direction: "input" | "output"): PortSpec[] {
  if (!definition) return [];
  const raw = direction === "input" ? definition.inputs : definition.outputs;
  return raw.flatMap((port) => typeof port?.id === "string" && isValueType(port.valueType)
    ? [{ id: port.id, label: typeof port.label === "string" ? port.label : port.id, valueType: port.valueType, ...(direction === "input" ? { required: true } : {}) } satisfies PortSpec]
    : []);
}

function dynamicPort(rawPorts: RawPort[] | undefined, direction: "input" | "output", handle: string | null | undefined): PortSpec | undefined {
  const valid = normalizedPorts(rawPorts);
  if (typeof handle === "string" && handle) return valid.find((port) => port.id === handle);
  const conventional = valid.find((port) => port.id === (direction === "input" ? "input" : "output"));
  return conventional ?? (valid.length === 1 ? valid[0] : undefined);
}

function functionDefinitionForCall(node: RawWorkflowNode, functions: FunctionMap): RawFunctionDefinition | undefined {
  const functionId = node.data.parameters?.functionId;
  return typeof functionId === "string" ? functions.get(functionId) : undefined;
}

function declaredPort(node: RawWorkflowNode, direction: "input" | "output", handle: string | null | undefined, functions: FunctionMap): PortSpec | undefined {
  if (node.data.nodeType === "workflow.group") return dynamicPort(direction === "input" ? node.data.groupInputs : node.data.groupOutputs, direction, handle);
  if (node.data.nodeType === "function.call" || node.data.nodeType === "function.map") {
    const definitionPorts = direction === "input" ? functionSignaturePorts(functionDefinitionForCall(node, functions), direction) : [];
    const savedPorts = normalizedPorts(direction === "input" ? node.data.functionInputs : node.data.functionOutputs);
    const ports = node.data.nodeType === "function.map"
      ? savedPorts
      : direction === "input" && definitionPorts.length ? definitionPorts : savedPorts;
    if (typeof handle === "string" && handle) return ports.find((port) => port.id === handle);
    const conventional = ports.find((port) => port.id === (direction === "input" ? "input" : "output"));
    return conventional ?? (ports.length === 1 ? ports[0] : undefined);
  }
  // custom.python_function ports are generated from the function signature at runtime.
  if (node.data.nodeType === "custom.python_function") return undefined;
  const spec = getNodeSpec(node.data.nodeType);
  if (!spec) return undefined;
  const ports = direction === "input" ? spec.inputPorts : spec.outputPorts;
  if (typeof handle === "string" && handle) return ports.find((port) => port.id === handle);
  const conventional = ports.find((port) => port.id === (direction === "input" ? "input" : "output"));
  return conventional ?? (ports.length === 1 ? ports[0] : undefined);
}

function validateCallReference(node: RawWorkflowNode, functions: FunctionMap): void {
  if (node.data.nodeType !== "function.call" && node.data.nodeType !== "function.map") return;
  const functionId = node.data.parameters?.functionId;
  const functionVersion = node.data.parameters?.functionVersion;
  if (typeof functionId !== "string" || !functionId.trim()) throw new Error(`函数调用 ${node.id} 缺少 functionId`);
  const definition = functions.get(functionId);
  if (!definition) throw new Error(`函数调用 ${node.id} 引用了不存在的函数：${functionId}`);
  if (typeof functionVersion !== "number" || !Number.isInteger(functionVersion) || functionVersion < 1) throw new Error(`函数调用 ${node.id} 的版本无效`);
  if (functionVersion !== definition.version) {
    throw new Error(`函数调用 ${node.id} 使用 v${functionVersion}，但当前定义为 v${definition.version}；请更新调用节点`);
  }
  if (node.data.nodeType === "function.map") {
    const mapInput = node.data.parameters?.mapInput;
    if (typeof mapInput !== "string" || !functionSignaturePorts(definition, "input").some((port) => port.id === mapInput)) {
      throw new Error(`函数映射 ${node.id} 的 mapInput 无效`);
    }
    const collectMode = node.data.parameters?.collectMode;
    if (!new Set(["list", "table", "concat_columns"]).has(String(collectMode))) {
      throw new Error(`函数映射 ${node.id} 的 collectMode 无效`);
    }
    if (collectMode === "concat_columns") {
      const accumulator = node.data.parameters?.concatInitialVariable;
      if (typeof accumulator !== "string" || !accumulator.trim()) {
        throw new Error(`函数映射 ${node.id} 的 concat_columns 缺少 concatInitialVariable`);
      }
    }
  }
}

function validateGraph(rawNodes: unknown[], rawEdges: unknown[], functions: FunctionMap, label: string): Map<string, RawWorkflowNode> {
  const ids = new Set<string>();
  const nodesById = new Map<string, RawWorkflowNode>();
  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") throw new Error(`${label}包含无效节点`);
    const node = raw as { id?: unknown; data?: RawWorkflowNode["data"] };
    if (typeof node.id !== "string" || !node.data || typeof node.data.nodeType !== "string") throw new Error(`${label}包含无效节点`);
    const contract = getNodeContract(node.data.nodeType);
    if (!contract || node.data.nodeType === "function.definition") throw new Error(`未知节点类型：${node.data.nodeType}`);
    const nodeVersion = node.data.nodeVersion === undefined ? 1 : node.data.nodeVersion;
    if (typeof nodeVersion !== "number" || !Number.isInteger(nodeVersion) || nodeVersion < 1) throw new Error(`节点版本无效：${node.id}`);
    if (nodeVersion > contract.version) throw new Error(`节点 ${node.id} 的版本 ${nodeVersion} 高于当前支持版本 ${contract.version}`);
    if (ids.has(node.id)) throw new Error(`节点ID重复：${node.id}`);
    ids.add(node.id);
    const typed = node as RawWorkflowNode;
    validateCallReference(typed, functions);
    nodesById.set(node.id, typed);
  }

  for (const raw of rawEdges) {
    if (!raw || typeof raw !== "object") throw new Error(`${label}包含无效连线`);
    const edge = raw as { source?: unknown; target?: unknown; sourceHandle?: unknown; targetHandle?: unknown };
    if (typeof edge.source !== "string" || typeof edge.target !== "string" || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error(`${label}连线引用了不存在的节点`);
    }
    const source = nodesById.get(edge.source)!;
    const target = nodesById.get(edge.target)!;
    const sourceHandle = typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined;
    const targetHandle = typeof edge.targetHandle === "string" ? edge.targetHandle : undefined;
    const sourcePort = declaredPort(source, "output", sourceHandle, functions);
    const targetPort = declaredPort(target, "input", targetHandle, functions);
    const sourceDynamic = ["custom.python_function"].includes(source.data.nodeType);
    const targetDynamic = ["custom.python_function"].includes(target.data.nodeType);

    if (sourceHandle && !sourceDynamic && !sourcePort) throw new Error(`节点 ${edge.source} 不存在输出端口：${sourceHandle}`);
    if (targetHandle && !targetDynamic && !targetPort) throw new Error(`节点 ${edge.target} 不存在输入端口：${targetHandle}`);
    if (sourcePort && targetPort && !areValueTypesCompatible(sourcePort.valueType, targetPort.valueType)) {
      throw new Error(`连线类型不兼容：${edge.source}.${sourcePort.id} (${sourcePort.valueType}) → ${edge.target}.${targetPort.id} (${targetPort.valueType})`);
    }
  }
  return nodesById;
}

function parseFunctions(raw: unknown): FunctionMap {
  if (raw === undefined) return new Map();
  if (!Array.isArray(raw)) throw new Error("工作流 functions 必须是数组");
  const functions = new Map<string, RawFunctionDefinition>();
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new Error("工作流包含无效函数定义");
    const value = item as Partial<RawFunctionDefinition>;
    if (typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim()) throw new Error("函数定义缺少 id 或 name");
    const version = value.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error(`函数 ${value.name} 的版本无效`);
    if (functions.has(value.id)) throw new Error(`函数ID重复：${value.id}`);
    if (!Array.isArray(value.inputs) || !Array.isArray(value.outputs) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
      throw new Error(`函数 ${value.name} 缺少 inputs、outputs、nodes 或 edges`);
    }
    const portIds = new Set<string>();
    for (const [direction, ports] of [["输入", value.inputs], ["输出", value.outputs]] as const) {
      for (const port of ports) {
        if (!port || typeof port.id !== "string" || !port.id.trim() || !isValueType(port.valueType) || typeof port.internalNodeId !== "string" || !port.internalNodeId) {
          throw new Error(`函数 ${value.name} 的${direction}签名无效`);
        }
        const key = `${direction}:${port.id}`;
        if (portIds.has(key)) throw new Error(`函数 ${value.name} 的${direction}端口重复：${port.id}`);
        portIds.add(key);
      }
    }
    functions.set(value.id, value as RawFunctionDefinition);
  }
  return functions;
}

function validateFunctionDefinitions(functions: FunctionMap): void {
  for (const definition of functions.values()) {
    const nodesById = validateGraph(definition.nodes, definition.edges, functions, `函数 ${definition.name} `);
    for (const [direction, ports] of [["输入", definition.inputs], ["输出", definition.outputs]] as const) {
      for (const port of ports) {
        const node = nodesById.get(String(port.internalNodeId));
        if (!node) throw new Error(`函数 ${definition.name} 的${direction}端口 ${String(port.id)} 指向不存在的内部节点`);
        const declared = declaredPort(node, direction === "输入" ? "input" : "output", typeof port.internalHandle === "string" ? port.internalHandle : undefined, functions);
        if (!declared && node.data.nodeType !== "custom.python_function") {
          throw new Error(`函数 ${definition.name} 的${direction}端口 ${String(port.id)} 指向无效内部端口`);
        }
        if (declared && isValueType(port.valueType) && !areValueTypesCompatible(port.valueType, declared.valueType)) {
          throw new Error(`函数 ${definition.name} 的${direction}端口 ${String(port.id)} 类型与内部端口不兼容`);
        }
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (functionId: string) => {
    if (visiting.has(functionId)) throw new Error(`函数调用存在递归环：${functionId}`);
    if (visited.has(functionId)) return;
    visiting.add(functionId);
    const definition = functions.get(functionId);
    for (const node of definition?.nodes ?? []) {
      if (node.data.nodeType !== "function.call" && node.data.nodeType !== "function.map") continue;
      const target = node.data.parameters?.functionId;
      if (typeof target === "string") visit(target);
    }
    visiting.delete(functionId);
    visited.add(functionId);
  };
  for (const functionId of functions.keys()) visit(functionId);
}

export function validateWorkflowDocument(document: Record<string, unknown>): asserts document is WorkflowDocument {
  if (typeof document.name !== "string" || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new Error("工作流缺少name、nodes或edges");
  }
  if (document.requirements !== undefined && (!Array.isArray(document.requirements) || document.requirements.some((item) => typeof item !== "string"))) {
    throw new Error("工作流 requirements 必须是字符串数组");
  }
  const functions = parseFunctions(document.functions);
  validateFunctionDefinitions(functions);
  validateGraph(document.nodes, document.edges, functions, "工作流");
}
