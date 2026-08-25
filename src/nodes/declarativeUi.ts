import type { NodeSpec, NodeUiStatusItemSpec, NodeUiStatusResultField, ParameterSpec } from "../nodeCatalog";
import { matchesNodeCondition } from "../nodeSpec";
import type { NodeExecutionPreview, NodeOutputExecutionPreview } from "../runtime/types";

export type DeclarativeValidationIssue = {
  message: string;
  parameter?: string;
  severity: "error" | "warning";
};

export function declarativeUiValues(spec: NodeSpec, values: Record<string, unknown>): Record<string, unknown> {
  return { ...spec.defaults, ...values };
}

export function declarativeUiVisible(
  when: Record<string, import("../nodeCatalog").NodeConditionValue> | undefined,
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

function statusPreviewField(preview: NodeOutputExecutionPreview | undefined, field: NodeUiStatusResultField): unknown {
  if (!preview) return undefined;
  if (field === "kind") return preview.kind;
  if (field === "text") return preview.kind === "value" ? preview.text : undefined;
  if (field === "value") return preview.kind === "value" ? preview.value ?? preview.text : undefined;
  if (field === "rows") return preview.kind === "table" ? preview.preview.totalRows : undefined;
  if (field === "columns") return preview.kind === "table" ? preview.preview.totalColumns : undefined;
  return undefined;
}

export function declarativeStatusValue(
  item: NodeUiStatusItemSpec,
  values: Record<string, unknown>,
  result: NodeExecutionPreview | undefined,
): unknown {
  if (item.parameter) return values[item.parameter];
  if (item.output) return statusPreviewField(result?.outputs?.[item.output.port], item.output.field);
  if (!item.result) return undefined;
  return statusPreviewField(result, item.result);
}

function isEmptyRequiredValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function declarativeValidationIssues(spec: NodeSpec, values: Record<string, unknown>): DeclarativeValidationIssue[] {
  const effectiveValues = declarativeUiValues(spec, values);
  const issues: DeclarativeValidationIssue[] = [];
  for (const parameter of spec.parameters) {
    if (!declarativeUiVisible(parameter.visibleWhen, effectiveValues)) continue;
    const resolved = resolveDeclarativeParameter(parameter, effectiveValues);
    const value = effectiveValues[parameter.key];
    if (resolved.required && isEmptyRequiredValue(value)) {
      issues.push({ message: `${resolved.label}不能为空`, parameter: parameter.key, severity: "error" });
      continue;
    }
    if (resolved.kind === "number" && value !== null && value !== undefined && value !== "") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) issues.push({ message: `${resolved.label}必须是有限数值`, parameter: parameter.key, severity: "error" });
      else {
        if (resolved.min !== undefined && numeric < resolved.min) issues.push({ message: `${resolved.label}不能小于 ${resolved.min}`, parameter: parameter.key, severity: "error" });
        if (resolved.max !== undefined && numeric > resolved.max) issues.push({ message: `${resolved.label}不能大于 ${resolved.max}`, parameter: parameter.key, severity: "error" });
      }
    }
    if (resolved.kind === "select" && resolved.options?.length && value !== null && value !== undefined && value !== "") {
      if (!resolved.options.some((option) => option.value === value)) issues.push({ message: `${resolved.label}的当前值不在可选项中`, parameter: parameter.key, severity: "error" });
    }
  }
  for (const validation of spec.ui?.validations ?? []) {
    if (!matchesNodeCondition(validation.when, effectiveValues)) continue;
    issues.push({ message: validation.message, parameter: validation.parameter, severity: validation.severity ?? "error" });
  }
  return issues;
}
