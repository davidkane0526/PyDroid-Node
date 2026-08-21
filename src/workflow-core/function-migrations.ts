import { WorkflowCompatibilityError } from "./migrations";

export type FunctionCallMigrationStep = {
  nodeId: string;
  functionId: string;
  fromVersion: number;
  toVersion: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function signaturePorts(raw: unknown, input: boolean): Array<{ id: string; label: string; valueType: string; required?: boolean }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const port = asRecord(value);
    if (!port || typeof port.id !== "string" || typeof port.valueType !== "string") return [];
    return [{ id: port.id, label: typeof port.label === "string" ? port.label : port.id, valueType: port.valueType, ...(input ? { required: true } : {}) }];
  });
}

function sameSignature(saved: unknown, current: Array<{ id: string; valueType: string }>): boolean {
  if (!Array.isArray(saved)) return false;
  const normalized = saved.flatMap((value) => {
    const port = asRecord(value);
    return port && typeof port.id === "string" && typeof port.valueType === "string" ? [{ id: port.id, valueType: port.valueType }] : [];
  });
  if (normalized.length !== current.length) return false;
  return normalized.every((port, index) => port.id === current[index].id && port.valueType === current[index].valueType);
}

export function reconcileWorkflowFunctionCalls(value: Record<string, unknown>): {
  document: Record<string, unknown>;
  steps: FunctionCallMigrationStep[];
} {
  const document = structuredClone(value);
  const definitions = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(document.functions) ? document.functions : []) {
    const definition = asRecord(raw);
    if (definition && typeof definition.id === "string") definitions.set(definition.id, definition);
  }
  const steps: FunctionCallMigrationStep[] = [];

  const reconcileNodes = (rawNodes: unknown): unknown => !Array.isArray(rawNodes) ? rawNodes : rawNodes.map((rawNode) => {
    const node = asRecord(rawNode);
    const data = asRecord(node?.data);
    const parameters = asRecord(data?.parameters);
    if (!node || !data || !["function.call", "function.map"].includes(String(data.nodeType)) || !parameters || typeof parameters.functionId !== "string") return rawNode;
    const definition = definitions.get(parameters.functionId);
    if (!definition) return rawNode; // validation owns missing-definition reporting.
    const definitionVersion = definition.version;
    const callVersion = parameters.functionVersion;
    if (typeof definitionVersion !== "number" || !Number.isInteger(definitionVersion) || definitionVersion < 1
      || typeof callVersion !== "number" || !Number.isInteger(callVersion) || callVersion < 1) return rawNode;
    if (callVersion > definitionVersion) {
      throw new WorkflowCompatibilityError(
        "future-function-version",
        `函数调用 ${String(node.id)} 使用 v${callVersion}，高于当前定义 v${definitionVersion}`,
        { nodeId: node.id, functionId: parameters.functionId, callVersion, definitionVersion },
      );
    }
    const definitionInputs = signaturePorts(definition.inputs, true);
    const mapInput = typeof parameters.mapInput === "string" ? parameters.mapInput : "";
    const inputs = data.nodeType === "function.map"
      ? definitionInputs.map((port) => port.id === mapInput ? { ...port, label: `${port.label} 列表`, valueType: "list" } : port)
      : definitionInputs;
    const outputs = data.nodeType === "function.map"
      ? (signaturePorts(data.functionOutputs, false).length ? signaturePorts(data.functionOutputs, false) : [{ id: "output", label: "结果", valueType: "any" }])
      : signaturePorts(definition.outputs, false);
    if (callVersion < definitionVersion && (!sameSignature(data.functionInputs, inputs) || !sameSignature(data.functionOutputs, outputs))) {
      throw new WorkflowCompatibilityError(
        "incompatible-function-signature",
        `函数调用 ${String(node.id)} 的 v${callVersion} 签名无法安全升级到 v${definitionVersion}`,
        { nodeId: node.id, functionId: parameters.functionId, callVersion, definitionVersion },
      );
    }
    if (callVersion < definitionVersion) steps.push({ nodeId: String(node.id), functionId: parameters.functionId, fromVersion: callVersion, toVersion: definitionVersion });
    return {
      ...node,
      data: {
        ...data,
        parameters: { ...parameters, functionVersion: definitionVersion },
        functionInputs: inputs,
        functionOutputs: outputs,
      },
    };
  });

  document.nodes = reconcileNodes(document.nodes);
  if (Array.isArray(document.functions)) {
    document.functions = document.functions.map((raw) => {
      const definition = asRecord(raw);
      return definition ? { ...definition, nodes: reconcileNodes(definition.nodes) } : raw;
    });
  }
  return { document, steps };
}
