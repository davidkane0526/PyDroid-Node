import { resolveNodeSpec } from "./nodeSpec";
import { getNodeSpec, isExternalNodeType, registerCatalogNodeSpec, unregisterCatalogNodeSpec } from "./nodeCatalog";
import { hasJavascriptNodeProvider, registerJavascriptNodeProvider, unregisterJavascriptNodeProvider, type JavascriptNodeProvider } from "./runtime/javascript/engine/providers";
import { hasPythonNodeProvider, registerPythonNodeProvider, unregisterPythonNodeProvider, type PythonNodeProviderDescriptor } from "./runtime/pythonProviders";

import type {
  InputPortGroupSpec,
  NodeConditionValue,
  NodeSpec,
  NodeUiHelpSpec,
  NodeUiParameterGroupSpec,
  NodeUiSpec,
  NodeUiStatusItemSpec,
  NodeVariant,
  ParameterSpec,
  PortSpec,
  SocketGroupSpec,
  ValueType,
} from "./nodeCatalog";

export const NODE_SPEC_SDK_VERSION = 4 as const;

export type {
  InputPortGroupSpec,
  NodeConditionValue,
  NodeSpec,
  NodeUiHelpSpec,
  NodeUiParameterGroupSpec,
  NodeUiSpec,
  NodeUiStatusItemSpec,
  NodeVariant,
  ParameterSpec,
  PortSpec,
  SocketGroupSpec,
  ValueType,
};

export type { JavascriptNodeProvider, PythonNodeProviderDescriptor };

export { resolveNodeSpec };

/**
 * Validate the declaration-only part of a NodeSpec.
 *
 * Validation is declaration-only. Registration is an explicit SDK action and
 * runtime execution remains a separate host/plugin responsibility.
 */
export function validateNodeSpecDefinition(spec: NodeSpec): string[] {
  const errors: string[] = [];
  const prefix = spec.nodeType || "<unnamed>";
  if (!spec.nodeType.trim()) errors.push("nodeType 不能为空");
  if (!spec.label.trim()) errors.push(`${prefix}: label 不能为空`);
  if (!spec.runtimeSupport?.length) errors.push(`${prefix}: runtimeSupport 至少声明一个 Runtime`);

  const parameterKeys = new Set<string>();
  for (const parameter of spec.parameters) {
    if (!parameter.key.trim()) errors.push(`${prefix}: 参数 key 不能为空`);
    if (parameterKeys.has(parameter.key)) errors.push(`${prefix}: 参数 key 重复：${parameter.key}`);
    parameterKeys.add(parameter.key);
  }
  const conditionKeys = new Set([...parameterKeys, ...Object.keys(spec.defaults)]);

  const socketGroupIds = new Set<string>();
  for (const group of spec.socketGroups ?? []) {
    if (!group.id.trim()) errors.push(`${prefix}: Socket Group id 不能为空`);
    if (socketGroupIds.has(group.id)) errors.push(`${prefix}: Socket Group id 重复：${group.id}`);
    socketGroupIds.add(group.id);
    if (!group.label.trim()) errors.push(`${prefix}: Socket Group label 不能为空：${group.id}`);
  }
  for (const group of spec.socketGroups ?? []) {
    if (group.parentId && !socketGroupIds.has(group.parentId)) errors.push(`${prefix}: Socket Group parent 不存在：${group.id} -> ${group.parentId}`);
    if (group.parentId === group.id) errors.push(`${prefix}: Socket Group 不能引用自身：${group.id}`);
    const visited = new Set<string>([group.id]);
    let parent = group.parentId;
    while (parent) {
      if (visited.has(parent)) { errors.push(`${prefix}: Socket Group parent 存在循环：${group.id}`); break; }
      visited.add(parent);
      parent = spec.socketGroups?.find((item) => item.id === parent)?.parentId;
    }
  }

  const validatePort = (port: PortSpec, owner: string) => {
    if (!port.id.trim()) errors.push(`${prefix}: ${owner} Socket id 不能为空`);
    if (port.socketGroup && !socketGroupIds.has(port.socketGroup)) errors.push(`${prefix}: ${owner}.${port.id} 引用了不存在的 Socket Group：${port.socketGroup}`);
    if (!port.defaultParameter) return;
    if (!parameterKeys.has(port.defaultParameter)) errors.push(`${prefix}: ${owner}.${port.id} 默认参数不存在：${port.defaultParameter}`);
    if (port.id !== port.defaultParameter) errors.push(`${prefix}: 参数 Socket id 必须与参数 key 一致：${port.id} -> ${port.defaultParameter}`);
  };
  for (const port of spec.inputPorts) validatePort(port, "input");
  for (const port of spec.outputPorts) validatePort(port, "output");

  for (const [index, variant] of (spec.variants ?? []).entries()) {
    for (const key of Object.keys(variant.when)) if (!conditionKeys.has(key)) errors.push(`${prefix}: variants[${index}] 条件参数不存在：${key}`);
    for (const key of variant.hiddenParameters ?? []) if (!parameterKeys.has(key)) errors.push(`${prefix}: variants[${index}] 隐藏参数不存在：${key}`);
    for (const key of Object.keys(variant.parameterPatches ?? {})) if (!parameterKeys.has(key)) errors.push(`${prefix}: variants[${index}] 参数补丁目标不存在：${key}`);
    for (const port of variant.inputPorts ?? []) validatePort(port, `variants[${index}].input`);
    for (const port of variant.outputPorts ?? []) validatePort(port, `variants[${index}].output`);
  }

  const uiGroupIds = new Set<string>();
  const uiGroupedParameterKeys = new Set<string>();
  const inlineParameterKeys = new Set(spec.ui?.inlineParameters ?? []);
  for (const group of spec.ui?.parameterGroups ?? []) {
    if (!group.id.trim()) errors.push(`${prefix}: UI 参数分组 id 不能为空`);
    if (uiGroupIds.has(group.id)) errors.push(`${prefix}: UI 参数分组 id 重复：${group.id}`);
    uiGroupIds.add(group.id);
    if (!group.label.trim()) errors.push(`${prefix}: UI 参数分组 label 不能为空：${group.id}`);
    for (const key of group.parameters) {
      if (!parameterKeys.has(key)) errors.push(`${prefix}: UI 参数分组引用不存在的参数：${group.id}.${key}`);
      if (uiGroupedParameterKeys.has(key)) errors.push(`${prefix}: UI 参数不能重复出现在多个分组：${key}`);
      if (inlineParameterKeys.has(key)) errors.push(`${prefix}: UI 参数不能同时声明为 inline 和分组参数：${key}`);
      uiGroupedParameterKeys.add(key);
    }
  }
  for (const item of spec.ui?.status ?? []) {
    if (!item.label.trim()) errors.push(`${prefix}: UI 状态项 label 不能为空`);
    if (!parameterKeys.has(item.parameter)) errors.push(`${prefix}: UI 状态项引用不存在的参数：${item.parameter}`);
  }

  const inputGroupIds = new Set<string>();
  for (const group of spec.inputPortGroups ?? []) {
    if (!group.id.trim()) errors.push(`${prefix}: Input Port Group id 不能为空`);
    if (inputGroupIds.has(group.id)) errors.push(`${prefix}: Input Port Group id 重复：${group.id}`);
    inputGroupIds.add(group.id);
    if (!(group.ports?.length) && !group.repeat) errors.push(`${prefix}: Input Port Group 必须声明 ports 或 repeat：${group.id}`);
    for (const key of Object.keys(group.when ?? {})) if (!conditionKeys.has(key)) errors.push(`${prefix}: Input Port Group 条件参数不存在：${group.id}.${key}`);
    if (group.socketGroup && !socketGroupIds.has(group.socketGroup)) errors.push(`${prefix}: Input Port Group 引用了不存在的 Socket Group：${group.id} -> ${group.socketGroup}`);
    for (const port of group.ports ?? []) validatePort(port, `inputPortGroups.${group.id}`);
    if (!group.repeat) continue;
    const count = spec.parameters.find((parameter) => parameter.key === group.repeat!.countParameter);
    if (!count) errors.push(`${prefix}: 重复 Socket 数量参数不存在：${group.repeat.countParameter}`);
    else if (count.kind !== "number") errors.push(`${prefix}: 重复 Socket 数量参数必须为 number：${group.repeat.countParameter}`);
    if ((group.repeat.min ?? 1) < 1 || (group.repeat.max ?? 32) < (group.repeat.min ?? 1)) errors.push(`${prefix}: 重复 Socket 数量范围无效：${group.id}`);
  }
  return errors;
}

/** Author a NodeSpec with immediate declaration validation. */
export function defineNodeSpec<T extends NodeSpec>(spec: T): T {
  const errors = validateNodeSpecDefinition(spec);
  if (errors.length) throw new Error(`Invalid NodeSpec:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return spec;
}


export type NodeSpecRegistration = {
  nodeType: string;
  unregister: () => boolean;
};

/**
 * Register a validated NodeSpec in the live editor catalog.
 *
 * This is a declaration/catalog registration only. Runtime execution still
 * requires a matching runtime implementation supplied by the host/plugin layer.
 */
export function registerNodeSpec<T extends NodeSpec>(spec: T): NodeSpecRegistration {
  const validated = defineNodeSpec(spec);
  const dispose = registerCatalogNodeSpec(validated);
  let active = true;
  return {
    nodeType: validated.nodeType,
    unregister: () => {
      if (!active) return false;
      active = false;
      unregisterJavascriptNodeProvider(validated.nodeType);
      unregisterPythonNodeProvider(validated.nodeType);
      return dispose();
    },
  };
}

export function unregisterNodeSpec(nodeType: string): boolean {
  unregisterJavascriptNodeProvider(nodeType);
  unregisterPythonNodeProvider(nodeType);
  return unregisterCatalogNodeSpec(nodeType);
}

function assertExternalProviderTarget(nodeType: string, runtime: "python" | "javascript"): NodeSpec {
  const spec = getNodeSpec(nodeType);
  if (!spec || !isExternalNodeType(nodeType)) throw new Error(`Runtime Provider requires a registered external NodeSpec: ${nodeType}`);
  if (!(spec.runtimeSupport ?? []).includes(runtime)) throw new Error(`${nodeType} 未声明 ${runtime} Runtime 支持`);
  return spec;
}

export function registerJavascriptProvider(nodeType: string, provider: JavascriptNodeProvider): () => boolean {
  assertExternalProviderTarget(nodeType, "javascript");
  return registerJavascriptNodeProvider(nodeType, provider);
}

export function registerPythonProvider(descriptor: PythonNodeProviderDescriptor): () => boolean {
  assertExternalProviderTarget(descriptor.nodeType, "python");
  return registerPythonNodeProvider(descriptor);
}

export type NodePluginDefinition = {
  spec: NodeSpec;
  javascript?: JavascriptNodeProvider;
  python?: Omit<PythonNodeProviderDescriptor, "nodeType">;
};

export type NodePluginRegistration = {
  nodeType: string;
  unregister: () => boolean;
};

/** Register one external node declaration and all declared runtime providers atomically. */
export function registerNodePlugin(definition: NodePluginDefinition): NodePluginRegistration {
  const runtimes = definition.spec.runtimeSupport ?? [];
  if (runtimes.includes("javascript") && !definition.javascript) throw new Error(`${definition.spec.nodeType}: 缺少 JavaScript Provider`);
  if (runtimes.includes("python") && !definition.python) throw new Error(`${definition.spec.nodeType}: 缺少 Python Provider`);
  const specRegistration = registerNodeSpec(definition.spec);
  let unregisterJavascript: (() => boolean) | undefined;
  let unregisterPython: (() => boolean) | undefined;
  try {
    if (definition.javascript) unregisterJavascript = registerJavascriptProvider(definition.spec.nodeType, definition.javascript);
    if (definition.python) unregisterPython = registerPythonProvider({ nodeType: definition.spec.nodeType, ...definition.python });
  } catch (error) {
    unregisterJavascript?.();
    unregisterPython?.();
    specRegistration.unregister();
    throw error;
  }
  let active = true;
  return {
    nodeType: definition.spec.nodeType,
    unregister: () => {
      if (!active) return false;
      active = false;
      unregisterJavascript?.();
      unregisterPython?.();
      return specRegistration.unregister();
    },
  };
}

export function hasRegisteredRuntimeProvider(nodeType: string, runtime: "python" | "javascript"): boolean {
  const spec = getNodeSpec(nodeType);
  if (!spec || !isExternalNodeType(nodeType) || !(spec.runtimeSupport ?? []).includes(runtime)) return false;
  return runtime === "javascript" ? hasJavascriptNodeProvider(nodeType) : hasPythonNodeProvider(nodeType);
}
