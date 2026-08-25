import type { NodeSpec, NodeUiStatusItemSpec, ParameterSpec } from "./nodeCatalog";
import { matchesNodeCondition } from "./nodeSpec";

type DeclarativeStatusPreview =
  | { kind: "table"; preview: { totalRows: number; totalColumns: number } }
  | { kind: "plot" }
  | { kind: "value"; text: string; value?: unknown };

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
  for (const variant of parameter.constraintVariants ?? []) {
    if (matchesNodeCondition(variant.when, values)) resolved = { ...resolved, min: variant.min ?? resolved.min, max: variant.max ?? resolved.max, step: variant.step ?? resolved.step };
  }
  const readOnly = Boolean(parameter.readOnly || (parameter.readOnlyWhen && matchesNodeCondition(parameter.readOnlyWhen, values)));
  const disabled = Boolean(parameter.disabled || (parameter.disabledWhen && matchesNodeCondition(parameter.disabledWhen, values)));
  if (readOnly !== Boolean(resolved.readOnly) || disabled !== Boolean(resolved.disabled)) resolved = { ...resolved, readOnly, disabled };
  return resolved;
}

export function declarativeStatusValue(
  item: NodeUiStatusItemSpec,
  values: Record<string, unknown>,
  result: DeclarativeStatusPreview | undefined,
): unknown {
  if (item.parameter) return values[item.parameter];
  if (!item.result || !result) return undefined;
  if (item.result === "kind") return result.kind;
  if (item.result === "text") return result.kind === "value" ? result.text : undefined;
  if (item.result === "value") return result.kind === "value" ? result.value ?? result.text : undefined;
  if (item.result === "rows") return result.kind === "table" ? result.preview.totalRows : undefined;
  if (item.result === "columns") return result.kind === "table" ? result.preview.totalColumns : undefined;
  return undefined;
}
