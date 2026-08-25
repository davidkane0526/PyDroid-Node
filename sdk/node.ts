import { resolveNodeSpec } from "../src/nodeSpec";
import { getNodeSpec, isExternalNodeType, registerCatalogNodeSpec, unregisterCatalogNodeSpec } from "../src/nodeCatalog";
import { hasJavascriptNodeProvider, registerJavascriptNodeProvider, unregisterJavascriptNodeProvider, type JavascriptNodeProvider } from "../src/runtime/javascript/engine/providers";
import { hasPythonNodeProvider, registerPythonNodeProvider, unregisterPythonNodeProvider, type PythonNodeProviderDescriptor } from "../src/runtime/pythonProviders";

import type {
  InputPortGroupSpec,
  NodeConditionValue,
  NodeSpec,
  NodeUiHelpSpec,
  NodeUiParameterGroupSpec,
  NodeUiSpec,
  NodeUiStatusItemSpec,
  NodeUiStatusResultField,
  NodeUiOutputStatusSpec,
  NodeUiValidationSpec,
  NodeVariant,
  ParameterOptionSpec,
  ParameterSpec,
  PortSpec,
  SocketGroupSpec,
  ValueType,
} from "../src/nodeCatalog";

export const NODE_SPEC_SDK_VERSION = 7 as const;

export type {
  InputPortGroupSpec,
  NodeConditionValue,
  NodeSpec,
  NodeUiHelpSpec,
  NodeUiParameterGroupSpec,
  NodeUiSpec,
  NodeUiStatusItemSpec,
  NodeUiStatusResultField,
  NodeUiOutputStatusSpec,
  NodeUiValidationSpec,
  NodeVariant,
  ParameterOptionSpec,
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
  const validateCondition = (when: Record<string, NodeConditionValue> | undefined, owner: string) => {
    for (const key of Object.keys(when ?? {})) if (!conditionKeys.has(key)) errors.push(`${prefix}: ${owner} 条件参数不存在：${key}`);
  };
  for (const parameter of spec.parameters) {
    validateCondition(parameter.visibleWhen, `参数 ${parameter.key} visibleWhen`);
    validateCondition(parameter.readOnlyWhen, `参数 ${parameter.key} readOnlyWhen`);
    validateCondition(parameter.disabledWhen, `参数 ${parameter.key} disabledWhen`);
    if (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) errors.push(`${prefix}: 参数 ${parameter.key} min 不能大于 max`);
    if (parameter.step !== undefined && parameter.step <= 0) errors.push(`${prefix}: 参数 ${parameter.key} step 必须大于 0`);
    if (parameter.constraintVariants?.length && parameter.kind !== "number") errors.push(`${prefix}: constraintVariants 仅适用于 number 参数：${parameter.key}`);
    for (const [index, variant] of (parameter.constraintVariants ?? []).entries()) {
      validateCondition(variant.when, `参数 ${parameter.key} constraintVariants[${index}]`);
      if (variant.min !== undefined && variant.max !== undefined && variant.min > variant.max) errors.push(`${prefix}: 参数 ${parameter.key} constraintVariants[${index}] min 不能大于 max`);
      if (variant.step !== undefined && variant.step <= 0) errors.push(`${prefix}: 参数 ${parameter.key} constraintVariants[${index}] step 必须大于 0`);
    }
    if (parameter.optionVariants?.length && parameter.kind !== "select") errors.push(`${prefix}: optionVariants 仅适用于 select 参数：${parameter.key}`);
    for (const [index, variant] of (parameter.optionVariants ?? []).entries()) {
      validateCondition(variant.when, `参数 ${parameter.key} optionVariants[${index}]`);
      if (!variant.options.length) errors.push(`${prefix}: 参数 ${parameter.key} optionVariants[${index}] options 不能为空`);
    }
  }

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
    validateCondition(group.when, `UI 参数分组 ${group.id}`);
    for (const key of group.parameters) {
      if (!parameterKeys.has(key)) errors.push(`${prefix}: UI 参数分组引用不存在的参数：${group.id}.${key}`);
      if (uiGroupedParameterKeys.has(key)) errors.push(`${prefix}: UI 参数不能重复出现在多个分组：${key}`);
      if (inlineParameterKeys.has(key)) errors.push(`${prefix}: UI 参数不能同时声明为 inline 和分组参数：${key}`);
      uiGroupedParameterKeys.add(key);
    }
  }
  const statusResultFields = new Set(["kind", "value", "text", "rows", "columns"]);
  const outputPortIds = new Set([
    ...spec.outputPorts.map((port) => port.id),
    ...(spec.variants ?? []).flatMap((variant) => (variant.outputPorts ?? []).map((port) => port.id)),
  ]);
  for (const item of spec.ui?.status ?? []) {
    if (!item.label.trim()) errors.push(`${prefix}: UI 状态项 label 不能为空`);
    validateCondition(item.when, `UI 状态项 ${item.label}`);
    const sources = Number(Boolean(item.parameter)) + Number(Boolean(item.result)) + Number(Boolean(item.output));
    if (sources !== 1) errors.push(`${prefix}: UI 状态项必须且只能声明 parameter、result 或 output：${item.label}`);
    if (item.parameter && !parameterKeys.has(item.parameter)) errors.push(`${prefix}: UI 状态项引用不存在的参数：${item.parameter}`);
    if (item.result && !statusResultFields.has(item.result)) errors.push(`${prefix}: UI 状态项 result 字段无效：${item.result}`);
    if (item.output) {
      if (!outputPortIds.has(item.output.port)) errors.push(`${prefix}: UI 状态项引用不存在的输出端口：${item.output.port}`);
      if (!statusResultFields.has(item.output.field)) errors.push(`${prefix}: UI 状态项 output 字段无效：${item.output.field}`);
    }
  }
  for (const [index, validation] of (spec.ui?.validations ?? []).entries()) {
    if (!validation.message.trim()) errors.push(`${prefix}: UI validation[${index}] message 不能为空`);
    validateCondition(validation.when, `UI validation[${index}]`);
    if (validation.parameter && !parameterKeys.has(validation.parameter)) errors.push(`${prefix}: UI validation[${index}] 引用不存在的参数：${validation.parameter}`);
    if (validation.severity && !["error", "warning"].includes(validation.severity)) errors.push(`${prefix}: UI validation[${index}] severity 无效：${validation.severity}`);
  }

  validateCondition(spec.ui?.help?.when, "UI help");

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
