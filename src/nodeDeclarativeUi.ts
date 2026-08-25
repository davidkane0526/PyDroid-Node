import type { NodeSpec, ParameterSpec } from "./nodeCatalog";
import { matchesNodeCondition } from "./nodeSpec";

export function declarativeUiValues(spec: NodeSpec, values: Record<string, unknown>): Record<string, unknown> {
  return { ...spec.defaults, ...values };
}

export function declarativeUiVisible(
  when: Record<string, import("./nodeCatalog").NodeConditionValue> | undefined,
  values: Record<string, unknown>,
): boolean {
  return !when || matchesNodeCondition(when, values);
}

export function resolveDeclarativeParameter(parameter: ParameterSpec, values: Record<string, unknown>): ParameterSpec {
  let resolved = parameter;
  for (const variant of parameter.optionVariants ?? []) {
    if (matchesNodeCondition(variant.when, values)) resolved = { ...resolved, options: variant.options };
  }
  return resolved;
}
