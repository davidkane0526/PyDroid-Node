import { getNodeContract } from "../nodeContract";
import { areValueTypesCompatible, getNodeSpec, type PortSpec, type ValueType } from "../nodeCatalog";
import type { WorkflowDocument } from "../workflow";

type RawGroupPort = { id?: unknown; valueType?: unknown };
type RawWorkflowNode = {
  id: string;
  data: {
    nodeType: string;
    nodeVersion?: unknown;
    groupInputs?: RawGroupPort[];
    groupOutputs?: RawGroupPort[];
  };
};

function isValueType(value: unknown): value is ValueType {
  return ["table", "plot", "csv", "number", "text", "boolean", "list", "object", "any"].includes(String(value));
}

function dynamicGroupPort(node: RawWorkflowNode, direction: "input" | "output", handle: string | null | undefined): PortSpec | undefined {
  const rawPorts = direction === "input" ? node.data.groupInputs : node.data.groupOutputs;
  if (!Array.isArray(rawPorts)) return undefined;
  const valid = rawPorts.flatMap((port) => typeof port?.id === "string" && isValueType(port.valueType)
    ? [{ id: port.id, label: port.id, valueType: port.valueType } satisfies PortSpec]
    : []);
  if (typeof handle === "string" && handle) return valid.find((port) => port.id === handle);
  return valid.length === 1 ? valid[0] : undefined;
}

function declaredPort(node: RawWorkflowNode, direction: "input" | "output", handle: string | null | undefined): PortSpec | undefined {
  if (node.data.nodeType === "workflow.group") return dynamicGroupPort(node, direction, handle);
  // custom.python_function ports are generated from the function signature at runtime.
  // The static catalog entry is only a default editing shape, so import validation must
  // not reject a valid signature-derived handle.
  if (node.data.nodeType === "custom.python_function") return undefined;
  const spec = getNodeSpec(node.data.nodeType);
  if (!spec) return undefined;
  const ports = direction === "input" ? spec.inputPorts : spec.outputPorts;
  if (typeof handle === "string" && handle) return ports.find((port) => port.id === handle);
  const conventional = ports.find((port) => port.id === (direction === "input" ? "input" : "output"));
  return conventional ?? (ports.length === 1 ? ports[0] : undefined);
}

export function validateWorkflowDocument(document: Record<string, unknown>): asserts document is WorkflowDocument {
  if (typeof document.name !== "string" || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) {
    throw new Error("工作流缺少name、nodes或edges");
  }
  if (document.requirements !== undefined && (!Array.isArray(document.requirements) || document.requirements.some((item) => typeof item !== "string"))) {
    throw new Error("工作流 requirements 必须是字符串数组");
  }
  const ids = new Set<string>();
  const nodesById = new Map<string, RawWorkflowNode>();
  for (const raw of document.nodes) {
    if (!raw || typeof raw !== "object") throw new Error("工作流包含无效节点");
    const node = raw as { id?: unknown; data?: { nodeType?: unknown; nodeVersion?: unknown; groupInputs?: RawGroupPort[]; groupOutputs?: RawGroupPort[] } };
    if (typeof node.id !== "string" || !node.data || typeof node.data.nodeType !== "string") throw new Error("工作流包含无效节点");
    const contract = getNodeContract(node.data.nodeType);
    if (!contract) throw new Error(`未知节点类型：${node.data.nodeType}`);
    const nodeVersion = node.data.nodeVersion === undefined ? 1 : Number(node.data.nodeVersion);
    if (!Number.isInteger(nodeVersion) || nodeVersion < 1) throw new Error(`节点版本无效：${node.id}`);
    if (nodeVersion > contract.version) throw new Error(`节点 ${node.id} 的版本 ${nodeVersion} 高于当前支持版本 ${contract.version}`);
    if (ids.has(node.id)) throw new Error(`节点ID重复：${node.id}`);
    ids.add(node.id);
    nodesById.set(node.id, node as RawWorkflowNode);
  }
  for (const raw of document.edges) {
    if (!raw || typeof raw !== "object") throw new Error("工作流包含无效连线");
    const edge = raw as { source?: unknown; target?: unknown; sourceHandle?: unknown; targetHandle?: unknown };
    if (typeof edge.source !== "string" || typeof edge.target !== "string" || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error("工作流连线引用了不存在的节点");
    }
    const source = nodesById.get(edge.source)!;
    const target = nodesById.get(edge.target)!;
    const sourceHandle = typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined;
    const targetHandle = typeof edge.targetHandle === "string" ? edge.targetHandle : undefined;
    const sourcePort = declaredPort(source, "output", sourceHandle);
    const targetPort = declaredPort(target, "input", targetHandle);

    if (sourceHandle && source.data.nodeType !== "custom.python_function" && !sourcePort) {
      throw new Error(`节点 ${edge.source} 不存在输出端口：${sourceHandle}`);
    }
    if (targetHandle && target.data.nodeType !== "custom.python_function" && !targetPort) {
      throw new Error(`节点 ${edge.target} 不存在输入端口：${targetHandle}`);
    }
    if (sourcePort && targetPort && !areValueTypesCompatible(sourcePort.valueType, targetPort.valueType)) {
      throw new Error(`连线类型不兼容：${edge.source}.${sourcePort.id} (${sourcePort.valueType}) → ${edge.target}.${targetPort.id} (${targetPort.valueType})`);
    }
  }
}
